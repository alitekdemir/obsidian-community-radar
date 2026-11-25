// ─── 3e. BulkOps (hidden lists, bulk mutations, atomic Undo, mass reviews) ───
/** Handles bulk plugin actions, undo history, hidden lists and mass-review recovery. */
class BulkOps {
  constructor(plugin) {
    this.plugin = plugin;
  }

  announce(text, op) {
    const leaves = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE);
    for (const leaf of leaves) {
      leaf.view.toast = { text, op };
      leaf.view.refresh?.();
    }
    if (!leaves.length) new Notice(text);
  }

  async exclude(plugin) {
    this.announce(t("notice.excluded", { name: plugin.name }), await this.bulk("exclude", [plugin]));
  }

  async dismiss(plugin) {
    this.plugin.data.dismissed[plugin.id] = dayString(Date.now());
    await this.plugin.saveData(this.plugin.data);
  }

  async snooze(plugin) {
    this.announce(t("notice.snoozed", { name: plugin.name }), await this.bulk("snooze", [plugin]));
  }

  hiddenCounts() {
    const p = this.plugin;
    const snoozed = (p.catalog?.plugins || []).filter((item) => isSnoozed(item, p.data.snoozed)).length;
    return { excluded: Object.keys(p.data.excluded).length, snoozed, dismissed: Object.keys(p.data.dismissed).length };
  }

  hiddenTotal() {
    const c = this.hiddenCounts();
    return c.excluded + c.snoozed + c.dismissed;
  }

  async restoreFrom(mode, ids) {
    const p = this.plugin;
    for (const id of ids) delete p.data[mode][id];
    await p.saveData(p.data);
    p.redraw();
  }

  /**
   * Runs one action on many plugins and records every change for exact Undo (including partial progress on failure).
   * Throttles README adoption for newly created notes instead of firing N simultaneous GitHub requests.
   */
  async bulk(kind, plugins, value = null) {
    const p = this.plugin;
    const today = dayString(Date.now());
    const changes = [];
    const createdIds = [];
    let thrown = null;
    try {
      for (const item of plugins) {
        if (kind === "snooze" || kind === "exclude") {
          const store = p.data[kind === "snooze" ? "snoozed" : "excluded"];
          const after = kind === "snooze" ? item.updated || 0 : today;
          if (store[item.id] === after) continue;
          changes.push({ id: item.id, before: store[item.id] ?? null, after });
          store[item.id] = after;
          continue;
        }
        const note = p.notes.index.get(item.id);
        if (kind === "library") {
          if (note) continue;
          await p.saveToLibrary(item, {}, { adoptReadme: false });
          changes.push({ id: item.id, before: false, after: true, created: true });
          createdIds.push(item.id);
          continue;
        }
        if (kind === "reviewed" && !note) continue;
        const groups = note?.groups || [];
        if (kind === "group") {
          if (groups.includes(value)) continue;
          await p.saveToLibrary(item, { groups: [...groups, value] }, { adoptReadme: false });
          changes.push({ id: item.id, before: false, after: true, created: !note });
          if (!note) createdIds.push(item.id);
          continue;
        }
        const after = kind === "reviewed" ? today : (kind === "rating" ? (value || null) : value);
        const before = kind === "rating" ? (note?.rating || null) : (note?.[kind] ?? null);
        if (before === after) continue;
        await p.saveToLibrary(item, { [kind]: after }, { adoptReadme: false });
        changes.push({ id: item.id, before, after, created: !note });
        if (!note) createdIds.push(item.id);
      }
    } catch (error) {
      thrown = error;
    }
    const op = { at: Date.now(), kind, value, changes };
    if (changes.length || !thrown) {
      p.data.ops = [op, ...(p.data.ops || [])].slice(0, OPS_CAP);
      await p.saveData(p.data);
      p.redraw();
    }
    if (createdIds.length) {
      // adopt/fetch READMEs in the background with PARALLEL concurrency cap
      mapLimit(createdIds, PARALLEL, async (id) => {
        const plugin = p.pluginById(id);
        const file = p.notes.file(id);
        if (plugin && file) await p.readmes.adopt(plugin, file);
      }).catch((error) => console.warn("[Pindex] bulk README adopt", error));
    }
    if (thrown) throw thrown;
    return op;
  }

  /** Turns back an operation where its value is still unchanged; guards against double-undo and removes notes it created. */
  async undo(op) {
    if (!op || op.undone || op._undoing) return { restored: 0, skipped: 0 };
    op._undoing = true;
    const p = this.plugin;
    let restored = 0;
    let skipped = 0;
    try {
      for (const c of op.changes) {
        const item = p.pluginById(c.id);
        const note = p.notes.index.get(c.id);
        let still = false;
        if (op.kind === "snooze" || op.kind === "exclude") {
          const store = p.data[op.kind === "snooze" ? "snoozed" : "excluded"];
          still = store[c.id] === c.after;
          if (still) { if (c.before == null) delete store[c.id]; else store[c.id] = c.before; }
        } else if (op.kind === "library") {
          still = Boolean(item && note);
          if (still) await p.removeFromLibrary(item, false, { redraw: false });
        } else if (op.kind === "group") {
          still = Boolean(item && note?.groups.includes(op.value));
          if (still) {
            const left = note.groups.filter((g) => g !== op.value);
            const empty = !left.length && !note.rating && !note.status && !note.note;
            if (c.created && empty) await p.removeFromLibrary(item, false, { redraw: false });
            else await p.saveToLibrary(item, { groups: left });
          }
        } else {
          const field = op.field || op.kind;
          const cur = field === "rating" ? (note?.[field] || null) : (note?.[field] ?? null);
          still = Boolean(item && note && cur === c.after);
          if (still) {
            const empty = field === "rating" && !note.groups.length && !note.status && !note.note;
            if (c.created && empty && c.before == null) await p.removeFromLibrary(item, false, { redraw: false });
            else await p.saveToLibrary(item, { [field]: c.before || null });
          }
        }
        if (still) restored++; else skipped++;
      }
      op.undone = Date.now();
      await p.saveData(p.data);
      p.redraw();
    } finally {
      delete op._undoing;
    }
    return { restored, skipped };
  }

  massReviews(min = 5) {
    const byDay = new Map();
    for (const [id, note] of this.plugin.notes.index) {
      if (!note.reviewed) continue;
      let list = byDay.get(note.reviewed);
      if (!list) byDay.set(note.reviewed, (list = []));
      list.push(id);
    }
    return [...byDay].filter(([, ids]) => ids.length >= min).map(([date, ids]) => ({ date, ids })).sort((a, b) => b.date.localeCompare(a.date));
  }

  async unreview(date) {
    const p = this.plugin;
    const changes = [];
    for (const [id, note] of p.notes.index) {
      const item = note.reviewed === date && p.pluginById(id);
      if (!item) continue;
      changes.push({ id, before: date, after: "" });
      await p.saveToLibrary(item, { reviewed: null });
    }
    const op = { at: Date.now(), kind: "unreviewed", field: "reviewed", value: date, changes };
    p.data.ops = [op, ...(p.data.ops || [])].slice(0, OPS_CAP);
    await p.saveData(p.data);
    p.redraw();
    return op;
  }
}

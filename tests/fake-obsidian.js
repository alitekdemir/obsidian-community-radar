// A minimal stand-in for the `obsidian` module: in-memory vault, YAML frontmatter, mocked network.
const YAML = require("yaml");

class TFile {
  constructor(path) {
    this.path = path;
    this.extension = path.split(".").pop();
    this.basename = path.split("/").pop().replace(/\.[^.]+$/, "");
  }
}
/** A folder whose children are derived from the in-memory file list. */
class TFolder {
  constructor(path, files, folders) { this.path = path; this.files = files; this.folders = folders; }
  get children() {
    const prefix = `${this.path}/`;
    const names = new Map();
    for (const p of [...this.files.keys(), ...this.folders]) {
      if (!p.startsWith(prefix)) continue;
      const [head, ...rest] = p.slice(prefix.length).split("/");
      names.set(head, names.get(head) || rest.length > 0 || this.folders.has(prefix + head));
    }
    return [...names].map(([name, isFolder]) => (isFolder
      ? new TFolder(prefix + name, this.files, this.folders) : new TFile(prefix + name)));
  }
}

function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  return m ? { fm: YAML.parse(m[1]) || {}, body: text.slice(m[0].length) } : { fm: null, body: text };
}

/** An app with an in-memory vault, metadata cache, frontmatter writer and keychain. */
function makeApp() {
  const files = new Map();
  const folders = new Set();
  const disk = new Map();
  const secrets = new Map();
  const vault = {
    files,
    writes: 0,
    configDir: ".obsidian",
    getMarkdownFiles: () => [...files.keys()].filter((p) => p.endsWith(".md")).map((p) => new TFile(p)),
    getFiles: () => [...files.keys()].map((p) => new TFile(p)),
    getAbstractFileByPath: (p) => {
      if (files.has(p)) return new TFile(p);
      const isFolder = folders.has(p) || [...files.keys()].some((k) => k.startsWith(`${p}/`));
      return isFolder ? new TFolder(p, files, folders) : null;
    },
    createFolder: async (p) => { folders.add(p); },
    create: async (p, content) => { if (files.has(p)) throw new Error(`exists: ${p}`); files.set(p, content); return new TFile(p); },
    read: async (f) => files.get(f.path),
    cachedRead: async (f) => files.get(f.path),
    process: async (f, fn) => { vault.writes++; files.set(f.path, fn(files.get(f.path))); },
    on: () => ({}),
    adapter: {
      disk,
      exists: async (p) => disk.has(p) || [...disk.keys()].some((k) => k.startsWith(`${p}/`)),
      read: async (p) => disk.get(p),
      write: async (p, data) => { disk.set(p, data); },
      mkdir: async () => {},
    },
  };
  return {
    vault,
    metadataCache: {
      getFileCache: (f) => { const text = files.get(f.path); return text == null ? null : { frontmatter: splitFrontmatter(text).fm || undefined }; },
      on: () => ({}),
    },
    fileManager: {
      processFrontMatter: async (f, fn) => {
        const { fm, body } = splitFrontmatter(files.get(f.path));
        const data = fm || {};
        fn(data);
        files.set(f.path, `---\n${YAML.stringify(data, { lineWidth: 0 })}---\n${body}`);
      },
    },
    workspace: { onLayoutReady: (cb) => cb(), getLeavesOfType: () => [], getActiveFile: () => null, openLinkText: () => {} },
    secretStorage: { setSecret: (k, v) => secrets.set(k, v), getSecret: (k) => secrets.get(k) ?? null, listSecrets: () => [...secrets.keys()] },
    plugins: { manifests: {} },
  };
}

/** Network mock: tests register handlers by URL prefix; LLM endpoints echo "TR: <text>". */
const network = { handlers: [], calls: [] };
async function requestUrl({ url, method = "GET", headers = {}, body }) {
  network.calls.push({ url, method, headers, body: body && JSON.parse(body) });
  for (const [prefix, handler] of network.handlers) if (url.startsWith(prefix)) return handler({ url, headers, body });
  if (/api\.anthropic\.com|api\.openai\.com|generativelanguage|openrouter\.ai/.test(url)) {
    if (url.includes("/models")) return { status: 200, json: { data: [{ id: "model-a" }, { id: "model-b-latest" }] } };
    const parsed = JSON.parse(body);
    const prompt = parsed.messages ? parsed.messages[0].content : parsed.contents[0].parts[0].text;
    const texts = JSON.parse(prompt.slice(prompt.lastIndexOf("\n[") + 1));
    const reply = "```json\n" + JSON.stringify(texts.map((s) => `TR: ${s}`)) + "\n```";
    if (url.includes("anthropic")) return { status: 200, json: { content: [{ text: reply }] } };
    if (url.includes("generativelanguage")) return { status: 200, json: { candidates: [{ content: { parts: [{ text: reply }] } }] } };
    return { status: 200, json: { choices: [{ message: { content: reply } }] } };
  }
  return { status: 404, text: "" };
}

class Notice {
  constructor(message) { this.messages = [message]; Notice.all.push(this); }
  setMessage(message) { this.messages.push(message); }
  hide() {}
}
Notice.all = [];

const menus = [];

module.exports = {
  makeApp, network, requestUrl, Notice, TFile, TFolder, menus,
  normalizePath: (p) => p.replace(/\/+/g, "/").replace(/\/$/, ""),
  addIcon: () => {},
  setIcon: (el, name) => { if (el.dataset) el.dataset.icon = name; },
  setTooltip: (el, text) => el.setAttribute && el.setAttribute("data-tooltip", text),
  moment: { locale: () => "en" },
  Plugin: class {
    constructor(app, manifest) { this.app = app; this.manifest = manifest; }
    registerView(type, factory) { this.viewFactory = factory; }
    addRibbonIcon() {}
    addSettingTab(tab) { this.settingTab = tab; }
    addCommand(c) { (this.commands ||= {})[c.id] = c; }
    registerEvent() {}
    async loadData() { return this._data; }
    async saveData(d) { this._data = JSON.parse(JSON.stringify(d)); }
  },
  Menu: class {
    constructor() { this.items = []; menus.push(this); }
    addItem(cb) {
      const item = { setTitle(x) { this.title = x; return this; }, setChecked(c) { this.checked = c; return this; }, onClick(f) { this.click = f; return this; } };
      cb(item); this.items.push(item); return this;
    }
    showAtPosition(pos) { this.shownAt = pos; return this; }
  },
  ItemView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {},
  SuggestModal: class { constructor(app) { this.app = app; } setPlaceholder() {} open() {} },
  SecretComponent: class {
    constructor(app, el) { this.el = el; }
    setValue(v) { this.value = v; return this; }
    onChange(f) { this.change = f; return this; }
  },
};

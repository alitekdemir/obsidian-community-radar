
// ─── Reading effect ───────────────────────────────────────────────────────────
// While the AI translates a text in the details window, the text stays where it is and is shown as being read, with
// the effect chosen in Settings › Translation effect. styles.css draws them (.is-translating.pdt-fx-<key>); this only
// adds what CSS can't: the snake's outline, the scan's timing (it needs the box's height) and the Matrix letters.
// Plain DOM, no Obsidian API.

const READING_UNITS = ".pdt-ln, .pdt-lang-text";   // the texts an effect works line by line: inline, one per block
const MATRIX_GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789";
const MATRIX_TICK_MS = { decode: 50, sparks: 80, wave: 35 };   // each Matrix effect's step
const MATRIX_SPARKS = 0.22;  // Sparks: the share of letters that are glyphs at any moment
const SCAN_MS = 3000;        // one scan, top to bottom (styles.css: pdt-scan, pdt-lit)
const SCAN_BAND = 56;        // the scan band's height in px (styles.css: .pdt-fx-scan)

/**
 * Shows `box` (the description, or the Overview's parts) as being read by the AI with effect `fx` (TRANSLATE_FX).
 * The box is rebuilt when the translation arrives, which ends the effect: nothing to stop.
 * @param {HTMLElement} box   already in the page
 * @param {string} fx         a TRANSLATE_FX key
 * @param {number} [first]    the stagger's first step (the description is 0, the Overview follows it)
 * @param {boolean} [still]   animations off (Settings › Animations): no timing, no changing letters
 */
function showReading(box, fx, first = 0, still = false) {
  box.classList.add("is-translating", `pdt-fx-${fx}`);
  box.querySelectorAll(READING_UNITS).forEach((el, i) => el.style.setProperty("--i", String(first + i)));
  if (fx === "snake" || fx === "snakes") box.prepend(snakeOutline());
  if (still) return;
  if (fx === "scan") requestAnimationFrame(() => timeScan(box));
  if (fx in MATRIX_TICK_MS) matrixLetters(box, fx);
}

/** The snake: four dashes of one outline ending at one head, long and faint to short and bright (styles.css). */
function snakeOutline() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "pdt-snake");
  svg.setAttribute("aria-hidden", "true");
  for (const part of ["t1", "t2", "mid", "head"]) {
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("class", part);
    rect.setAttribute("pathLength", "100");   // dash lengths in % of the outline: one length and speed on every side
    svg.append(rect);
  }
  return svg;
}

/** Scan: the band crosses the box in SCAN_MS; each line lights up when the band's lower edge reaches its middle. */
function timeScan(box) {
  const top = box.getBoundingClientRect().top;
  const height = box.offsetHeight;
  box.style.setProperty("--pdt-h", `${height}px`);
  box.querySelectorAll(READING_UNITS).forEach((el) => {
    const r = el.getBoundingClientRect();
    const at = ((r.top + r.height / 2 - top) / (height + SCAN_BAND)) * SCAN_MS - 0.08 * SCAN_MS;   // pdt-lit peaks at 8%
    el.style.setProperty("--pdt-d", `${(at - SCAN_MS) / 1000}s`);   // negative: already in its cycle, no start-up wait
  });
}

/**
 * Matrix: the letters change where they are. Each character gets its own span (.pdt-ch) and, while it is a glyph,
 * shows it over itself (styles.css: the letter turns transparent, the glyph is an ::after), so nothing moves.
 * Decode: scrambled, then resolved left to right. Sparks: MATRIX_SPARKS of the letters are glyphs at any moment, each
 * for a few ticks. Wave: a green band runs letter by letter, glyphs at its head. Stops when the box leaves the page.
 */
function matrixLetters(box, fx) {
  const cells = [];
  box.querySelectorAll(READING_UNITS).forEach((unit) => {
    const text = unit.textContent;
    unit.textContent = "";
    for (const ch of text) {
      if (ch === " ") { unit.append(" "); continue; }   // spaces stay text: lines break as before
      const cell = document.createElement("span");
      cell.className = "pdt-ch";
      cell.textContent = ch;
      unit.append(cell);
      cells.push(cell);
    }
  });
  const glyph = (cell, on) => {
    cell.classList.toggle("is-glyph", on);
    if (on) cell.dataset.g = MATRIX_GLYPHS[Math.floor(Math.random() * MATRIX_GLYPHS.length)];
  };
  const step = { decode: decodeStep, sparks: sparksStep, wave: waveStep }[fx](cells, glyph);
  const timer = window.setInterval(() => {
    if (!box.isConnected) return window.clearInterval(timer);
    step();
  }, MATRIX_TICK_MS[fx]);
}

/** Decode: a cursor resolves the letters two at a time; a few glyphs ahead of it keep changing, the rest wait dimmed. */
function decodeStep(cells, glyph) {
  let pos = 0;
  return () => {
    cells.forEach((cell, i) => {
      cell.classList.toggle("is-todo", i > pos + 6);
      glyph(cell, i >= pos && i <= pos + 6);
    });
    pos = pos > cells.length + 40 ? 0 : pos + 2;   // a pause after the last letter, then again
  };
}

/** Sparks: keeps MATRIX_SPARKS of the letters as glyphs; each lives 2–5 ticks and changes now and then. */
function sparksStep(cells, glyph) {
  const life = new Map();   // cell → ticks left as a glyph
  return () => {
    for (const [cell, ticks] of life) {
      if (ticks <= 1) { glyph(cell, false); life.delete(cell); continue; }
      life.set(cell, ticks - 1);
      if (Math.random() < 0.5) glyph(cell, true);
    }
    const want = Math.min(cells.length, Math.round(cells.length * MATRIX_SPARKS));
    while (life.size < want) {
      const cell = cells[Math.floor(Math.random() * cells.length)];
      if (!life.has(cell)) { glyph(cell, true); life.set(cell, 2 + Math.floor(Math.random() * 4)); }
    }
  };
}

/** Wave: a band of 18 letters turns green, brightest at its head, where the letters are glyphs. */
function waveStep(cells, glyph) {
  let pos = 0;
  return () => {
    cells.forEach((cell, i) => {
      const d = pos - i;   // how far behind the head
      cell.style.setProperty("--pdt-g", d >= 0 && d < 18 ? String(100 - d * 5) : "");
      glyph(cell, d >= 0 && d < 3);
    });
    pos = pos > cells.length + 30 ? 0 : pos + 1;
  };
}

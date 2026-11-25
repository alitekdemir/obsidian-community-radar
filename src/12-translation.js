// ─── Translation providers (pure: build requests, parse replies) ────────────
/**
 * Each provider: chat request, reply text, model-list request and model entries.
 * The key always travels in a header, never in the URL (so it never shows up in logs).
 */
const PROVIDERS = {
  anthropic: {
    label: "Claude (Anthropic)",
    chat: (model, key, prompt) => ({
      url: "https://api.anthropic.com/v1/messages",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      // the reply's ceiling is required here: twice the prompt's tokens (~4 characters each) leaves room for longer languages
      body: { model, max_tokens: Math.min(MAX_OUTPUT_TOKENS, Math.max(4096, Math.ceil(prompt.length / 2))), messages: [{ role: "user", content: prompt }] },
    }),
    text: (json) => (json.content || []).map((part) => part.text || "").join(""),
    truncated: (json) => json.stop_reason === "max_tokens",
    usage: (json) => ({ input: json.usage?.input_tokens, output: json.usage?.output_tokens, model: json.model }),
    models: (key) => ({ url: "https://api.anthropic.com/v1/models?limit=100", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } }),
    modelList: (json) => (json.data || []).map((m) => ({ id: m.id, price: null })),
  },
  openai: {
    label: "OpenAI",
    chat: (model, key, prompt) => ({
      url: "https://api.openai.com/v1/chat/completions",
      headers: { Authorization: `Bearer ${key}` },
      body: { model, messages: [{ role: "user", content: prompt }] },
    }),
    text: (json) => json.choices?.[0]?.message?.content || "",
    truncated: (json) => json.choices?.[0]?.finish_reason === "length",
    usage: (json) => ({ input: json.usage?.prompt_tokens, output: json.usage?.completion_tokens, model: json.model }),
    models: (key) => ({ url: "https://api.openai.com/v1/models", headers: { Authorization: `Bearer ${key}` } }),
    modelList: (json) => (json.data || []).filter((m) => /^(gpt|o\d|chatgpt)/.test(m.id)).map((m) => ({ id: m.id, price: null })),
  },
  gemini: {
    label: "Gemini (Google)",
    chat: (model, key, prompt) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,   // a typed id may hold / or ?
      headers: { "x-goog-api-key": key },
      body: { contents: [{ parts: [{ text: prompt }] }] },
    }),
    text: (json) => (json.candidates?.[0]?.content?.parts || []).filter((part) => !part.thought).map((part) => part.text || "").join(""),
    truncated: (json) => json.candidates?.[0]?.finishReason === "MAX_TOKENS",
    usage: (json) => ({
      input: json.usageMetadata?.promptTokenCount,
      output: (json.usageMetadata?.candidatesTokenCount || 0) + (json.usageMetadata?.thoughtsTokenCount || 0) || undefined,
      model: json.modelVersion,
    }),
    models: (key) => ({ url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", headers: { "x-goog-api-key": key } }),
    modelList: (json) => (json.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => ({ id: m.name.replace(/^models\//, ""), price: null })),
  },
  openrouter: {
    label: "OpenRouter",
    chat: (model, key, prompt, { thinking, sort } = {}) => ({
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: { Authorization: `Bearer ${key}` },
      body: {
        model, messages: [{ role: "user", content: prompt }], usage: { include: true },   // the reply says what it cost
        ...(thinking === "off" ? { reasoning: { effort: "none" } } : {}),                  // no thinking tokens (billed as output)
        ...openRouterRouting(sort, thinking),
      },
    }),
    thinking: true,   // the Thinking setting applies (the other providers: see THINKING_NOTES)
    text: (json) => json.choices?.[0]?.message?.content || "",
    truncated: (json) => json.choices?.[0]?.finish_reason === "length",
    usage: (json) => ({ input: json.usage?.prompt_tokens, output: json.usage?.completion_tokens, cost: json.usage?.cost, model: json.model }),
    models: (key) => ({ url: "https://openrouter.ai/api/v1/models", headers: { Authorization: `Bearer ${key}` } }),
    // thinking: "none" (the model doesn't think), "optional" (it can be turned off) or "mandatory"
    modelList: (json) => (json.data || []).map((m) => ({ id: m.id, price: tokenPrice(m.pricing),
      thinking: m.reasoning ? (m.reasoning.mandatory ? "mandatory" : "optional") : "none" })),
  },
};

/** OpenRouter provider routing (Settings › AI): "" balanced (its default), the cheapest or the fastest provider first. */
const ROUTE_SORTS = ["", "price", "throughput"];

/**
 * The request's `provider` part for a sort (ROUTE_SORTS). "" leaves the pick to OpenRouter, which weighs the price
 * actually paid, speed and reliability. A sort skips that and tries providers in its order; with thinking off,
 * require_parameters drops the ones that must think (they would refuse the request with a 400, with no fallback).
 */
function openRouterRouting(sort, thinking) {
  if (!sort) return {};
  return { provider: { sort, ...(thinking === "off" ? { require_parameters: true } : {}) } };
}

/** A reply the model got wrong (not JSON, the wrong count, empty texts, cut short): worth one more try. */
class ReplyError extends Error {}

/** The usage's sub-total a request counts under: its kind, and whether thinking was off ("overview:off"). */
const usageKind = (kind, thinking) => `${kind || "other"}${thinking === "off" ? ":off" : ""}`;

/** One tally: requests, prompt characters, input and output tokens, and the cost (null: never told). */
function addTally(was, { input, output, cost, chars } = {}) {
  const tally = was || { requests: 0, chars: 0, input: 0, output: 0, cost: null };
  return {
    requests: tally.requests + 1, chars: (tally.chars || 0) + (chars || 0), input: tally.input + (input || 0),
    output: tally.output + (output || 0), cost: typeof cost === "number" ? (tally.cost ?? 0) + cost : tally.cost,
  };
}

/**
 * Adds one request's usage to the running totals, per provider and model: requests, input and output tokens, and
 * the cost in USD when the provider tells it (OpenRouter does; the others count tokens only, cost stays null).
 * The same goes under the row's `kinds[kind]` (usageKind), which the estimates learn from.
 * @returns {object} the totals, a new object
 */
function addUsage(totals, provider, model, kind, usage = {}) {
  const key = `${provider}/${model}`;
  const was = totals?.[key] || { provider, model, requests: 0, input: 0, output: 0, cost: null };
  const { requests, input, output, cost } = addTally(was, usage);
  const kinds = { ...was.kinds, [kind]: addTally(was.kinds?.[kind], usage) };
  return { ...totals, [key]: { ...was, requests, input, output, cost, kinds } };
}

/** Requests of a kind it takes before an estimate goes by what they really cost. */
const MEASURED_MIN = 3;

/**
 * What an AI job will take, learnt from what this model's earlier requests of the same kind (and thinking) really
 * took: per prompt character (descriptions, READMEs: their size varies) or per request (Overviews: about the same
 * size, and a thinking model's tokens are mostly per request). Before MEASURED_MIN of them: the list price, with the
 * output a bit longer than the input; then it's a floor (`measured` false), as thinking tokens aren't counted.
 * @param {object} tally  the kind's tally (addTally), or null
 * @param {{chars: number, requests: number}} job  prompt characters and requests it'll send
 * @param {{input, output}} price  per 1M tokens, or null
 * @returns {{tokens: number, cost: ?number, measured: boolean}}
 */
function aiEstimate(tally, { chars, requests }, perRequest, price) {
  if (tally?.requests >= MEASURED_MIN && (perRequest || tally.chars)) {
    const share = perRequest ? requests / tally.requests : chars / tally.chars;
    const priced = tally.cost ?? (price ? (tally.input * (price.input || 0) + tally.output * (price.output || 0)) / 1e6 : null);
    return { tokens: Math.round((tally.input + tally.output) * share), cost: priced == null ? null : priced * share, measured: true };
  }
  const tokens = Math.ceil(chars / 4);   // ~4 characters a token
  const cost = price ? (tokens * (price.input || 0) + tokens * 1.2 * (price.output || 0)) / 1e6 : null;   // other languages run longer
  return { tokens: Math.round(tokens * 2.2), cost, measured: false };
}

/**
 * What a job of several requests used, as the providers reported it: tokens summed, the model that answered (the
 * reply names it; the asked id when it doesn't), and the cost only when every reply told it.
 * @param {{input, output, cost, model}[]} usages  one per request
 */
function sumUsage(usages, asked) {
  const cost = usages.every((u) => typeof u.cost === "number") ? usages.reduce((sum, u) => sum + u.cost, 0) : null;
  const tokens = usages.reduce((sum, u) => sum + (u.input || 0) + (u.output || 0), 0);
  return { model: usages.findLast((u) => u.model)?.model || asked, tokens, cost: usages.length ? cost : null };
}

/** OpenRouter price (USD per token, as text) → {input, output} per 1M tokens; null if unreadable, empty, or dynamic (-1). */
function tokenPrice(pricing) {
  const p = pricing?.prompt;
  const c = pricing?.completion;
  if (p == null || c == null || String(p).trim() === "" || String(c).trim() === "") return null;
  const input = Number(p) * 1e6;
  const output = Number(c) * 1e6;
  return Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0 ? { input, output } : null;
}

/** "$0.30 / $2.50 · 1M tokens" (input / output); free models say so. */
function formatPrice(price) {
  if (!price) return "";
  if (!price.input && !price.output) return t("model.free");
  const usd = (n) => {
    const digits = n < 10 ? 2 : 1;
    // under $0.10: 3 significant digits, so cheap models don't all read "$0.02"
    const format = n < 0.1 ? { maximumSignificantDigits: 3 } : { minimumFractionDigits: digits, maximumFractionDigits: digits };
    return `$${intl(Intl.NumberFormat, format).format(n)}`;
  };
  return `${usd(price.input)} / ${usd(price.output)} · ${t("price.unit")}`;
}

/** How many models the picker remembers besides the pinned ones. */
const RECENT_MODELS = 5;

/** The picker's list after choosing `id`: it moves to the top (keeping its pin); unpinned ones past RECENT_MODELS drop off. */
function rememberModel(history = [], id) {
  const was = history.find((h) => h.id === id);
  const list = [{ id, pinned: Boolean(was?.pinned) }, ...history.filter((h) => h.id !== id)];
  let unpinned = 0;
  return list.filter((h) => h.pinned || ++unpinned <= RECENT_MODELS);
}

/**
 * The picker's list for an empty box: pinned first, then the recent ones, each as the model list has it (price,
 * thinking) or as typed when it isn't listed; `head` names the section its first row opens.
 */
function historyModels(models, history = []) {
  const rows = (pinned) => history.filter((h) => Boolean(h.pinned) === pinned)
    .map((h, k) => ({ ...(models.find((m) => m.id === h.id) || { id: h.id, price: null }), history: h, head: k === 0 ? t(pinned ? "model.pinned" : "model.recent") : "" }));
  return [...rows(true), ...rows(false)];
}

/**
 * Model picker suggestions: every space-separated term must appear in the id. A typed name that
 * isn't listed is offered first, so aliases such as `~google/gemini-flash-latest` can be used.
 */
function filterModels(models, query, latestOnly) {
  const typed = query.trim();
  const terms = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = models.filter((m) => (!latestOnly || m.id.includes("latest"))
    && terms.every((term) => m.id.toLowerCase().includes(term)));
  const exact = models.some((m) => m.id === typed);
  return typed && !exact && !/\s/.test(typed) ? [{ id: typed, price: null, custom: true }, ...matches] : matches;
}

/**
 * The translation instructions you can change in settings ({language}: the target language). The reply format
 * and the text itself are added after them and stay fixed, so a changed prompt can't break the answer's parsing.
 */
const DEFAULT_PROMPTS = {
  description: "Translate each of the following Obsidian plugin descriptions into {language}.\nKeep product names, code and technical terms (Markdown, Canvas, Bases, API…) as they are.\nDon't add anything.",
  readme: "Translate this part of an Obsidian plugin's README (Markdown) into {language}.\nKeep the Markdown exactly: headings, lists, tables, links, image URLs and HTML tags.\nDon't translate code blocks, inline code, commands, settings keys or product names.\nDon't add anything.",
};

/** Your instructions for one kind of translation (or the default), with the language filled in. */
function promptInstructions(prompts, kind, targetLanguage) {
  return (prompts?.[kind]?.trim() || DEFAULT_PROMPTS[kind]).replaceAll("{language}", targetLanguage);
}

/** Batch translation prompt: several descriptions in one request, answered as a JSON array. */
function translationPrompt(texts, targetLanguage, prompts) {
  return [
    promptInstructions(prompts, "description", targetLanguage),
    "Reply with ONLY a JSON array of strings, same length and same order as the input. No commentary.",
    "",
    JSON.stringify(texts),
  ].join("\n");
}

/** Extracts the first parseable JSON array/object from a model reply (tolerates fences and surrounding prose). */
function extractJson(reply, open, close, errKey) {
  const fenced = reply.match(/```(?:json)?\r?\n([\s\S]*?)\r?\n```/i);
  const candidates = fenced ? [fenced[1], reply] : [reply];
  for (const src of candidates) {
    const end = src.lastIndexOf(close);
    if (end === -1) continue;
    for (let pos = src.indexOf(open); pos !== -1 && pos < end; pos = src.indexOf(open, pos + 1)) {
      try { return JSON.parse(src.slice(pos, end + 1)); } catch { /* try next opener */ }
    }
  }
  throw new ReplyError(t(errKey));
}

/** Extracts the translations from the model's reply (code fences and surrounding text are tolerated). */
function parseTranslations(reply, expected) {
  const list = extractJson(String(reply ?? ""), "[", "]", "error.noJsonArray");
  if (!Array.isArray(list) || list.length !== expected || !list.every((s) => typeof s === "string")) {
    throw new ReplyError(t("error.countMismatch", { expected, got: Array.isArray(list) ? list.length : "?" }));
  }
  if (list.some((s) => !s.trim())) throw new ReplyError(t("error.emptyText"));   // only texts with words are sent
  return list.map((s) => s.trim());
}


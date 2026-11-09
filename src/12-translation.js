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
      body: { model, max_tokens: 4096, messages: [{ role: "user", content: prompt }] },
    }),
    text: (json) => (json.content || []).map((part) => part.text || "").join(""),
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
    models: (key) => ({ url: "https://api.openai.com/v1/models", headers: { Authorization: `Bearer ${key}` } }),
    modelList: (json) => (json.data || []).filter((m) => /^(gpt|o\d|chatgpt)/.test(m.id)).map((m) => ({ id: m.id, price: null })),
  },
  gemini: {
    label: "Gemini (Google)",
    chat: (model, key, prompt) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      headers: { "x-goog-api-key": key },
      body: { contents: [{ parts: [{ text: prompt }] }] },
    }),
    text: (json) => (json.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join(""),
    models: (key) => ({ url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", headers: { "x-goog-api-key": key } }),
    modelList: (json) => (json.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => ({ id: m.name.replace(/^models\//, ""), price: null })),
  },
  openrouter: {
    label: "OpenRouter",
    chat: (model, key, prompt) => ({
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: { Authorization: `Bearer ${key}` },
      body: { model, messages: [{ role: "user", content: prompt }] },
    }),
    text: (json) => json.choices?.[0]?.message?.content || "",
    models: (key) => ({ url: "https://openrouter.ai/api/v1/models", headers: { Authorization: `Bearer ${key}` } }),
    modelList: (json) => (json.data || []).map((m) => ({ id: m.id, price: tokenPrice(m.pricing) })),
  },
};

/** OpenRouter price (USD per token, as text) → {input, output} per 1M tokens; null if unreadable. */
function tokenPrice(pricing) {
  const input = Number(pricing?.prompt) * 1e6;
  const output = Number(pricing?.completion) * 1e6;
  return Number.isFinite(input) && Number.isFinite(output) ? { input, output } : null;
}

/** "$0.30 / $2.50 · 1M tokens" (input / output); free models say so. */
function formatPrice(price) {
  if (!price) return "";
  if (!price.input && !price.output) return t("model.free");
  const usd = (n) => `$${new Intl.NumberFormat(t("locale"), { minimumFractionDigits: n < 10 ? 2 : 1, maximumFractionDigits: n < 10 ? 2 : 1 }).format(n)}`;
  return `${usd(price.input)} / ${usd(price.output)} · ${t("price.unit")}`;
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
  description: "Translate each of the following Obsidian plugin descriptions into {language}.\nKeep product names, code and technical terms (Markdown, Canvas, Bases, API…) as they are.",
  readme: "Translate this part of an Obsidian plugin's README (Markdown) into {language}.\nKeep the Markdown exactly: headings, lists, tables, links, image URLs and HTML tags.\nDon't translate code blocks, inline code, commands, settings keys or product names.",
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

/** Extracts the translations from the model's reply (code fences and surrounding text are tolerated). */
function parseTranslations(reply, expected) {
  const start = reply.indexOf("[");
  const end = reply.lastIndexOf("]");
  if (start === -1 || end <= start) throw new Error(t("error.noJsonArray"));
  const list = JSON.parse(reply.slice(start, end + 1));
  if (!Array.isArray(list) || list.length !== expected || !list.every((s) => typeof s === "string")) {
    throw new Error(t("error.countMismatch", { expected, got: Array.isArray(list) ? list.length : "?" }));
  }
  return list.map((s) => s.trim());
}


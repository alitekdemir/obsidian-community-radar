"use strict";
/*
 * Plugin Radar — discover community plugins, spot the ones that woke up after a long pause,
 * and track the ones you care about as notes. Plain JavaScript, no build step.
 *
 * Layers (each depends only on the ones above it):
 *   1. Constants and i18n
 *   2. Core: pure functions (dates, text, catalog, release history, discovery, README, translation)
 *   3. Services: GitHub client, cache, notes, translator
 *   4. UI: modals, discovery view, settings tab
 *   5. Plugin class: wires everything together
 */
const obsidian = require("obsidian");
const {
  Plugin, ItemView, Notice, SuggestModal, PluginSettingTab, Setting,
  TFile, Menu, addIcon, normalizePath, requestUrl, setIcon,
} = obsidian;

// ─── 1. Constants ───────────────────────────────────────────────────────────
const VIEW_TYPE = "plugin-radar-view";
const ICON = "plugin-radar";
const LEGACY_PLUGIN_ID = "plugin-discovery-tracker";  // the plugin's earlier private name
const REPO = "obsidianmd/obsidian-releases";
const STATS_FILE = "community-plugin-stats.json";
const RAW = "https://raw.githubusercontent.com";
const LISTING_URL = `${RAW}/${REPO}/HEAD/community-plugins.json`;
const STATS_URL = `${RAW}/${REPO}/HEAD/${STATS_FILE}`;
const COMMITS_API = `https://api.github.com/repos/${REPO}/commits`;

const DAY_MS = 86_400_000;
const MONTH_MS = 30.44 * DAY_MS;
const HISTORY_MONTHS = [3, 6, 12, 24];
const DAILY_DAYS = 30;             // snapshots are daily for this many days, weekly before that
const RELEASES_CAP = 50;           // release dates kept per plugin
const NEW_BADGE_DAYS = 30;         // ✨ badge: listed within this many days
const PARALLEL = 4;                // snapshots downloaded at once
const CATALOG_MAX_AGE_MS = DAY_MS; // the view refreshes a catalog older than this on open
const PAGE_SIZE = 50;
const TIMELINE_VERSION = 2;        // 2: first-seen dates added

// Marker comments are kept from the earlier version so existing notes keep working.
const README_START = "<!-- plugin-tracker:readme-start -->";
const README_END = "<!-- plugin-tracker:readme-end -->";
const UNREVIEWED_NOTE = /\s*-?\s*This plugin has not been manually reviewed by Obsidian staff\.?\s*/gi;

const MODE_KEYS = ["all", "new", "updated", "awakened", "changed", "suggested"];

/** Suggested names in Obsidian's keychain (ANTHROPIC_API_KEY → anthropic-api-key). */
const KEY_NAMES = {
  anthropic: "anthropic-api-key",
  openai: "openai-api-key",
  gemini: "gemini-api-key",
  openrouter: "openrouter-api-key",
};

/** Radar: two range rings, a sweep line and a blip. Drawn on Lucide's 24-unit grid, scaled to Obsidian's 100. */
const ICON_SVG = `<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M4 4a16 16 0 0 1 16 16"/><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 20 14.5 9.5"/>
<circle cx="4" cy="20" r="1.6" fill="currentColor" stroke="none"/><circle cx="16.5" cy="14" r="2" fill="currentColor" stroke="none"/></g>`;

// ─── i18n ───────────────────────────────────────────────────────────────────
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const STRINGS = {
  en: {
    locale: "en-US",
    "unit.million": "M", "unit.thousand": "K", "unit.thousandSpace": "",
    "age.justNow": "just now",
    "age.minutes": ({ n }) => `${n} min ago`,
    "age.hours": ({ n }) => `${n} h ago`,
    "age.days": ({ n }) => `${plural(n, "day", "days")} ago`,
    "rel.today": "today", "rel.yesterday": "yesterday",
    "rel.days": ({ n }) => `${n} days ago`,
    "rel.months": ({ n }) => `${plural(n, "month", "months")} ago`,
    "rel.years": ({ n }) => `${n} years ago`,
    "history.label": ({ months }) => (months === 12 ? "last year" : months === 24 ? "last 2 years" : `last ${months} months`),
    untitled: "Untitled",

    "mode.all": "All", "mode.new": "✨ New", "mode.updated": "Updated", "mode.awakened": "Awakened",
    "mode.changed": "🔄 Changed", "mode.suggested": "Suggestions",
    "tip.all": "Every community plugin; sort and search freely",
    "tip.new": ({ days }) => `Plugins listed in the last ${days} days`,
    "tip.updated": ({ days }) => `Plugins updated in the last ${days} days`,
    "tip.awakened": ({ days, gap }) => `Updated in the last ${days} days, at least ${gap} days after their previous release`,
    "tip.changed": "Tracked plugins with a new release since you last reviewed them",
    "tip.suggested": "Installed plugins you haven't starred yet",

    "filter.last": "Last", "filter.gap": "Gap ≥", "filter.downloads": "Downloads ≥", "filter.sort": "Sort",
    "filter.days": ({ n }) => `${n} days`,
    "sort.downloads": "downloads", "sort.updated": "last update", "sort.name": "name", "sort.listed": "newest listed",
    "search.placeholder": "search… (comma = and)",
    "translate.visible": ({ n }) => `Translate visible (${n})`,
    "translate.pending": ({ pending, done }) => `${pending} descriptions in one request; ${done} already translated`,
    "translate.allDone": "All translated; show translations",
    "translate.row": "Translate", "translate.hide": "Hide",
    "changed.markAll": "Mark all reviewed",

    "status.loading": "Loading catalog…",
    "status.plugins": ({ n }) => `${n} plugins`,
    "status.data": ({ age }) => `data ${age}`,
    "status.history": ({ label }) => `history: ${label}`,
    "status.noHistory": "no history yet",
    "status.query": ({ q }) => `filtered by "${q}"`,
    "status.clear": "✕ clear",
    "status.build": "Build release history",
    "status.rebuild": "Rebuild history (for listing dates)",
    "status.refresh": "Refresh data",

    "list.needHistory": "Build the release history first to find plugins that were updated after a long pause.",
    "list.legacyHint": "Listing dates come from the release history. Until it is rebuilt, only plugins without published stats show up here.",
    "list.empty": "No plugins match this filter.",
    "list.more": ({ n, total, shown }) => `Show ${n} more  ·  ${shown} of ${total}`,

    "badge.new": "✨ new", "badge.changed": "🔄 changed", "badge.installed": "installed", "badge.note": "📝 note",
    "badge.openNote": "Open tracking note",
    "row.updated": ({ when }) => `updated ${when}`,
    "row.added": ({ when }) => `listed ${when}`,
    "row.justListed": "just listed",
    "row.gap": ({ n }) => `after ${plural(n, "day", "days")}`,
    "row.firstRelease": "first recorded release",
    "row.noStats": "no stats yet",
    "row.downloads": ({ n }) => `${n} downloads`,
    "action.favorite": "Star", "action.unfavorite": "Unstar",
    "action.group": "Add to group", "action.groupNamed": ({ group }) => `Group: ${group}`,
    "action.exclude": "Exclude", "action.dismiss": "Don't suggest", "action.reviewed": "Reviewed",

    "group.placeholder": "Type or choose a group",
    "group.placeholderCurrent": ({ group }) => `Group: ${group} (type to change)`,
    "group.new": ({ name }) => `＋ New group: ${name}`,
    "json.placeholder": "Choose the tracker.json you exported from the Colab notebook",

    "model.placeholder": "Search models… (any text you type can be used as a model name)",
    "model.custom": ({ name }) => `Use this name: ${name}`,
    "model.latestOnly": "Only “latest”",
    "model.free": "free",
    "price.unit": "1M tokens",

    "notice.busy": "Another task is running; please wait for it to finish.",
    "notice.refreshing": "Plugin Radar: refreshing data",
    "notice.downloadingCatalog": "Downloading catalog…",
    "notice.updatingNotes": "Updating tracking notes…",
    "notice.refreshed": ({ n, released }) => `Plugin Radar: ${n} plugins · ${released} tracked notes have a new release${released ? " (README updated)" : ""}`,
    "notice.history": "Plugin Radar: release history",
    "notice.listingSnapshots": "Listing snapshots…",
    "notice.snapshotProgress": ({ done, total, date }) => `${done}/${total} snapshots · ${date}`,
    "notice.historyDone": ({ label, from, to, n }) => `Plugin Radar: history ${label} · ${from} → ${to} · ${n} snapshots processed`,
    "notice.historyCurrent": "Plugin Radar: history is up to date",
    "notice.readme": "Plugin Radar: README",
    "notice.readmeProgress": ({ done, total }) => `README ${done}/${total}`,
    "notice.readmeDone": ({ n }) => `Plugin Radar: ${n} READMEs updated`,
    "notice.notTracking": "This note isn't a Plugin Radar note (no plugin_id).",
    "notice.translating": ({ n }) => `Translating ${n} descriptions…`,
    "notice.translateFailed": ({ error }) => `Translation failed ✖\n${error}`,
    "notice.translateSetup": "To translate, pick a provider, an API key and a model in Settings → Plugin Radar → Description translation.",
    "notice.favorite": ({ star, name, created }) => `${star} ${name}${created ? " · note created" : ""}`,
    "notice.grouped": ({ name, group, created }) => `📌 ${name} → ${group}${created ? " · note created" : ""}`,
    "notice.excluded": ({ name }) => `⊘ ${name} excluded (undo in settings)`,
    "notice.headings": ({ n }) => `Plugin Radar: "Notes" and "README" headings set to H1 in ${n} notes.`,
    "notice.keysMoved": ({ n, example }) => `Plugin Radar: ${n} API keys copied to the shared name (e.g. ${example}).`,
    "notice.legacyImported": "Plugin Radar: settings and cache imported from the earlier version. You can remove the old plugin folder.",
    "notice.import": "Plugin Radar: import",
    "notice.importNote": ({ done, total }) => `Note ${done}/${total}`,
    "notice.importDone": ({ notes, excluded, missing }) => `Plugin Radar: ${notes} notes · ${excluded} excluded · ${missing} not in catalog`,
    "notice.jsonError": ({ error }) => `Couldn't read JSON: ${error}`,
    "notice.rateLimit": "GitHub rate limit reached (60 requests per hour). Try again in an hour.",
    "notice.modelsFailed": ({ error }) => `Couldn't load models: ${error}`,
    "notice.modelOk": ({ model, sample }) => `✓ ${model} answered: “${sample}”`,
    "notice.modelFailed": ({ error }) => `Model test failed ✖\n${error}`,

    "cmd.open": "Open plugin discovery",
    "cmd.refresh": "Refresh data (catalog, history, notes)",
    "cmd.rebuild": "Rebuild release history",
    "cmd.readmeCurrent": "Update README of this note",
    "cmd.readmeAll": "Update READMEs of all tracking notes",
    "cmd.import": "Import from the Colab notebook (tracker.json)",
    "view.title": "Plugin discovery",

    "set.folder": "Notes folder", "set.folderDesc": "Notes for the plugins you track are created here.",
    "set.history": "Release history", "set.depth": "History depth",
    "set.depthDesc": ({ label, from, to }) => `Built: ${label} (${from} → ${to}). Use “Rebuild” after increasing the depth.`,
    "set.notBuilt": "Not built yet.", "set.rebuild": "Rebuild",
    "set.translation": "Description translation",
    "set.needsKeychain": "Translation needs Obsidian 1.11.4 or later to keep the API key in Obsidian's keychain.",
    "set.provider": "Provider", "set.none": "None",
    "set.key": "API key",
    "set.keyDesc": ({ name, found }) => `Pick from Obsidian's keychain or add a new one. Suggested name: ${name} — plugins using the same name share the key. ${found ? "✓ Key found." : "No key yet."}`,
    "set.model": "Model",
    "set.modelPrice": ({ price }) => `Price (input / output): ${price}.`,
    "set.modelPick": "Choose model", "set.modelTest": "Test model",
    "set.modelHint": "Type to filter; names that aren't listed (e.g. ~google/gemini-flash-latest on OpenRouter) can be used as typed.",
    "set.noPrices": "This provider's model list has no prices.",
    "set.targetLang": "Target language",
    "set.saved": "Saved translations",
    "set.savedDesc": ({ n }) => `${n} descriptions. Deleting them means they'll be translated (and billed) again.`,
    "set.delete": "Delete",
    "set.excluded": ({ n }) => `Excluded (${n})`,
    "set.dismissed": ({ n }) => `Installed plugins not to suggest (${n})`,
    "set.restore": "Restore",

    "readme.meta": ({ repo, version, date }) => `> README · ${repo} · ${version} · fetched ${date}`,
    "readme.noVersion": "no version yet",
    "readme.failed": "_Couldn't fetch the README. Try “Update README of this note” from the command palette._",
    "note.myNotes": "My notes",
    "error.noJsonArray": "No JSON array in the translation reply.",
    "error.countMismatch": ({ expected, got }) => `Translation count mismatch (expected ${expected}, got ${got}).`,
    "error.noKey": ({ name }) => `Pick or add the API key named “${name}” first.`,
    "provider.generic": "Provider",
  },

  tr: {
    locale: "tr-TR",
    "unit.million": "Mn", "unit.thousand": "bin", "unit.thousandSpace": " ",
    "age.justNow": "az önce",
    "age.minutes": ({ n }) => `${n} dk önce`,
    "age.hours": ({ n }) => `${n} sa önce`,
    "age.days": ({ n }) => `${n} gün önce`,
    "rel.today": "bugün", "rel.yesterday": "dün",
    "rel.days": ({ n }) => `${n} gün önce`,
    "rel.months": ({ n }) => `${n} ay önce`,
    "rel.years": ({ n }) => `${n} yıl önce`,
    "history.label": ({ months }) => (months === 12 ? "son 1 yıl" : months === 24 ? "son 2 yıl" : `son ${months} ay`),
    untitled: "Adsız",

    "mode.all": "Tümü", "mode.new": "✨ Yeni", "mode.updated": "Güncellenen", "mode.awakened": "Uyananlar",
    "mode.changed": "🔄 Değişenler", "mode.suggested": "Öneriler",
    "tip.all": "Bütün topluluk eklentileri; serbestçe sıralayın ve arayın",
    "tip.new": ({ days }) => `Son ${days} günde listeye giren eklentiler`,
    "tip.updated": ({ days }) => `Son ${days} günde güncellenen eklentiler`,
    "tip.awakened": ({ days, gap }) => `Son ${days} günde, önceki sürümden en az ${gap} gün sonra güncellenenler`,
    "tip.changed": "Takip ettiklerinizden, incelediğiniz günden sonra yeni sürüm çıkaranlar",
    "tip.suggested": "Kurulu olan ama henüz favori yapmadığınız eklentiler",

    "filter.last": "Son", "filter.gap": "Ara ≥", "filter.downloads": "İndirme ≥", "filter.sort": "Sırala",
    "filter.days": ({ n }) => `${n} gün`,
    "sort.downloads": "indirme", "sort.updated": "son güncelleme", "sort.name": "ad", "sort.listed": "listeye giriş",
    "search.placeholder": "ara… (virgül = ve)",
    "translate.visible": ({ n }) => `Görünenleri çevir (${n})`,
    "translate.pending": ({ pending, done }) => `${pending} açıklama tek istekte çevrilir; ${done} tanesi zaten çevrilmiş`,
    "translate.allDone": "Hepsi zaten çevrilmiş; çevirileri göster",
    "translate.row": "Çevir", "translate.hide": "Gizle",
    "changed.markAll": "Hepsini incelendi say",

    "status.loading": "Katalog yükleniyor…",
    "status.plugins": ({ n }) => `${n} eklenti`,
    "status.data": ({ age }) => `veri ${age}`,
    "status.history": ({ label }) => `geçmiş: ${label}`,
    "status.noHistory": "geçmiş kurulmadı",
    "status.query": ({ q }) => `"${q}" araması uygulanıyor`,
    "status.clear": "✕ temizle",
    "status.build": "Sürüm geçmişini kur",
    "status.rebuild": "Geçmişi yeniden kur (yeni eklenti tarihleri için)",
    "status.refresh": "Veriyi yenile",

    "list.needHistory": "Uzun aradan sonra güncellenenleri bulmak için önce sürüm geçmişini kurun.",
    "list.legacyHint": "Eklentilerin listeye giriş tarihleri sürüm geçmişinden çıkarılır. Şimdilik yalnızca istatistiği henüz yayımlanmamış eklentiler görünüyor.",
    "list.empty": "Bu filtreyle eşleşen eklenti yok.",
    "list.more": ({ n, total, shown }) => `${n} tane daha göster  ·  ${total} içinden ${shown}`,

    "badge.new": "✨ yeni", "badge.changed": "🔄 değişti", "badge.installed": "kurulu", "badge.note": "📝 not",
    "badge.openNote": "Takip notunu aç",
    "row.updated": ({ when }) => `${when} güncellendi`,
    "row.added": ({ when }) => `${when} eklendi`,
    "row.justListed": "yeni listelendi",
    "row.gap": ({ n }) => `${n} gün aradan sonra`,
    "row.firstRelease": "ilk kayıtlı sürüm",
    "row.noStats": "istatistik yok",
    "row.downloads": ({ n }) => `${n} indirme`,
    "action.favorite": "Favori", "action.unfavorite": "Favoriden çıkar",
    "action.group": "Gruba ekle", "action.groupNamed": ({ group }) => `Grup: ${group}`,
    "action.exclude": "Dışla", "action.dismiss": "Önerme", "action.reviewed": "İnceledim",

    "group.placeholder": "Grup adı yazın ya da seçin",
    "group.placeholderCurrent": ({ group }) => `Grup: ${group} (değiştirmek için yazın)`,
    "group.new": ({ name }) => `＋ Yeni grup: ${name}`,
    "json.placeholder": "Colab'dan indirdiğiniz tracker.json dosyasını seçin",

    "model.placeholder": "Model ara… (yazdığınız her ad model adı olarak kullanılabilir)",
    "model.custom": ({ name }) => `Bu adı kullan: ${name}`,
    "model.latestOnly": "Yalnızca “latest”",
    "model.free": "ücretsiz",
    "price.unit": "1M token",

    "notice.busy": "Başka bir işlem sürüyor, bitmesini bekleyin.",
    "notice.refreshing": "Plugin Radar: veri yenileniyor",
    "notice.downloadingCatalog": "Katalog indiriliyor…",
    "notice.updatingNotes": "Takip notları güncelleniyor…",
    "notice.refreshed": ({ n, released }) => `Plugin Radar: ${n} eklenti · ${released} takip notunda yeni sürüm${released ? " (README güncellendi)" : ""}`,
    "notice.history": "Plugin Radar: sürüm geçmişi",
    "notice.listingSnapshots": "Anlık görüntü listesi alınıyor…",
    "notice.snapshotProgress": ({ done, total, date }) => `${done}/${total} anlık görüntü · ${date}`,
    "notice.historyDone": ({ label, from, to, n }) => `Plugin Radar: geçmiş ${label} · ${from} → ${to} · ${n} anlık görüntü işlendi`,
    "notice.historyCurrent": "Plugin Radar: geçmiş zaten güncel",
    "notice.readme": "Plugin Radar: README",
    "notice.readmeProgress": ({ done, total }) => `README ${done}/${total}`,
    "notice.readmeDone": ({ n }) => `Plugin Radar: ${n} README güncellendi`,
    "notice.notTracking": "Bu not bir Plugin Radar notu değil (plugin_id yok).",
    "notice.translating": ({ n }) => `Çevriliyor: ${n} açıklama…`,
    "notice.translateFailed": ({ error }) => `Çeviri başarısız ✖\n${error}`,
    "notice.translateSetup": "Çeviri için Ayarlar → Plugin Radar → Açıklama çevirisi bölümünden sağlayıcı, API anahtarı ve model seçin.",
    "notice.favorite": ({ star, name, created }) => `${star} ${name}${created ? " · not oluşturuldu" : ""}`,
    "notice.grouped": ({ name, group, created }) => `📌 ${name} → ${group}${created ? " · not oluşturuldu" : ""}`,
    "notice.excluded": ({ name }) => `⊘ ${name} dışlandı (ayarlardan geri alınır)`,
    "notice.headings": ({ n }) => `Plugin Radar: ${n} notta "Notlarım" ve "README" başlıkları H1 yapıldı.`,
    "notice.keysMoved": ({ n, example }) => `Plugin Radar: ${n} API anahtarı önerilen ortak ada kopyalandı (ör. ${example}).`,
    "notice.legacyImported": "Plugin Radar: ayarlar ve önbellek önceki sürümden (Eklenti Takip) aktarıldı. Eski eklenti klasörünü silebilirsiniz.",
    "notice.import": "Plugin Radar: içe aktarma",
    "notice.importNote": ({ done, total }) => `Not ${done}/${total}`,
    "notice.importDone": ({ notes, excluded, missing }) => `Plugin Radar: ${notes} not · ${excluded} dışlandı · ${missing} katalogda yok`,
    "notice.jsonError": ({ error }) => `JSON okunamadı: ${error}`,
    "notice.rateLimit": "GitHub istek sınırına ulaşıldı (saatte 60). Bir saat sonra tekrar deneyin.",
    "notice.modelsFailed": ({ error }) => `Modeller alınamadı: ${error}`,
    "notice.modelOk": ({ model, sample }) => `✓ ${model} yanıt verdi: “${sample}”`,
    "notice.modelFailed": ({ error }) => `Model denemesi başarısız ✖\n${error}`,

    "cmd.open": "Eklenti keşfini aç",
    "cmd.refresh": "Veriyi yenile (katalog, geçmiş, notlar)",
    "cmd.rebuild": "Sürüm geçmişini baştan kur",
    "cmd.readmeCurrent": "Bu notun README'sini güncelle",
    "cmd.readmeAll": "Tüm takip notlarının README'lerini güncelle",
    "cmd.import": "Colab verisini içe aktar (tracker.json)",
    "view.title": "Eklenti keşfi",

    "set.folder": "Not klasörü", "set.folderDesc": "Takip ettiğiniz eklentilerin notları bu klasörde oluşur.",
    "set.history": "Sürüm geçmişi", "set.depth": "Geçmiş derinliği",
    "set.depthDesc": ({ label, from, to }) => `Kurulu: ${label} (${from} → ${to}). Derinliği artırdıysanız "Baştan kur" ile yeniden kurun.`,
    "set.notBuilt": "Henüz kurulmadı.", "set.rebuild": "Baştan kur",
    "set.translation": "Açıklama çevirisi",
    "set.needsKeychain": "Çeviri, API anahtarını Obsidian'ın anahtar deposunda tutmak için Obsidian 1.11.4 veya üstünü gerektirir.",
    "set.provider": "Sağlayıcı", "set.none": "Seçilmedi",
    "set.key": "API anahtarı",
    "set.keyDesc": ({ name, found }) => `Obsidian'ın anahtar deposundan seçin ya da yeni ekleyin. Önerilen ad: ${name} — aynı adı kullanan eklentiler anahtarı paylaşır. ${found ? "✓ Anahtar bulundu." : "Henüz anahtar yok."}`,
    "set.model": "Model",
    "set.modelPrice": ({ price }) => `Fiyat (giriş / çıkış): ${price}.`,
    "set.modelPick": "Model seç", "set.modelTest": "Modeli dene",
    "set.modelHint": "Yazarak filtreleyin; listede olmayan adlar (ör. OpenRouter'da ~google/gemini-flash-latest) yazıldığı gibi kullanılabilir.",
    "set.noPrices": "Bu sağlayıcının model listesi fiyat bilgisi vermiyor.",
    "set.targetLang": "Hedef dil",
    "set.saved": "Kayıtlı çeviriler",
    "set.savedDesc": ({ n }) => `${n} açıklama. Silinirse yeniden çevrilir (ücretlendirilir).`,
    "set.delete": "Sil",
    "set.excluded": ({ n }) => `Dışlananlar (${n})`,
    "set.dismissed": ({ n }) => `Önerilmeyecek kurulu eklentiler (${n})`,
    "set.restore": "Geri al",

    "readme.meta": ({ repo, version, date }) => `> README · ${repo} · ${version} · alındı: ${date}`,
    "readme.noVersion": "sürüm henüz yok",
    "readme.failed": "_README alınamadı. Komut paletinden 'Bu notun README'sini güncelle' ile tekrar deneyin._",
    "note.myNotes": "Notlarım",
    "error.noJsonArray": "Çeviri yanıtında JSON dizisi bulunamadı.",
    "error.countMismatch": ({ expected, got }) => `Çeviri sayısı uyuşmuyor (beklenen ${expected}, gelen ${got}).`,
    "error.noKey": ({ name }) => `Önce "${name}" adlı API anahtarını seçin ya da ekleyin.`,
    "provider.generic": "Sağlayıcı",
  },
};

let language = "en";

/** Picks the UI language: Turkish when Obsidian runs in Turkish, English otherwise. */
function setLanguage(code) {
  language = String(code || "").toLowerCase().startsWith("tr") ? "tr" : "en";
  return language;
}

/** Looks up a UI string; falls back to English, then to the key itself. */
function t(key, vars = {}) {
  const value = STRINGS[language][key] ?? STRINGS.en[key] ?? key;
  return typeof value === "function" ? value(vars) : value;
}

function defaultSettings() {
  return {
    folder: language === "tr" ? "Eklentiler" : "Plugin Radar",
    mode: "awakened",
    days: 14,
    dormantDays: 90,
    minDownloads: 100,
    sort: "downloads",
    query: "",
    historyMonths: 12,
    provider: "",
    model: "",
    modelPrice: "",
    keyNames: {},
    targetLang: language === "tr" ? "Türkçe" : "English",
  };
}

// ─── 2. Core: pure functions ────────────────────────────────────────────────
/** @param {number} ms @returns {string} YYYY-MM-DD in local time */
function dayString(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Monday of the ISO week (UTC), used as a bucket key. */
function weekKey(ms) {
  const d = new Date(ms);
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY_MS;
  return new Date(monday).toISOString().slice(0, 10);
}

function decimal(value, digits = 1) {
  return new Intl.NumberFormat(t("locale"), { maximumFractionDigits: digits }).format(value);
}

/** 1234567 → "1,234,567" (en) / "1.234.567" (tr); missing → "–" */
function formatCount(value) {
  return value == null ? "–" : new Intl.NumberFormat(t("locale")).format(value);
}

/** 2575475 → "2.6M" / "2,6 Mn"; 354882 → "355K" / "355 bin" */
function formatShort(value) {
  if (value == null) return "–";
  const gap = t("unit.thousandSpace");
  if (value >= 1e6) return `${decimal(value / 1e6)}${language === "tr" ? " " : ""}${t("unit.million")}`;
  if (value >= 1e4) return `${Math.round(value / 1e3)}${gap}${t("unit.thousand")}`;
  if (value >= 1e3) return `${decimal(value / 1e3)}${gap}${t("unit.thousand")}`;
  return String(value);
}

function formatAge(ms) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return t("age.justNow");
  if (minutes < 60) return t("age.minutes", { n: minutes });
  if (minutes < 1440) return t("age.hours", { n: Math.floor(minutes / 60) });
  return t("age.days", { n: Math.floor(minutes / 1440) });
}

/** Relative date: today, yesterday, 12 days ago, 3 months ago, 1.5 years ago. */
function relativeDays(ms, now) {
  const days = Math.floor((now - ms) / DAY_MS);
  if (days <= 0) return t("rel.today");
  if (days === 1) return t("rel.yesterday");
  if (days < 60) return t("rel.days", { n: days });
  if (days < 365) return t("rel.months", { n: Math.round(days / 30) });
  return t("rel.years", { n: decimal(days / 365) });
}

function historyLabel(months) {
  return t("history.label", { months });
}

/** A valid note file name derived from a plugin name. */
function safeFileName(name) {
  return name.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "") || t("untitled");
}

/** Removes Obsidian's "not manually reviewed" note from a description. */
function cleanDescription(text) {
  return String(text || "").replace(UNREVIEWED_NOTE, " ").trim().replace(/^[-\s]+|[-\s]+$/g, "");
}

/**
 * Merges the listing and the stats file into one catalog (listing order: oldest → newest).
 * @returns {{id,name,author,repo,description,downloads,updated,version}[]}
 */
function parseCatalog(listing, stats) {
  const versionOf = (stat) => {
    const tags = Object.keys(stat).filter((k) => k !== "downloads" && k !== "updated" && /\d/.test(k));
    const key = (tag) => tag.replace(/^v/i, "").split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : -1));
    return tags.sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
      }
      return 0;
    }).pop() ?? null;
  };
  return listing.filter((e) => e && e.id).map((entry) => {
    const stat = stats[entry.id];
    const hasStats = stat && typeof stat.downloads === "number";
    return {
      id: String(entry.id),
      name: String(entry.name || entry.id),
      author: String(entry.author || ""),
      repo: String(entry.repo || ""),
      description: cleanDescription(entry.description),
      downloads: hasStats ? stat.downloads : null,
      updated: hasStats && stat.updated > 0 ? stat.updated : null,
      version: hasStats ? versionOf(stat) : null,
    };
  });
}

// ─── Release history ────────────────────────────────────────────────────────
/**
 * Release history: release dates per plugin (`releases`) and the day each plugin first appeared
 * (`firstSeen`). A `firstSeen` of 0 means the plugin was already listed when the archive starts.
 */
function newTimeline(months) {
  return { v: TIMELINE_VERSION, months, from: 0, to: 0, seeded: false, releases: {}, firstSeen: {} };
}

/** Upgrades a version-1 history (no first-seen dates); listing dates need a rebuild. */
function upgradeTimeline(timeline) {
  if (timeline.v === TIMELINE_VERSION) return timeline;
  return { ...newTimeline(12), ...timeline, v: TIMELINE_VERSION, firstSeen: {}, seeded: false, legacy: true };
}

/**
 * Picks the snapshots to download: daily for the last DAILY_DAYS days, weekly before that.
 * @param {{sha:string,date:number}[]} commits  oldest first
 */
function selectSnapshots(commits, now) {
  const picked = new Map();
  for (const commit of commits) {
    const recent = now - commit.date <= DAILY_DAYS * DAY_MS;
    const key = recent ? `d${dayString(commit.date)}` : `w${weekKey(commit.date)}`;
    picked.delete(key);         // same day/week: the latest commit wins, order is kept
    picked.set(key, commit);
  }
  return [...picked.values()];
}

/** Merges one snapshot into the history (release dates + first seen); returns the new releases. */
function mergeSnapshot(timeline, stats, date) {
  const { releases, firstSeen } = timeline;
  let added = 0;
  for (const [id, stat] of Object.entries(stats)) {
    if (!(id in firstSeen)) firstSeen[id] = timeline.seeded ? date : 0;
    const moment = stat && stat.updated;
    if (!Number.isInteger(moment) || moment <= 0) continue;
    const history = releases[id] || (releases[id] = []);
    if (history[history.length - 1] === moment) continue;
    history.push(moment);
    if (history.length > RELEASES_CAP) history.splice(0, history.length - RELEASES_CAP);
    added++;
  }
  timeline.seeded = true;
  return added;
}

/** Days between the current release and the previous one; null when the previous one is unknown. */
function dormantDays(releases, plugin) {
  if (!plugin.updated) return null;
  const earlier = (releases[plugin.id] || []).filter((m) => m < plugin.updated);
  return earlier.length ? Math.floor((plugin.updated - Math.max(...earlier)) / DAY_MS) : null;
}

/** Listed within the last `days` days? Plugins without published stats count as new too. */
function isNewPlugin(firstSeen, plugin, now, days = NEW_BADGE_DAYS) {
  const seen = firstSeen[plugin.id];
  if (seen === undefined) return plugin.downloads == null;
  return seen > 0 && now - seen <= days * DAY_MS;
}

/** Released again after the day you tracked or reviewed it? */
function isChanged(plugin, note) {
  return Boolean(note && note.reviewed && plugin.updated && dayString(plugin.updated) > String(note.reviewed));
}

/** Does the plugin contain every comma-separated term? */
function matchesQuery(plugin, query) {
  const haystack = `${plugin.id} ${plugin.name} ${plugin.author} ${plugin.description}`.toLowerCase();
  return query.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).every((s) => haystack.includes(s));
}

/**
 * Rows of the discovery view.
 * @param {object} state  {catalog, releases, firstSeen, notes: Map(id→note), excluded: Set, dismissed: Set, installed: Set}
 * @param {object} opts   {mode, days, dormantDays, minDownloads, sort, query}
 */
function discover(state, opts, now) {
  const { catalog, releases, firstSeen, notes, excluded, dismissed, installed } = state;
  const since = now - opts.days * DAY_MS;
  const base = (p) => !excluded.has(p.id) && matchesQuery(p, opts.query);
  const fresh = (p) => base(p) && !notes.has(p.id) && (p.downloads ?? 0) >= opts.minDownloads;
  const sort = opts.mode === "all" || opts.sort === "updated" ? opts.sort : "downloads";  // name/listed exist only in All

  switch (opts.mode) {
    case "all":   // browsing: tracked plugins stay visible (with their note badge), excluded ones don't
      return sortRows(catalog.filter((p) => base(p) && (p.downloads ?? 0) >= opts.minDownloads), sort, catalog);
    case "new":   // no download filter: a brand-new plugin has no downloads yet
      return catalog
        .filter((p) => base(p) && !notes.has(p.id) && isNewPlugin(firstSeen, p, now, opts.days))
        .sort((a, b) => (firstSeen[b.id] ?? Infinity) - (firstSeen[a.id] ?? Infinity));
    case "updated":
      return sortRows(catalog.filter((p) => fresh(p) && p.updated >= since), sort);
    case "awakened":
      return sortRows(catalog.filter((p) => fresh(p) && p.updated >= since
        && (dormantDays(releases, p) ?? -1) >= opts.dormantDays), sort);
    case "changed":
      return sortRows(catalog.filter((p) => base(p) && isChanged(p, notes.get(p.id))), sort);
    case "suggested":
      return sortRows(catalog.filter((p) => base(p) && installed.has(p.id) && !dismissed.has(p.id)
        && !(notes.get(p.id) || {}).favorite), sort);
    default:
      return [];
  }
}

/**
 * Sorts rows in place. "listed" uses the position in the official listing, which is the order
 * plugins were added; `catalog` is needed only for that. Unknown sort keys fall back to downloads.
 */
function sortRows(rows, sort, catalog = []) {
  const byDownloads = (a, b) => (b.downloads ?? 0) - (a.downloads ?? 0);
  switch (sort) {
    case "updated":
      return rows.sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
    case "name":
      return rows.sort((a, b) => a.name.localeCompare(b.name, t("locale"), { sensitivity: "base" }));
    case "listed": {
      const position = new Map(catalog.map((p, i) => [p.id, i]));
      return rows.sort((a, b) => (position.get(b.id) ?? -1) - (position.get(a.id) ?? -1));
    }
    default:
      return rows.sort(byDownloads);
  }
}

/** Row count of every mode (for the tab badges). */
function modeCounts(state, opts, now) {
  return Object.fromEntries(MODE_KEYS.map((mode) => [mode, discover(state, { ...opts, mode }, now).length]));
}

// ─── README and note body ───────────────────────────────────────────────────
/** What Obsidian treats as a tag: letters/digits/_-/ with at least one non-digit (`#123` is not a tag). */
const TAG = /(^|[\s>(])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

/** Escapes `#tags` and `[[links]]` in plain text; invisible in reading view. */
function escapeText(text) {
  return text
    .replace(TAG, (match, before, tag, offset) =>
      (before === "(" && text[offset - 1] === "]" ? match : `${before}\\#${tag}`))  // `](#section)` is a link target
    .replace(/\[\[/g, "\\[\\[");
}

/** Code blocks (indented ones too) and inline code are left untouched. */
function escapeOutsideCode(markdown) {
  let fence = null;
  return markdown.split("\n").map((line) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return line;
    }
    if (marker) { fence = marker[1]; return line; }
    if (/^( {4}|\t)/.test(line) && !/^\s*([-*+]|\d+[.)])\s/.test(line)) return line;  // indented code
    return line.split(/(`+[^`]*`+)/).map((chunk, i) => (i % 2 ? chunk : escapeText(chunk))).join("");
  }).join("\n");
}

/** Points relative images and links to GitHub. */
function absolutizeLinks(markdown, repo) {
  const rawBase = `${RAW}/${repo}/HEAD/`;
  const blobBase = `https://github.com/${repo}/blob/HEAD/`;
  const isRelative = (url) => url && !/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url);
  const join = (base, url) => base + url.replace(/^\.?\//, "");
  return markdown
    .replace(/(!?)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?((?:\s+"[^"]*")?)\s*\)/g, (all, bang, text, url, title) =>
      isRelative(url) ? `${bang}[${text}](${join(bang ? rawBase : blobBase, url)}${title})` : all)
    .replace(/(<img\b[^>]*?\bsrc=)(["'])([^"']+)\2/gi, (all, head, q, url) =>
      isRelative(url) ? `${head}${q}${join(rawBase, url)}${q}` : all)
    .replace(/(<a\b[^>]*?\bhref=)(["'])([^"']+)\2/gi, (all, head, q, url) =>
      isRelative(url) ? `${head}${q}${join(blobBase, url)}${q}` : all);
}

/** The README section of a note, markers included. */
function readmeSection(readme, plugin, now) {
  const version = plugin.version ? `v${plugin.version}` : t("readme.noVersion");
  const meta = t("readme.meta", { repo: plugin.repo, version, date: dayString(now) });
  const body = readme == null ? t("readme.failed") : escapeOutsideCode(absolutizeLinks(readme.trim(), plugin.repo));
  return `${README_START}\n${meta}\n\n${body}\n${README_END}`;
}

/** Replaces the README section; appends one when the markers are missing. Nothing else is touched. */
function replaceReadme(content, section) {
  const start = content.indexOf(README_START);
  const end = content.indexOf(README_END, start);
  if (start === -1 || end === -1) return `${content.replace(/\s*$/, "")}\n\n# README\n${section}\n`;
  return content.slice(0, start) + section + content.slice(end + README_END.length);
}

/** Body of a new tracking note (properties are written separately with processFrontMatter). */
function noteBody(plugin) {
  return `${plugin.description || ""}\n\n# ${t("note.myNotes")}\n\n\n# README\n${README_START}\n${README_END}\n`;
}

/** Turns the H2 headings of 0.1 notes into H1; touches no other line. */
function migrateHeadings(content) {
  return content
    .replace(/^## Notlarım[ \t]*$/m, "# Notlarım")
    .replace(/^## README[ \t]*\n(?=<!-- plugin-tracker:readme-start -->)/m, "# README\n");
}

/** Properties that come from the catalog; refreshed on every data refresh. */
function sourceFields(plugin) {
  return {
    downloads: plugin.downloads ?? null,
    version: plugin.version ?? null,
    updated: plugin.updated ? dayString(plugin.updated) : null,
    obsidian: `[plugin](obsidian://show-plugin?id=${encodeURIComponent(plugin.id)})`,
    github: plugin.repo ? `[github](https://github.com/${plugin.repo})` : null,
  };
}

/** Tracking record from a note's frontmatter (only notes with `plugin_id`). */
function noteFromFrontmatter(path, fm) {
  if (!fm || !fm.plugin_id) return null;
  return {
    path,
    id: String(fm.plugin_id),
    group: fm.group ? String(fm.group) : "",
    favorite: fm.favorite === true,
    note: fm.note ? String(fm.note) : "",
    reviewed: fm.reviewed ? String(fm.reviewed).slice(0, 10) : "",
    updated: fm.updated ? String(fm.updated).slice(0, 10) : "",
  };
}

/** Turns the Colab notebook's `tracker.json` into an import plan. */
function planImport(tracker, catalogIds, today) {
  const plan = { notes: [], excluded: [], missing: [] };
  for (const [id, entry] of Object.entries(tracker.entries || {})) {
    if (!catalogIds.has(id)) { plan.missing.push(id); continue; }
    if (entry.group === "dışla") { plan.excluded.push(id); continue; }
    plan.notes.push({
      id,
      group: entry.group || "",
      favorite: entry.favorite === true,
      note: entry.note || "",
      reviewed: String(entry.added || today).slice(0, 10),
    });
  }
  return plan;
}

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

/** Batch translation prompt: several descriptions in one request, answered as a JSON array. */
function translationPrompt(texts, targetLanguage) {
  return [
    `Translate each of the following Obsidian plugin descriptions into ${targetLanguage}.`,
    "Keep product names, code and technical terms (Markdown, Canvas, Bases, API…) as they are.",
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

/** Runs `worker` with limited concurrency; results keep the input order. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

const core = {
  setLanguage, t, defaultSettings, dayString, weekKey, formatCount, formatShort, formatAge, relativeDays,
  historyLabel, safeFileName, cleanDescription, parseCatalog, newTimeline, upgradeTimeline, selectSnapshots,
  mergeSnapshot, dormantDays, isNewPlugin, isChanged, matchesQuery, discover, modeCounts, escapeOutsideCode,
  absolutizeLinks, readmeSection, replaceReadme, noteBody, migrateHeadings, sourceFields, noteFromFrontmatter,
  planImport, PROVIDERS, KEY_NAMES, STRINGS, tokenPrice, formatPrice, filterModels, translationPrompt,
  parseTranslations, mapLimit,
  constants: { DAY_MS, MONTH_MS, DAILY_DAYS, RELEASES_CAP, NEW_BADGE_DAYS, README_START, README_END, TIMELINE_VERSION },
};

// ─── 3. Services ────────────────────────────────────────────────────────────
/** All GitHub requests. `requestUrl` isn't subject to CORS and works on mobile. */
class GitHub {
  async json(url) {
    const res = await requestUrl({ url, throw: false, headers: { Accept: "application/vnd.github+json" } });
    if (res.status === 403 || res.status === 429) throw new Error(t("notice.rateLimit"));
    if (res.status >= 400) throw new Error(`GitHub ${res.status}: ${url}`);
    return res.json;
  }

  async text(url) {
    const res = await requestUrl({ url, throw: false });
    return res.status < 400 ? res.text : null;
  }

  async catalog() {
    const [listing, stats] = await Promise.all([this.json(LISTING_URL), this.json(STATS_URL)]);
    return parseCatalog(listing, stats);
  }

  /** Commits that touched the stats file after `since`, oldest first. */
  async statsCommits(since) {
    const commits = [];
    for (let page = 1; ; page++) {
      const url = `${COMMITS_API}?path=${STATS_FILE}&since=${new Date(since).toISOString()}&per_page=100&page=${page}`;
      const batch = await this.json(url);
      commits.push(...batch.map((c) => ({ sha: c.sha, date: Date.parse(c.commit.committer.date) })));
      if (batch.length < 100) break;
    }
    return commits.filter((c) => c.date > since).sort((a, b) => a.date - b.date);
  }

  snapshot(sha) {
    return this.json(`${RAW}/${REPO}/${sha}/${STATS_FILE}`);
  }

  /** README: tries raw file names first (no rate limit), then falls back to the API (60/hour). */
  async readme(repo) {
    for (const name of ["README.md", "readme.md", "Readme.md", "README.MD"]) {
      const text = await this.text(`${RAW}/${repo}/HEAD/${name}`);
      if (text != null) return text;
    }
    const res = await requestUrl({
      url: `https://api.github.com/repos/${repo}/readme`,
      throw: false,
      headers: { Accept: "application/vnd.github.raw" },
    });
    return res.status < 400 ? res.text : null;
  }
}

/** Rebuildable cache files in the plugin folder. No personal data lives here. */
class Cache {
  constructor(adapter, dir) {
    this.adapter = adapter;
    this.dir = normalizePath(`${dir}/cache`);
  }

  path(name) {
    return `${this.dir}/${name}.json`;
  }

  async read(name, fallback) {
    try {
      return (await this.adapter.exists(this.path(name))) ? JSON.parse(await this.adapter.read(this.path(name))) : fallback;
    } catch (error) {
      console.warn(`[Plugin Radar] couldn't read the ${name} cache; it will be rebuilt`, error);
      return fallback;
    }
  }

  async write(name, value) {
    if (!(await this.adapter.exists(this.dir))) await this.adapter.mkdir(this.dir);
    await this.adapter.write(this.path(name), JSON.stringify(value));
  }
}

/** Tracking notes in the notes folder: index, creation, properties and README updates. */
class Notes {
  constructor(app, settings) {
    this.app = app;
    this.settings = settings;
    this.index = new Map();  // plugin id → record (noteFromFrontmatter)
  }

  get folder() {
    return normalizePath(this.settings.folder);
  }

  inFolder(file) {
    return file instanceof TFile && file.extension === "md" && file.path.startsWith(`${this.folder}/`);
  }

  files() {
    return this.app.vault.getMarkdownFiles().filter((file) => this.inFolder(file));
  }

  rebuild() {
    this.index.clear();
    for (const file of this.files()) this.refresh(file);
  }

  /** Mirrors edits made in Bases or by hand into the index. */
  refresh(file) {
    this.forget(file.path);
    if (!this.inFolder(file)) return;
    const note = noteFromFrontmatter(file.path, this.app.metadataCache.getFileCache(file)?.frontmatter);
    if (note) this.index.set(note.id, note);
  }

  forget(path) {
    for (const [id, note] of this.index) if (note.path === path) this.index.delete(id);
  }

  groups() {
    return [...new Set([...this.index.values()].map((n) => n.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, t("locale")));
  }

  file(id) {
    const note = this.index.get(id);
    const file = note && this.app.vault.getAbstractFileByPath(note.path);
    return file instanceof TFile ? file : null;
  }

  uniquePath(plugin) {
    const base = `${this.folder}/${safeFileName(plugin.name)}`;
    return this.app.vault.getAbstractFileByPath(`${base}.md`) ? `${base} (${safeFileName(plugin.id)}).md` : `${base}.md`;
  }

  /**
   * Creates or updates the note.
   * @param {object} patch  personal fields: {group?, favorite?, note?, reviewed?}
   * @returns {Promise<{file: TFile, created: boolean}>}
   */
  async upsert(plugin, patch) {
    let file = this.file(plugin.id);
    const created = !file;
    if (created) {
      if (!this.app.vault.getAbstractFileByPath(this.folder)) await this.app.vault.createFolder(this.folder);
      file = await this.app.vault.create(this.uniquePath(plugin), noteBody(plugin));
    }
    let written = {};
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (created) {
        Object.assign(fm, { plugin_id: plugin.id, group: "", favorite: false, note: "", reviewed: dayString(Date.now()) });
      }
      Object.assign(fm, patch, sourceFields(plugin));
      written = { ...fm };
    });
    this.index.set(plugin.id, noteFromFrontmatter(file.path, written));  // don't wait for metadataCache
    return { file, created };
  }

  /** Writes catalog fields only when they changed; returns true when the release date changed. */
  async syncSource(plugin) {
    const file = this.file(plugin.id);
    if (!file) return false;
    const fresh = sourceFields(plugin);
    const current = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    const changed = Object.entries(fresh).some(([key, value]) => String(current[key] ?? "") !== String(value ?? ""));
    if (changed) await this.app.fileManager.processFrontMatter(file, (fm) => Object.assign(fm, fresh));
    return String(current.updated ?? "").slice(0, 10) !== String(fresh.updated ?? "");
  }

  async writeReadme(file, plugin, readme) {
    const section = readmeSection(readme, plugin, Date.now());
    await this.app.vault.process(file, (content) => replaceReadme(content, section));
  }

  /** Sets the headings of 0.1 notes to H1; writes only the notes that change and returns their count. */
  async migrateHeadings() {
    let changed = 0;
    for (const file of this.files()) {
      const content = await this.app.vault.cachedRead(file);
      if (migrateHeadings(content) === content) continue;
      await this.app.vault.process(file, migrateHeadings);
      changed++;
    }
    return changed;
  }
}

/**
 * Description translation. The API key lives in Obsidian's keychain (SecretStorage); the plugin only
 * stores the key's NAME (e.g. "anthropic-api-key"), so plugins using the same name share it.
 */
class Translator {
  constructor(app, settings) {
    this.app = app;
    this.settings = settings;
  }

  get supported() {
    return Boolean(this.app.secretStorage && obsidian.SecretComponent);
  }

  keyName(provider = this.settings.provider) {
    return this.settings.keyNames?.[provider] || KEY_NAMES[provider] || "";
  }

  key(provider = this.settings.provider) {
    const name = this.keyName(provider);
    return name && this.app.secretStorage ? this.app.secretStorage.getSecret(name) : null;
  }

  get ready() {
    return Boolean(PROVIDERS[this.settings.provider] && this.settings.model && this.key());
  }

  async call({ url, headers, body }) {
    const res = await requestUrl({
      url,
      method: body ? "POST" : "GET",
      headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      throw: false,
    });
    if (res.status >= 400) {
      const detail = res.json?.error?.message || res.json?.error || res.text?.slice(0, 200);
      const label = PROVIDERS[this.settings.provider]?.label || t("provider.generic");
      throw new Error(`${label} ${res.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    }
    return res.json;
  }

  /** The provider's models: [{id, price}] (price only when the list has it). */
  async models(provider) {
    const spec = PROVIDERS[provider];
    const key = this.key(provider);
    if (!spec || !key) throw new Error(t("error.noKey", { name: this.keyName(provider) }));
    return spec.modelList(await this.call(spec.models(key))).sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Translates the texts in one request; output keeps the input order. */
  async translate(texts) {
    const spec = PROVIDERS[this.settings.provider];
    const request = spec.chat(this.settings.model, this.key(), translationPrompt(texts, this.settings.targetLang));
    return parseTranslations(spec.text(await this.call(request)), texts.length);
  }

  /** A one-line translation to confirm that the provider, key and model work together. */
  async test() {
    const [sample] = await this.translate(["A plugin that tracks new releases."]);
    return sample;
  }

  /** Copies keys saved under 0.2's plugin-specific names to the shared suggested names. */
  migrateLegacyKeys() {
    if (!this.app.secretStorage) return 0;
    let moved = 0;
    for (const provider of Object.keys(PROVIDERS)) {
      const legacy = this.app.secretStorage.getSecret(`plugin-tracker-${provider}-key`);
      if (legacy && !this.app.secretStorage.getSecret(KEY_NAMES[provider])) {
        this.app.secretStorage.setSecret(KEY_NAMES[provider], legacy);
        moved++;
      }
    }
    return moved;
  }
}

// ─── 4. UI ──────────────────────────────────────────────────────────────────
/** Obsidian's own tooltip (1.4.4+); falls back to the browser tooltip. */
const setTooltip = obsidian.setTooltip || ((el, text) => el.setAttribute("title", text));

function onActivate(el, handler) {
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handler(); }
  });
}

/** Obsidian's built-in icon button look (clickable-icon): transparent, highlighted on hover. */
function iconButton(parent, icon, tip, cls = "") {
  const button = parent.createDiv({ cls: `clickable-icon pdt-icon ${cls}`.trim(), attr: { "aria-label": tip, role: "button", tabindex: "0" } });
  setIcon(button, icon);
  setTooltip(button, tip);
  onActivate(button, () => button.click());
  return button;
}

/** A filter chip whose options open in Obsidian's own menu. */
function menuChip(parent, label, options, current, onPick) {
  const chip = parent.createDiv({ cls: "pdt-chip is-menu", attr: { role: "button", tabindex: "0" } });
  chip.createSpan({ text: label });
  const selected = options.some(([value]) => value === current) ? current : options[0][0];  // invalid here → first option
  chip.createSpan({ cls: "pdt-chip-value", text: options.find(([value]) => value === selected)[1] });
  setIcon(chip.createSpan({ cls: "pdt-chip-caret" }), "chevron-down");
  const open = () => {
    const menu = new Menu();
    for (const [value, text] of options) {
      menu.addItem((item) => item.setTitle(text).setChecked(value === selected).onClick(() => onPick(value)));
    }
    const rect = chip.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  };
  chip.onclick = open;
  onActivate(chip, open);
  return chip;
}

/** A SuggestModal that resolves a promise with the chosen item (or null when dismissed). */
class PickerModal extends SuggestModal {
  constructor(app, placeholder) {
    super(app);
    this.setPlaceholder(placeholder);
    this.result = new Promise((resolve) => { this.resolve = resolve; });
    this.chosen = null;
  }

  onChooseSuggestion(item) {
    this.chosen = item;
  }

  onClose() {
    // Obsidian closes the modal before reporting the choice; one tick later the choice is final
    setTimeout(() => this.resolve(this.chosen), 0);
  }
}

/** Suggests existing groups; a newly typed name can be chosen too. */
class GroupModal extends PickerModal {
  constructor(app, groups, current) {
    super(app, current ? t("group.placeholderCurrent", { group: current }) : t("group.placeholder"));
    this.groups = groups;
  }

  getSuggestions(query) {
    const q = query.trim();
    const matches = this.groups.filter((g) => g.toLowerCase().includes(q.toLowerCase())).map((name) => ({ name }));
    return q && !this.groups.includes(q) ? [{ name: q, isNew: true }, ...matches] : matches;
  }

  renderSuggestion(item, el) {
    el.setText(item.isNew ? t("group.new", { name: item.name }) : item.name);
  }
}

/** Picks one of the vault's .json files (for the Colab import). */
class JsonFileModal extends PickerModal {
  constructor(app) {
    super(app, t("json.placeholder"));
  }

  getSuggestions(query) {
    return this.app.vault.getFiles()
      .filter((f) => f.extension === "json" && f.path.toLowerCase().includes(query.toLowerCase()));
  }

  renderSuggestion(file, el) {
    el.setText(file.path);
  }
}

/** Model picker: filters as you type, shows prices, accepts names that aren't listed. */
class ModelModal extends PickerModal {
  constructor(app, models) {
    super(app, t("model.placeholder"));
    this.models = models;
    this.latestOnly = false;
  }

  onOpen() {
    super.onOpen?.();
    const container = this.inputEl?.parentElement;
    if (!container) return;
    const bar = createDiv({ cls: "pdt-model-bar" });
    container.after(bar);
    const toggle = bar.createDiv({ cls: "pdt-chip is-menu", text: t("model.latestOnly"), attr: { role: "button", tabindex: "0" } });
    const flip = () => {
      this.latestOnly = !this.latestOnly;
      toggle.toggleClass("is-active", this.latestOnly);
      this.inputEl.dispatchEvent(new Event("input"));
    };
    toggle.onclick = flip;
    onActivate(toggle, flip);
  }

  getSuggestions(query) {
    return filterModels(this.models, query, this.latestOnly);
  }

  renderSuggestion(model, el) {
    el.addClass("pdt-model-item");
    el.createDiv({ cls: "pdt-model-id", text: model.custom ? t("model.custom", { name: model.id }) : model.id });
    if (model.price) el.createDiv({ cls: "pdt-model-price", text: formatPrice(model.price) });
  }
}

/**
 * The discovery view, opened as a tab inside Obsidian.
 * render(): builds everything (on mode or filter changes). refresh(): updates only the counts, the status
 * and the list, so the search box keeps its focus.
 */
class DiscoveryView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.visible = PAGE_SIZE;
    this.shownTranslations = new Set();
    this.expanded = new Set();
    this.refs = {};
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return t("view.title"); }
  getIcon() { return ICON; }

  async onOpen() {
    this.contentEl.addClass("pdt-view");
    this.render();
    await this.plugin.ensureFresh();
  }

  get settings() { return this.plugin.data.settings; }

  async update(key, value) {
    this.settings[key] = value;
    this.visible = PAGE_SIZE;
    await this.plugin.saveData(this.plugin.data);
    this.render();
  }

  render() {
    const root = this.contentEl;
    root.empty();
    this.refs = { counts: {} };
    this.renderModes(root.createDiv({ cls: "pdt-seg" }));
    this.renderFilters(root.createDiv({ cls: "pdt-filters" }));
    this.refs.status = root.createDiv({ cls: "pdt-status" });
    this.refs.list = root.createDiv({ cls: "pdt-list" });
    this.refresh();
  }

  refresh() {
    if (!this.refs.list) return;
    const now = Date.now();
    const state = this.plugin.state();
    if (this.plugin.catalog) {
      const counts = modeCounts(state, this.settings, now);
      for (const [mode, el] of Object.entries(this.refs.counts)) el.setText(formatCount(counts[mode]));
    }
    this.renderStatus(this.refs.status);
    this.renderList(this.refs.list, state, now);
  }

  renderModes(seg) {
    const tipVars = { days: this.settings.days, gap: this.settings.dormantDays };
    for (const mode of MODE_KEYS) {
      const tab = seg.createDiv({ cls: `pdt-tab${mode === this.settings.mode ? " is-active" : ""}`, attr: { role: "tab", tabindex: "0" } });
      tab.createSpan({ text: t(`mode.${mode}`) });
      this.refs.counts[mode] = tab.createSpan({ cls: "pdt-n", text: "…" });
      setTooltip(tab, t(`tip.${mode}`, tipVars));
      tab.onclick = () => this.update("mode", mode);
      onActivate(tab, () => this.update("mode", mode));
    }
  }

  renderFilters(bar) {
    const mode = this.settings.mode;
    const select = (label, key, options) =>
      menuChip(bar, label, options, this.settings[key], (value) => this.update(key, value));
    const dayOptions = (values) => values.map((n) => [n, t("filter.days", { n })]);

    if (mode === "new" || mode === "updated" || mode === "awakened") select(t("filter.last"), "days", dayOptions([7, 14, 30, 60, 90]));
    if (mode === "awakened") select(t("filter.gap"), "dormantDays", dayOptions([30, 60, 90, 180, 365]));
    if (mode === "all" || mode === "updated" || mode === "awakened") {
      const chip = bar.createEl("label", { cls: "pdt-chip" });
      chip.createSpan({ text: t("filter.downloads") });
      const input = chip.createEl("input", { type: "number", value: String(this.settings.minDownloads) });
      input.onchange = () => this.update("minDownloads", Math.max(0, Number(input.value) || 0));
    }
    const sorts = mode === "all" ? ["downloads", "updated", "name", "listed"] : ["downloads", "updated"];
    if (mode !== "new") select(t("filter.sort"), "sort", sorts.map((key) => [key, t(`sort.${key}`)]));

    const search = bar.createDiv({ cls: "pdt-search" });
    setIcon(search.createSpan({ cls: "pdt-search-icon" }), "search");
    const input = search.createEl("input", { type: "search", placeholder: t("search.placeholder"), value: this.settings.query });
    this.refs.search = input;
    let timer;
    input.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        this.settings.query = input.value;
        this.visible = PAGE_SIZE;
        this.refresh();
        await this.plugin.saveData(this.plugin.data);
      }, 250);
    };

    if (mode === "changed") {
      const all = bar.createEl("button", { cls: "pdt-ghost", text: t("changed.markAll") });
      all.onclick = async () => { await this.plugin.markReviewed(this.rows || []); this.refresh(); };
    }
    this.refs.translate = bar.createEl("button", { cls: "pdt-ghost" });
    setIcon(this.refs.translate.createSpan({ cls: "pdt-btn-icon" }), "languages");
    this.refs.translateLabel = this.refs.translate.createSpan({ text: t("translate.visible", { n: 0 }) });
    this.refs.translate.onclick = async () => {
      const rows = (this.rows || []).slice(0, this.visible);
      if (await this.plugin.translateRows(rows)) rows.forEach((p) => this.shownTranslations.add(p.id));
      this.refresh();
    };
  }

  renderStatus(status) {
    const { catalog, timeline } = this.plugin;
    status.empty();
    const text = status.createDiv({ cls: "pdt-status-text" });
    if (!catalog) {
      text.setText(t("status.loading"));
    } else {
      text.setText([
        t("status.plugins", { n: formatCount(catalog.plugins.length) }),
        t("status.data", { age: formatAge(Date.now() - catalog.fetchedAt) }),
        timeline.to ? t("status.history", { label: historyLabel(timeline.months) }) : t("status.noHistory"),
      ].join("  ·  "));
    }
    const query = this.settings.query.trim();
    if (query) {  // a saved search shouldn't be forgotten: this is why the list is short
      const tag = status.createDiv({ cls: "pdt-query" });
      tag.createSpan({ text: t("status.query", { q: query }) });
      const clear = tag.createSpan({ cls: "pdt-query-clear", text: t("status.clear"), attr: { role: "button", tabindex: "0" } });
      clear.onclick = async () => {
        this.settings.query = "";
        if (this.refs.search) this.refs.search.value = "";
        this.visible = PAGE_SIZE;
        this.refresh();
        await this.plugin.saveData(this.plugin.data);
      };
      onActivate(clear, () => clear.click());
    }
    const actions = status.createDiv({ cls: "pdt-status-actions" });
    if (!timeline.to || timeline.legacy) {
      actions.createEl("button", { cls: "mod-cta", text: t(timeline.to ? "status.rebuild" : "status.build") })
        .onclick = () => this.plugin.buildHistory(true);
    }
    iconButton(actions, "refresh-cw", t("status.refresh")).onclick = () => this.plugin.refresh();
  }

  renderList(list, state, now) {
    list.empty();
    this.rows = [];
    if (!this.plugin.catalog) return;
    const { timeline } = this.plugin;
    const mode = this.settings.mode;
    if (mode === "awakened" && !timeline.to) {
      list.createDiv({ cls: "pdt-empty", text: t("list.needHistory") });
      this.updateTranslateButton([]);
      return;
    }
    if (mode === "new" && (!timeline.to || timeline.legacy)) list.createDiv({ cls: "pdt-hint", text: t("list.legacyHint") });

    this.rows = discover(state, this.settings, now);
    const visible = this.rows.slice(0, this.visible);
    this.updateTranslateButton(visible);
    if (!this.rows.length) {
      list.createDiv({ cls: "pdt-empty", text: t("list.empty") });
      return;
    }
    for (const plugin of visible) this.renderRow(list, plugin, now);
    if (this.rows.length > this.visible) {
      const more = list.createEl("button", {
        cls: "pdt-more",
        text: t("list.more", { n: Math.min(PAGE_SIZE, this.rows.length - this.visible), total: formatCount(this.rows.length), shown: this.visible }),
      });
      more.onclick = () => { this.visible += PAGE_SIZE; this.refresh(); };
    }
  }

  updateTranslateButton(visible) {
    const pending = visible.filter((p) => p.description && this.plugin.cachedTranslation(p) == null).length;
    this.refs.translateLabel?.setText(t("translate.visible", { n: visible.length }));
    if (!this.refs.translate) return;
    this.refs.translate.disabled = !visible.length;
    setTooltip(this.refs.translate, pending ? t("translate.pending", { pending, done: visible.length - pending }) : t("translate.allDone"));
  }

  renderRow(list, p, now) {
    const plugin = this.plugin;
    const { firstSeen, releases } = plugin.timeline;
    const note = plugin.notes.index.get(p.id);
    const row = list.createDiv({ cls: "pdt-row" });
    const main = row.createDiv({ cls: "pdt-main" });

    // Title: name · version · badges
    const head = main.createDiv({ cls: "pdt-head" });
    head.createEl("a", { cls: "pdt-name", text: p.name, href: `obsidian://show-plugin?id=${encodeURIComponent(p.id)}` });
    if (p.version) head.createSpan({ cls: "pdt-ver", text: p.version });
    if (isNewPlugin(firstSeen, p, now)) head.createSpan({ cls: "pdt-badge is-new", text: t("badge.new") });
    if (isChanged(p, note)) head.createSpan({ cls: "pdt-badge is-changed", text: t("badge.changed") });
    if (plugin.installed().has(p.id)) head.createSpan({ cls: "pdt-badge is-installed", text: t("badge.installed") });
    if (note) {
      const link = head.createSpan({ cls: "pdt-badge is-note", text: note.group ? `📝 ${note.group}` : t("badge.note") });
      setTooltip(link, t("badge.openNote"));
      link.onclick = () => this.app.workspace.openLinkText(note.path, "");
    }

    // Meta line: author · GitHub · when · gap
    const meta = main.createDiv({ cls: "pdt-meta" });
    const sep = () => meta.createSpan({ cls: "pdt-sep", text: "·" });
    if (p.author) { meta.createSpan({ cls: "pdt-author", text: p.author }); sep(); }
    if (p.repo) {
      const gh = meta.createEl("a", { cls: "pdt-gh", href: `https://github.com/${p.repo}`, text: "GitHub" });
      setIcon(gh.createSpan({ cls: "pdt-gh-icon" }), "external-link");
      sep();
    }
    const seen = firstSeen[p.id];
    if (p.updated) meta.createSpan({ text: t("row.updated", { when: relativeDays(p.updated, now) }) });
    else meta.createSpan({ text: seen > 0 ? t("row.added", { when: relativeDays(seen, now) }) : t("row.justListed") });
    if (plugin.timeline.to && p.updated) {
      const gap = dormantDays(releases, p);
      sep();
      if (gap != null) {
        const long = this.settings.mode === "awakened" && gap >= this.settings.dormantDays;  // highlighted only in Awakened
        meta.createSpan({ cls: long ? "pdt-gap is-long" : "pdt-gap", text: t("row.gap", { n: gap }) });
      } else {
        meta.createSpan({ cls: "pdt-gap", text: t("row.firstRelease") });
      }
    }

    // Description: two lines; click to expand long ones. Translate next to it.
    const descRow = main.createDiv({ cls: "pdt-desc-row" });
    const desc = descRow.createEl("p", { cls: "pdt-desc", text: p.description || "–" });
    if (this.expanded.has(p.id)) desc.addClass("is-expanded");
    requestAnimationFrame(() => {
      if (desc.scrollHeight > desc.clientHeight + 1 || desc.hasClass("is-expanded")) desc.addClass("is-clamped");
    });
    desc.onclick = () => {
      if (!desc.hasClass("is-clamped")) return;
      desc.toggleClass("is-expanded", !desc.hasClass("is-expanded"));
      if (desc.hasClass("is-expanded")) this.expanded.add(p.id); else this.expanded.delete(p.id);
    };
    const translation = plugin.cachedTranslation(p);
    const showing = translation != null && this.shownTranslations.has(p.id);
    if (p.description) {
      const tr = descRow.createDiv({ cls: "pdt-tr", attr: { role: "button", tabindex: "0" } });
      setIcon(tr.createSpan({ cls: "pdt-btn-icon" }), "languages");
      tr.createSpan({ text: showing ? t("translate.hide") : t("translate.row") });
      tr.onclick = async () => {
        if (showing) this.shownTranslations.delete(p.id);
        else if (translation != null || (await plugin.translateRows([p]))) this.shownTranslations.add(p.id);
        this.refresh();
      };
      onActivate(tr, () => tr.click());
    }
    if (showing) main.createDiv({ cls: "pdt-trans", text: translation });

    // Right side: downloads + actions
    const right = row.createDiv({ cls: "pdt-right" });
    const downloads = right.createDiv({ cls: "pdt-downloads" });
    if (p.downloads == null) {
      downloads.addClass("is-empty");
      downloads.setText(t("row.noStats"));
    } else {
      setIcon(downloads.createSpan({ cls: "pdt-dl-icon" }), "download");
      downloads.createSpan({ text: formatShort(p.downloads) });
      setTooltip(downloads, t("row.downloads", { n: formatCount(p.downloads) }));
    }
    const actions = right.createDiv({ cls: "pdt-actions" });
    const act = (icon, tip, fn, cls) => {
      const button = iconButton(actions, icon, tip, cls);
      button.onclick = async () => {
        if (button.hasClass("is-busy")) return;  // a quick double click must not run the action twice
        button.addClass("is-busy");
        await fn();
        this.refresh();
      };
    };
    if (this.settings.mode === "changed") {
      act("check", t("action.reviewed"), () => plugin.markReviewed([p]));
      return;
    }
    act("star", t(note?.favorite ? "action.unfavorite" : "action.favorite"), () => plugin.toggleFavorite(p), note?.favorite ? "is-favorite" : "");
    act("folder-plus", note?.group ? t("action.groupNamed", { group: note.group }) : t("action.group"), () => plugin.chooseGroup(p));
    if (this.settings.mode === "suggested") act("x", t("action.dismiss"), () => plugin.dismiss(p));
    else act("ban", t("action.exclude"), () => plugin.exclude(p));
  }
}

class RadarSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.modelList = null;
  }

  display() {
    const { containerEl } = this;
    const plugin = this.plugin;
    const settings = plugin.data.settings;
    const save = () => plugin.saveData(plugin.data);
    containerEl.empty();

    new Setting(containerEl)
      .setName(t("set.folder"))
      .setDesc(t("set.folderDesc"))
      .addText((text) => text.setValue(settings.folder).onChange(async (value) => {
        settings.folder = value.trim() || defaultSettings().folder;
        await save();
        plugin.notes.rebuild();
      }));

    // ── Release history
    new Setting(containerEl).setName(t("set.history")).setHeading();
    const { timeline } = plugin;
    new Setting(containerEl)
      .setName(t("set.depth"))
      .setDesc(timeline.to
        ? t("set.depthDesc", { label: historyLabel(timeline.months), from: dayString(timeline.from), to: dayString(timeline.to) })
        : t("set.notBuilt"))
      .addDropdown((d) => {
        for (const months of HISTORY_MONTHS) d.addOption(String(months), historyLabel(months));
        d.setValue(String(settings.historyMonths)).onChange(async (value) => {
          settings.historyMonths = Number(value);
          await save();
          this.display();
        });
      })
      .addButton((b) => b.setButtonText(t("set.rebuild")).onClick(() => plugin.buildHistory(true)));

    this.displayTranslation(containerEl, settings, save);

    // ── Lists
    this.list(containerEl, t("set.excluded", { n: Object.keys(plugin.data.excluded).length }), plugin.data.excluded, (id) => plugin.restore("excluded", id));
    this.list(containerEl, t("set.dismissed", { n: Object.keys(plugin.data.dismissed).length }), plugin.data.dismissed, (id) => plugin.restore("dismissed", id));
  }

  displayTranslation(containerEl, settings, save) {
    const plugin = this.plugin;
    const translator = plugin.translator;
    new Setting(containerEl).setName(t("set.translation")).setHeading();
    if (!translator.supported) {
      new Setting(containerEl).setDesc(t("set.needsKeychain"));
      return;
    }

    new Setting(containerEl)
      .setName(t("set.provider"))
      .addDropdown((d) => {
        d.addOption("", t("set.none"));
        for (const [id, spec] of Object.entries(PROVIDERS)) d.addOption(id, spec.label);
        d.setValue(settings.provider).onChange(async (value) => {
          Object.assign(settings, { provider: value, model: "", modelPrice: "" });
          this.modelList = null;
          await save();
          this.display();
        });
      });

    if (settings.provider) {
      const provider = settings.provider;
      const keySetting = new Setting(containerEl)
        .setName(t("set.key"))
        .setDesc(t("set.keyDesc", { name: KEY_NAMES[provider], found: Boolean(translator.key()) }));
      new obsidian.SecretComponent(this.app, keySetting.controlEl)
        .setValue(translator.keyName(provider))
        .onChange(async (name) => {
          settings.keyNames = { ...settings.keyNames, [provider]: name || "" };
          this.modelList = null;
          await save();
          this.display();
        });

      const description = [
        settings.modelPrice ? t("set.modelPrice", { price: settings.modelPrice }) : "",
        this.modelList && provider !== "openrouter" ? t("set.noPrices") : "",
        t("set.modelHint"),
      ].filter(Boolean).join(" ");
      new Setting(containerEl)
        .setName(settings.model ? `${t("set.model")}: ${settings.model}` : t("set.model"))
        .setDesc(description)
        .addButton((b) => b.setButtonText(t("set.modelPick")).setCta().onClick(() => this.pickModel(settings, save)))
        .addButton((b) => b.setButtonText(t("set.modelTest")).setDisabled(!translator.ready).onClick(async () => {
          b.setDisabled(true);
          try {
            new Notice(t("notice.modelOk", { model: settings.model, sample: await translator.test() }));
          } catch (error) {
            new Notice(t("notice.modelFailed", { error: error.message }), 12000);
          }
          b.setDisabled(false);
        }));

      new Setting(containerEl)
        .setName(t("set.targetLang"))
        .addText((text) => text.setValue(settings.targetLang).onChange(async (value) => {
          settings.targetLang = value.trim() || defaultSettings().targetLang;
          await save();
        }));
    }

    const saved = Object.keys(plugin.data.translations).length;
    new Setting(containerEl)
      .setName(t("set.saved"))
      .setDesc(t("set.savedDesc", { n: formatCount(saved) }))
      .addButton((b) => b.setButtonText(t("set.delete")).setDisabled(!saved).onClick(async () => {
        plugin.data.translations = {};
        await save();
        this.display();
      }));
  }

  /** Loads the model list once (if it can), then opens the filtering picker; typed names are allowed. */
  async pickModel(settings, save) {
    if (!this.modelList) {
      try {
        this.modelList = await this.plugin.translator.models(settings.provider);
      } catch (error) {
        new Notice(t("notice.modelsFailed", { error: error.message }));
      }
    }
    const modal = new ModelModal(this.app, this.modelList || []);
    modal.open();
    const model = await modal.result;
    if (!model) return;
    Object.assign(settings, { model: model.id, modelPrice: formatPrice(model.price) });
    await save();
    this.display();
  }

  list(containerEl, title, entries, onRestore) {
    new Setting(containerEl).setName(title).setHeading();
    const names = new Map((this.plugin.catalog?.plugins || []).map((p) => [p.id, p.name]));
    for (const [id, date] of Object.entries(entries).sort((a, b) => b[1].localeCompare(a[1]))) {
      new Setting(containerEl)
        .setName(names.get(id) || id)
        .setDesc(`${id} · ${date}`)
        .addButton((b) => b.setButtonText(t("set.restore")).onClick(async () => { await onRestore(id); this.display(); }));
    }
  }
}

// ─── 5. Plugin ──────────────────────────────────────────────────────────────
class PluginRadar extends Plugin {
  async onload() {
    setLanguage(obsidian.moment?.locale?.() || globalThis.localStorage?.getItem?.("language") || "en");
    addIcon(ICON, ICON_SVG);

    this.data = Object.assign({ excluded: {}, dismissed: {}, translations: {}, migrations: {} }, await this.loadData());
    this.data.settings = Object.assign(defaultSettings(), this.data.settings);
    this.github = new GitHub();
    this.cache = new Cache(this.app.vault.adapter, this.manifest.dir);
    this.notes = new Notes(this.app, this.data.settings);
    this.translator = new Translator(this.app, this.data.settings);
    this.catalog = null;                                      // {fetchedAt, plugins}
    this.timeline = newTimeline(this.data.settings.historyMonths);
    this.busy = false;

    this.registerView(VIEW_TYPE, (leaf) => new DiscoveryView(leaf, this));
    this.addRibbonIcon(ICON, t("view.title"), () => this.openView());
    this.addSettingTab(new RadarSettingTab(this.app, this));
    this.addCommands();

    // Only changes inside the notes folder refresh the view, so typing elsewhere stays quiet
    const relevant = (path) => path.startsWith(`${this.notes.folder}/`);
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (!relevant(file.path)) return;
      this.notes.refresh(file);
      this.redraw();
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (!relevant(file.path)) return;
      this.notes.forget(file.path);
      this.redraw();
    }));
    this.registerEvent(this.app.vault.on("rename", (file, old) => {
      if (!relevant(file.path) && !relevant(old)) return;
      this.notes.forget(old);
      this.notes.refresh(file);
      this.redraw();
    }));

    this.app.workspace.onLayoutReady(async () => {
      await this.importLegacyPlugin();
      this.notes.rebuild();
      this.catalog = await this.cache.read("catalog", null);
      this.timeline = upgradeTimeline(await this.cache.read("timeline", this.timeline));
      await this.runMigrations();
      this.redraw();
    });
  }

  /**
   * The plugin was first used privately as "Eklenti Takip" (id plugin-discovery-tracker). On a fresh
   * install, its settings, lists and caches are copied over once so nothing is lost by the rename.
   */
  async importLegacyPlugin() {
    if (this.data.migrations.legacyImport) return;
    this.data.migrations.legacyImport = dayString(Date.now());
    const adapter = this.app.vault.adapter;
    const legacyDir = normalizePath(`${this.app.vault.configDir}/plugins/${LEGACY_PLUGIN_ID}`);
    const hasOwnData = Object.keys(this.data.excluded).length || Object.keys(this.data.translations).length;
    if (hasOwnData || !(await adapter.exists(`${legacyDir}/data.json`))) return this.saveData(this.data);
    try {
      const legacy = JSON.parse(await adapter.read(`${legacyDir}/data.json`));
      for (const key of ["excluded", "dismissed", "translations"]) this.data[key] = { ...legacy[key], ...this.data[key] };
      Object.assign(this.data.settings, legacy.settings || {});
      Object.assign(this.data.migrations, legacy.migrations || {}, { legacyImport: this.data.migrations.legacyImport });
      for (const name of ["catalog", "timeline"]) {
        const path = `${legacyDir}/cache/${name}.json`;
        if (await adapter.exists(path)) await this.cache.write(name, JSON.parse(await adapter.read(path)));
      }
      new Notice(t("notice.legacyImported"), 10000);
    } catch (error) {
      console.warn("[Plugin Radar] couldn't import data from the earlier version", error);
    }
    await this.saveData(this.data);
  }

  /** One-time changes applied to notes and keys when upgrading. */
  async runMigrations() {
    const done = this.data.migrations;
    if (!done.h1Headings) {
      const changed = await this.notes.migrateHeadings();
      done.h1Headings = dayString(Date.now());
      if (changed) new Notice(t("notice.headings", { n: changed }));
    }
    if (!done.keyNames) {
      const moved = this.translator.migrateLegacyKeys();
      done.keyNames = dayString(Date.now());
      if (moved) new Notice(t("notice.keysMoved", { n: moved, example: KEY_NAMES.anthropic }));
    }
    await this.saveData(this.data);
  }

  addCommands() {
    const command = (id, name, callback) => this.addCommand({ id, name, callback });
    command("open", t("cmd.open"), () => this.openView());
    command("refresh", t("cmd.refresh"), () => this.refresh());
    command("rebuild-history", t("cmd.rebuild"), () => this.buildHistory(true));
    command("readme-current", t("cmd.readmeCurrent"), () => this.updateCurrentReadme());
    command("readme-all", t("cmd.readmeAll"), () => this.updateReadmes([...this.notes.index.keys()]));
    command("import-colab", t("cmd.import"), () => this.importColab());
  }

  // ── State ────────────────────────────────────────────────────────────────
  /** Installed community plugins. `app.plugins` isn't part of the public API, so it's read defensively. */
  installed() {
    return new Set(Object.keys(this.app.plugins?.manifests || {}));
  }

  state() {
    return {
      catalog: this.catalog?.plugins || [],
      releases: this.timeline.releases,
      firstSeen: this.timeline.firstSeen,
      notes: this.notes.index,
      excluded: new Set(Object.keys(this.data.excluded)),
      dismissed: new Set(Object.keys(this.data.dismissed)),
      installed: this.installed(),
    };
  }

  pluginById(id) {
    return this.catalog?.plugins.find((p) => p.id === id) || null;
  }

  redraw() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) leaf.view.refresh?.();
  }

  async openView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing || this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  // ── Data ─────────────────────────────────────────────────────────────────
  /** Runs one long task at a time, showing progress in a persistent notice. */
  async task(label, work) {
    if (this.busy) return new Notice(t("notice.busy"));
    this.busy = true;
    const notice = new Notice(label, 0);
    try {
      const message = await work((text) => notice.setMessage(`${label}\n${text}`));
      notice.setMessage(message || `${label} ✔`);
      setTimeout(() => notice.hide(), 6000);
    } catch (error) {
      console.error("[Plugin Radar]", error);
      notice.setMessage(`${label} ✖\n${error.message}`);
      setTimeout(() => notice.hide(), 12000);
    } finally {
      this.busy = false;
      this.redraw();
    }
  }

  /** On opening the view: refresh when there is no catalog or it is older than a day. */
  async ensureFresh() {
    if (!this.catalog || Date.now() - this.catalog.fetchedAt > CATALOG_MAX_AGE_MS) await this.refresh();
  }

  async ensureCatalog() {
    if (!this.catalog) await this.refresh();
    return Boolean(this.catalog);
  }

  refresh() {
    return this.task(t("notice.refreshing"), async (progress) => {
      progress(t("notice.downloadingCatalog"));
      this.catalog = { fetchedAt: Date.now(), plugins: await this.github.catalog() };
      await this.cache.write("catalog", this.catalog);

      if (this.timeline.to) await this.syncTimeline(false, progress);

      progress(t("notice.updatingNotes"));
      const released = [];
      for (const id of [...this.notes.index.keys()]) {
        const plugin = this.pluginById(id);
        if (plugin && (await this.notes.syncSource(plugin))) released.push(id);
      }
      if (released.length) await this.fetchReadmes(released, progress);
      return t("notice.refreshed", { n: formatCount(this.catalog.plugins.length), released: released.length });
    });
  }

  buildHistory(rebuild) {
    return this.task(t("notice.history"), (progress) => this.syncTimeline(rebuild, progress));
  }

  /**
   * Downloads the missing days' snapshots and merges them into the history. After a long break it
   * fills every missing day; it saves after each batch, so an interrupted run keeps its progress.
   */
  async syncTimeline(rebuild, progress) {
    const now = Date.now();
    if (rebuild || !this.timeline.to) this.timeline = newTimeline(this.data.settings.historyMonths);
    const since = this.timeline.to || now - this.timeline.months * MONTH_MS;

    progress(t("notice.listingSnapshots"));
    const snapshots = selectSnapshots(await this.github.statsCommits(since), now);
    for (let i = 0; i < snapshots.length; i += PARALLEL) {
      const batch = snapshots.slice(i, i + PARALLEL);
      const stats = await mapLimit(batch, PARALLEL, (s) => this.github.snapshot(s.sha));
      stats.forEach((s, k) => mergeSnapshot(this.timeline, s, batch[k].date));  // order kept: oldest first
      this.timeline.from ||= batch[0].date;
      this.timeline.to = batch[batch.length - 1].date;
      await this.cache.write("timeline", this.timeline);
      progress(t("notice.snapshotProgress", { done: Math.min(i + PARALLEL, snapshots.length), total: snapshots.length, date: dayString(this.timeline.to) }));
    }
    return snapshots.length
      ? t("notice.historyDone", { label: historyLabel(this.timeline.months), from: dayString(this.timeline.from), to: dayString(this.timeline.to), n: snapshots.length })
      : t("notice.historyCurrent");
  }

  // ── README ───────────────────────────────────────────────────────────────
  async fetchReadmes(ids, progress) {
    let done = 0;
    await mapLimit(ids, PARALLEL, async (id) => {
      const plugin = this.pluginById(id);
      const file = this.notes.file(id);
      if (plugin && file) await this.notes.writeReadme(file, plugin, plugin.repo ? await this.github.readme(plugin.repo) : null);
      progress(t("notice.readmeProgress", { done: ++done, total: ids.length }));
    });
  }

  async updateReadmes(ids) {
    if (!(await this.ensureCatalog())) return;
    await this.task(t("notice.readme"), async (progress) => {
      await this.fetchReadmes(ids, progress);
      return t("notice.readmeDone", { n: ids.length });
    });
  }

  async updateCurrentReadme() {
    const file = this.app.workspace.getActiveFile();
    const note = file && noteFromFrontmatter(file.path, this.app.metadataCache.getFileCache(file)?.frontmatter);
    if (!note) return new Notice(t("notice.notTracking"));
    await this.updateReadmes([note.id]);
  }

  // ── Translation ──────────────────────────────────────────────────────────
  /** Saved translation; invalid once the description changes. */
  cachedTranslation(plugin) {
    const saved = this.data.translations[plugin.id];
    return saved && saved.src === plugin.description ? saved.text : null;
  }

  /** Translates untranslated descriptions in single requests of up to 50 and saves them. True on success. */
  async translateRows(plugins) {
    const pending = plugins.filter((p) => p.description && this.cachedTranslation(p) == null);
    if (!pending.length) return true;
    if (!this.translator.ready) {
      new Notice(t("notice.translateSetup"));
      return false;
    }
    const notice = new Notice(t("notice.translating", { n: pending.length }), 0);
    try {
      for (let i = 0; i < pending.length; i += PAGE_SIZE) {
        const batch = pending.slice(i, i + PAGE_SIZE);
        const texts = await this.translator.translate(batch.map((p) => p.description));
        batch.forEach((p, k) => { this.data.translations[p.id] = { src: p.description, text: texts[k] }; });
        await this.saveData(this.data);
      }
      notice.hide();
      return true;
    } catch (error) {
      console.error("[Plugin Radar] translation", error);
      notice.setMessage(t("notice.translateFailed", { error: error.message }));
      setTimeout(() => notice.hide(), 12000);
      return false;
    }
  }

  // ── User actions ─────────────────────────────────────────────────────────
  /** Creates or updates the note; a new note gets its README in the background. */
  async track(plugin, patch) {
    const { file, created } = await this.notes.upsert(plugin, patch);
    if (created && plugin.repo) {
      this.github.readme(plugin.repo)
        .then((readme) => this.notes.writeReadme(file, plugin, readme))
        .catch((error) => console.warn("[Plugin Radar] couldn't fetch the README", error));
    }
    return created;
  }

  async toggleFavorite(plugin) {
    const favorite = !this.notes.index.get(plugin.id)?.favorite;
    const created = await this.track(plugin, { favorite });
    new Notice(t("notice.favorite", { star: favorite ? "★" : "☆", name: plugin.name, created }));
  }

  async chooseGroup(plugin) {
    const modal = new GroupModal(this.app, this.notes.groups(), this.notes.index.get(plugin.id)?.group);
    modal.open();
    const chosen = await modal.result;
    if (!chosen) return;
    const created = await this.track(plugin, { group: chosen.name });
    new Notice(t("notice.grouped", { name: plugin.name, group: chosen.name, created }));
  }

  async exclude(plugin) {
    this.data.excluded[plugin.id] = dayString(Date.now());
    await this.saveData(this.data);
    new Notice(t("notice.excluded", { name: plugin.name }));
  }

  async dismiss(plugin) {
    this.data.dismissed[plugin.id] = dayString(Date.now());
    await this.saveData(this.data);
  }

  async restore(list, id) {
    delete this.data[list][id];
    await this.saveData(this.data);
    this.redraw();
  }

  async markReviewed(plugins) {
    const today = dayString(Date.now());
    for (const plugin of plugins) {
      const file = this.notes.file(plugin.id);
      if (!file) continue;
      await this.app.fileManager.processFrontMatter(file, (fm) => { fm.reviewed = today; });
      this.notes.index.get(plugin.id).reviewed = today;
    }
    this.redraw();
  }

  // ── Import from the Colab notebook ───────────────────────────────────────
  async importColab() {
    if (!(await this.ensureCatalog())) return;
    const modal = new JsonFileModal(this.app);
    modal.open();
    const file = await modal.result;
    if (!file) return;

    let tracker;
    try {
      tracker = JSON.parse(await this.app.vault.read(file));
    } catch (error) {
      return new Notice(t("notice.jsonError", { error: error.message }));
    }
    const byId = new Map(this.catalog.plugins.map((p) => [p.id, p]));
    const plan = planImport(tracker, new Set(byId.keys()), dayString(Date.now()));

    await this.task(t("notice.import"), async (progress) => {
      for (const id of plan.excluded) this.data.excluded[id] ||= dayString(Date.now());
      await this.saveData(this.data);
      const created = [];
      for (const [i, item] of plan.notes.entries()) {
        const { id, ...patch } = item;
        if ((await this.notes.upsert(byId.get(id), patch)).created) created.push(id);
        progress(t("notice.importNote", { done: i + 1, total: plan.notes.length }));
      }
      await this.fetchReadmes(created, progress);
      return t("notice.importDone", { notes: plan.notes.length, excluded: plan.excluded.length, missing: plan.missing.length });
    });
  }
}

module.exports = PluginRadar;
module.exports.core = core;  // exposed for tests only

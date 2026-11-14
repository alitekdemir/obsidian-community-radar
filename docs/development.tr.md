# Geliştirme ve çeviri

*[English](development.md) · Türkçe*

## Derleme

Eklenti `src/*.js` dosyalarından oluşur, dosya adı sırasıyla birleştirilir; `npm run build` ayrıca `locales/*.json` dosyalarını Obsidian'ın yüklediği `main.js` içine gömer. Çalışma zamanı bağımlılığı yoktur. Testler Node'da, Obsidian API'sinin küçük bir taklidiyle çevrimdışı çalışır:

```sh
npm install
npm test        # önce main.js'i derler
```

Bir değişikliği bir kasada denemek için `npm run build` çalıştırın, `main.js`, `manifest.json` ve `styles.css` dosyalarını `<kasa>/.obsidian/plugins/plugin-radar/` içine kopyalayın ve eklentiyi yeniden yükleyin.

## Sürümler arasında

Değişiklikler sürüm çıkarmadan `main`'e gider: sürümü yalnızca bir etiket yayımlar. Her değişiklik `CHANGELOG.md`'nin en üstündeki `## Unreleased` altına bir satır ekler ve sürüm numarasına dokunmaz — Obsidian `main`'deki `manifest.json`'u en son sürüm olarak okur; aynı etiketle bir sürümü olmayan bir sürüm numarası, kullanıcılara indiremeyecekleri bir güncelleme sunar.

## Sürüm çıkarma

1. Yeni sürümü `manifest.json`, `package.json`, `package-lock.json` ve `versions.json` dosyalarına yazın.
2. `CHANGELOG.md`'deki `## Unreleased` başlığını `## <sürüm>` olarak değiştirin.
3. `main`'e push edin, ardından aynı sürümle, başında `v` olmadan bir etiket push edin (örn. `0.10.1`).

[Sürüm iş akışı](../.github/workflows/release.yml) etiketin `manifest.json` ile eşleştiğini kontrol eder, testleri çalıştırır, `main.js`, `manifest.json` ve `styles.css` dosyalarını derleyip onaylar ve sürümü, o sürümün changelog bölümünü notları olarak kullanarak yayımlar.

## Çeviri

Arayüzün tüm metni [`locales/`](../locales) klasöründe, her dil için bir JSON dosyasında durur. Kendi dilinizi eklemek için:

1. `locales/en.json` dosyasını, Obsidian'ın diliniz için kullandığı kodla `locales/<kod>.json` olarak kopyalayın (örn. `de`, `fr`, `pt-BR`).
2. `language.name` (dilinizin kendi adı, örn. `Deutsch`) ve `locale` (sayı ve tarih biçimleri için, örn. `de-DE`) değerlerini ayarlayın, ardından değerleri çevirin. `{placeholder}` biçimindeki yer tutucuları aynen koruyun.
3. Çoğul metin `{n}`'ye göre seçilen bir nesnedir: `{"one": "{n} day ago", "other": "{n} days ago"}`. Dilinizin [çoğul biçimlerini](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html) (`one`, `few`, `many`, `other`…) kullanın; `other` zorunludur. Çoğulu olmayan bir dil düz metin kullanabilir.
4. `npm install && npm test` çalıştırın (her anahtarı ve yer tutucuyu kontrol eder) ve bir pull request açın.

Eksik metin İngilizceye düşer; böylece yarım bir çeviri de çalışır. Yeni dil *Ayarlar → Dil* içinde kendiliğinden görünür.

Arayüz İngilizce, Türkçe, Deutsch, Русский, 日本語 ve 简体中文 konuşur (`zh-TW` Basitleştirilmiş Çinceye düşer). Kaynak `en.json`'dur: diğer her dosya ondan çevrilir. Almanca, Rusça, Japonca ve Çince makine desteklidir; düzeltmeler memnuniyetle karşılanır. Yeni bir anahtar aynı commit'te her `locales/*.json` dosyasına girer; aksi halde test başarısız olur. `help.guideFile`, Yardım penceresinin bağlantı verdiği sorgu kılavuzunu belirtir: çevrilmiş kılavuzu (`docs/query.<kod>.md`) olan dil ona işaret eder, diğerleri `query.md`'de kalır.

### İngilizce kalanlar

- **Adlar:** Community Radar, Obsidian, GitHub, README, Markdown, JSON, API, sağlayıcılar ve modeller.
- **Sorgu sözdizimi:** alan adları (`downloads`, `gain(30d)`…), `AND` `OR` `NOT`, `order by`, `asc` / `desc`, `in`, `is empty`, `true` / `false`, tarih fonksiyonları ve birimler (`30d`, `10k`). Kayıtlı sorgular dil değişikliğinden sonra da çalışır.
- **Not özellikleri** (`plugin_id`, `groups`, `status`…), dosya yolları ve tuşlar (`j`, `Esc`, `Ctrl+Space`).

### Terimler

Obsidian'ın kendi kelimeleri onun [resmi çevirilerinden](https://github.com/obsidianmd/obsidian-translations) gelir; böylece eklenti Obsidian gibi okunur:

| en | tr | de | ru | ja | zh |
|---|---|---|---|---|---|
| plugin | eklenti | Erweiterung | плагин | プラグイン | 插件 |
| Community plugins | Topluluk eklentileri | Externe Erweiterungen | Сторонние плагины | コミュニティプラグイン | 第三方插件 |
| vault | kasa | Vault | хранилище | 保管庫 | 仓库 |
| note | not | Notiz | заметка | ノート | 笔记 |
| Bases | Bases | Basen | Базы данных | ベース | 数据库 |
| keychain | anahtar deposu | Schlüsselbund | связка ключей | キーチェーン | 钥匙串 |
| command palette | komut paleti | Befehlspalette | палитра команд | コマンドパレット | 命令面板 |
| release | sürüm | Version | релиз | リリース | 版本 / 发布 |
| track, tracked | takip et, takip | verfolgen, Verfolgt | отслеживать, Отслеживаемые | 追跡, 追跡中 | 跟踪, 已跟踪 |
| incubation, hatched | kuluçka, kuluçkadan çıkış | Inkubation, aus der Inkubation | инкубация, выход из инкубации | 休眠期間, 休眠明け | 休眠期, 复苏 |
| query, view | sorgu, görünüm | Abfrage, Ansicht | запрос, вид | クエリ, ビュー | 查询, 视图 |
| AI | yapay zekâ | KI | ИИ | AI | AI |

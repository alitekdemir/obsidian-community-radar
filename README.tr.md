# Community Radar

Obsidian topluluk eklentilerinde yenileri ve güncellenenleri keşfedin, uzun bir aradan sonra geri dönenleri bulun, ilgilendiklerinizi not olarak takip edin.

*[English](README.md)*

Günde ~50 yeni topluluk eklentisi çıkarken yerleşik eklenti tarayıcısını takip etmek zor. Community Radar, Obsidian içine altı sekmeli bir keşif paneli ekler:

| Sekme | Gösterdiği |
|---|---|
| **Tümü** | Bütün topluluk eklentileri |
| **✨ Yeni** | Son *N* günde listeye giren eklentiler |
| **Güncellenen** | Son *N* günde sürüm çıkaranlar |
| **Uyananlar** | Son *N* günde, **uzun bir aradan sonra** sürüm çıkaranlar (ör. öncesinde 90+ gün sürüm yok). Sürekli güncellenenler elenir. |
| **🔄 Değişenler** | Takip ettiklerinizden, incelediğiniz günden sonra yeni sürüm çıkaranlar |
| **Öneriler** | Kurulu olan ama henüz favori yapmadığınız eklentiler |

![Tümü sekmesi: indirme, son güncelleme, sessizlik süresi ve README / GitHub bağlantılarıyla bütün eklentiler](docs/images/Radar_1-All.png)

Eklenti adına tıklamak, Obsidian'ın kendi eklenti tarayıcısında o eklentinin sayfasını açar; kurulum orada yapılır. Satırdaki **README**, eklentinin README'sini Obsidian içinde, takip notunda açar.

**Favori** yaptığınız ya da **gruba eklediğiniz** eklentiler vault'unuzda README'leriyle birlikte küçük notlara dönüşür; [Bases](https://help.obsidian.md/bases) ile tablo olarak görüp düzenleyebilirsiniz. **Dışladığınız** eklentiler bir daha görünmez.

![Uyananlar sekmesi: en az 30 gün sessiz kaldıktan sonra son 7 günde sürüm çıkaranlar](docs/images/Radar_3-Revived.png)

## Özellikler

- **Her sekmede filtreler**: *İndirme ≥* sekme başına açılıp kapanan bir çip; gün aralığı yazılabilir (ör. son 1 gün) ya da seçilebilir; sıralama indirme, son güncelleme, A–Z ya da listeye giriş tarihine göre, iki yönde.
- **Arama**: virgülle ayrılmış terimler (hepsi eşleşmeli) ya da Obsidian'ın aramasındaki gibi `/düzenli ifade/`, ör. `/project.+task/`.
- **Zamanlanmış eşitleme**: 6 saatte bir, günde bir, haftada bir ya da elle. Panel son eşitlemenin ne zaman yapıldığını ve ne getirdiğini gösterir (*Son eşitlemeden beri: 5 yeni · 23 güncelleme*).
- **Takip notunda README**: yeni sürüm çıkınca not açıldığında, her eşitlemede ya da yalnızca istendiğinde yenilenir. Kendi notlarınıza dokunulmaz.
- **Açıklama çevirisi**: kendi API anahtarınızla Claude, OpenAI, Gemini ya da OpenRouter. Bir sayfa tek istekte çevrilir, çeviriler saklanır.
- **Gruplar**: bir eklenti birden çok grupta olabilir (`groups` listesi). Grup penceresi gruplarınızdan en yakınını ★ ile işaretler, AI önerilerini açıp kapatabileceğiniz çipler olarak gösterir. **Grup öner**, grubu olmayan bütün eklentiler için tek seferde öneri alır (istek başına 50) ve siz onaylamadan hiçbir şey kaydetmez.
- **Benzer eklentiler**: her satırın altında, ad ve açıklamalardaki ortak kelimelerden yerelde bulunur; AI ya da ağ isteği yok.

  ![Özgün açıklamanın altında çevirisi](docs/images/Radar_2-One_Translate.png)

- **Türkçe ve İngilizce** arayüz; Obsidian'ın dilini izler ya da ayarlardan seçilir. Yeni diller [`locales/`](locales) klasörüne eklenebilir (ayrıntılar İngilizce README'de).
- Masaüstü ve mobilde çalışır.

## Kurulum

Obsidian'da **Ayarlar → Topluluk eklentileri → Göz at**'ı açın, **Community Radar**'ı arayın, kurup etkinleştirin.

**BRAT ile** (ön sürümler): [BRAT](https://github.com/TfTHacker/obsidian42-brat)'ı kurun, *BRAT: Add a beta plugin* komutuna `alitekdemir/obsidian-community-radar` yazın.

**Elle:** [son sürümdeki](https://github.com/alitekdemir/obsidian-community-radar/releases/latest) `main.js`, `manifest.json` ve `styles.css` dosyalarını `<vault>/.obsidian/plugins/plugin-radar/` klasörüne koyun, *Ayarlar → Topluluk eklentileri*'nden **Community Radar**'ı açın.

## Başlarken

1. **Community Radar: Community Radar'ı aç** komutunu çalıştırın ya da şeritteki radar simgesine tıklayın.
2. Bir kez **Sürüm geçmişini kur**'a basın (~50 MB, birkaç dakika). *Uyananlar* ve *Yeni* sekmeleri buna dayanır; sonraki eşitlemeler yalnızca aradaki günleri indirir.
3. Her satırdan favori (☆), gruba ekle (＋) ya da dışla (⊘).
4. İsterseniz *Ayarlar → Community Radar → Bases görünümü → Oluştur* ile takip notlarınızın hazır [Bases](https://help.obsidian.md/bases) tablosunu not klasörünün yanına ekleyin (ör. `Eklentiler.base`). Bozulursa **Sıfırla** şablondan yeniden yazar.

![Takip notu: özellikler, Notlarım ve eklentinin README'si](docs/images/Radar_4-Note.png)

![Takip edilen eklentiler Bases tablosunda, yerinde düzenlenebilir](docs/images/Radar_5-Bases_Note.png)

## Ayarlar

![Çeviri ayarları: sağlayıcı, anahtar deposundan API anahtarı, fiyatıyla model, hedef dil](docs/images/Radar_6-AI_Settings.png)

| Ayar | Seçenekler |
|---|---|
| Dil | Otomatik (Obsidian'ın dili), English, Türkçe |
| Not klasörü | Takip notlarının oluşturulacağı yer |
| Grup öner | Grubu olmayan takip edilen eklentiler için AI grup önerileri; kaydetmeden önce incelenir |
| Bases görünümü | Takip notlarının Bases tablosunu **Oluştur** ya da **Sıfırla** |
| Eşitleme sıklığı | Elle · 6 saatte bir · **Günde bir** · Haftada bir. Eşitlemeler arasında hiçbir şey indirilmez. **Şimdi eşitle** hemen çalıştırır. |
| README güncelleme | **Notu açtığımda** · Her eşitlemede · Elle (komut paleti) |
| Geçmiş derinliği | 3, 6, 12 ya da 24 ay |
| AI | Sağlayıcı, API anahtarı (Obsidian'ın anahtar deposundan), model, hedef dil — çeviri ve grup önerileri için |

## Nasıl çalışır

Obsidian'ın [`obsidian-releases`](https://github.com/obsidianmd/obsidian-releases) reposu `community-plugin-stats.json` dosyasını **her gün** commit'liyor; her anlık görüntü tüm eklentilerin son sürüm zamanını içeriyor. Community Radar bu anlık görüntüleri okur (son 30 gün her gün, öncesi haftalık), eklenti başına 50'ye kadar sürüm tarihi saklar ve mevcut sürümü bir öncekiyle karşılaştırır. "7 gün önce güncellendi · 52 gün aradan sonra" bilgisi bu yüzden yıllarca sessiz kalmış eklentilerde bile kesindir.

## Ağ kullanımı ve gizlilik

- `raw.githubusercontent.com`: herkese açık eklenti listesi, istatistik anlık görüntüleri ve README'ler.
- `api.github.com`: anlık görüntü listesi (geçmiş kurulumu ve eşitlemede 1–4 istek, kimliksiz, saatte 60 sınırı).
- AI sağlayıcınız: **yalnızca** çeviri ya da grup önerisi istediğinizde ve bir sağlayıcı ayarladıysanız; eklenti adları, açıklamaları ve grup adlarınız gönderilir.

Telemetri yok, hesap yok, vault'unuzla ilgili hiçbir şey gönderilmez. Vault içinde eklenti yalnızca kendi not klasöründeki notları okur ve yazar; diğer dosyalarınızı listelemez. API anahtarları Obsidian'ın anahtar deposunda (SecretStorage) cihaz başına saklanır, `data.json`'a yazılmaz; eklenti yalnızca anahtarın adını (ör. `anthropic-api-key`) saklar.

## Geliştirme

Kaynak `src/main.js`; `npm run build`, `locales/*.json` dosyalarını Obsidian'ın yüklediği `main.js` içine gömer. Testler Node'da, ağsız çalışır: `npm install && npm test`.

## Lisans

[MIT](LICENSE) © Ali Tekdemir

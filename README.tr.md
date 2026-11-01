# Plugin Radar

Obsidian topluluk eklentilerinde yenileri ve güncellenenleri keşfedin, uzun bir aradan sonra geri dönenleri bulun, ilgilendiklerinizi not olarak takip edin.

*[English](README.md)*

Günde ~50 yeni topluluk eklentisi çıkarken yerleşik eklenti tarayıcısını takip etmek zor. Plugin Radar, Obsidian içine altı sekmeli bir keşif paneli ekler:

| Sekme | Gösterdiği |
|---|---|
| **Tümü** | Bütün topluluk eklentileri; indirme, son güncelleme, ad ya da listeye giriş sırasına göre |
| **✨ Yeni** | Son *N* günde listeye giren eklentiler |
| **Güncellenen** | Son *N* günde sürüm çıkaranlar |
| **Uyananlar** | Son *N* günde, **uzun bir aradan sonra** sürüm çıkaranlar (ör. öncesinde 90+ gün sürüm yok). Sürekli güncellenenler elenir. |
| **🔄 Değişenler** | Takip ettiklerinizden, incelediğiniz günden sonra yeni sürüm çıkaranlar |
| **Öneriler** | Kurulu olan ama henüz favori yapmadığınız eklentiler |

Eklenti adına tıklamak, Obsidian'ın kendi eklenti tarayıcısında o eklentinin sayfasını açar; kurulum orada yapılır. Plugin Radar keşif ve takip içindir, kurulum yapmaz.

**Favori** yaptığınız ya da **gruba eklediğiniz** eklentiler vault'unuzda README'leriyle birlikte küçük notlara dönüşür; [Bases](https://help.obsidian.md/bases) ile tablo olarak görüp düzenleyebilirsiniz. **Dışladığınız** eklentiler bir daha görünmez.

## Kurulum

Topluluk listesine girene kadar:

**BRAT ile:** [BRAT](https://github.com/TfTHacker/obsidian42-brat)'ı kurun, *BRAT: Add a beta plugin* komutuna `alitekdemir/plugin-radar` yazın.

**Elle:** [son sürümdeki](https://github.com/alitekdemir/plugin-radar/releases/latest) `main.js`, `manifest.json` ve `styles.css` dosyalarını `<vault>/.obsidian/plugins/plugin-radar/` klasörüne koyun, *Ayarlar → Topluluk eklentileri*'nden **Plugin Radar**'ı açın.

## Başlarken

1. **Plugin Radar: Eklenti keşfini aç** komutunu çalıştırın ya da şeritteki radar simgesine tıklayın.
2. Bir kez **Sürüm geçmişini kur**'a basın (~50 MB, birkaç dakika). *Uyananlar* ve *Yeni* sekmeleri buna dayanır; sonraki yenilemeler yalnızca aradaki günleri indirir.
3. Her satırdan favori (☆), gruba ekle (＋) ya da dışla (⊘).
4. İsterseniz [`docs/plugin-radar-bases.md`](docs/plugin-radar-bases.md) dosyasını vault'unuza kopyalayıp hazır Bases tablosunu kullanın (klasör adını kendi not klasörünüzle değiştirin).

## Nasıl çalışır

Obsidian'ın [`obsidian-releases`](https://github.com/obsidianmd/obsidian-releases) reposu `community-plugin-stats.json` dosyasını **her gün** commit'liyor; her anlık görüntü tüm eklentilerin son sürüm zamanını içeriyor. Plugin Radar bu anlık görüntüleri okur (son 30 gün her gün, öncesi haftalık), eklenti başına 50'ye kadar sürüm tarihi saklar ve mevcut sürümü bir öncekiyle karşılaştırır. "7 gün önce güncellendi · 52 gün aradan sonra" bilgisi bu yüzden yıllarca sessiz kalmış eklentilerde bile kesindir.

## Ağ kullanımı ve gizlilik

- `raw.githubusercontent.com`: herkese açık eklenti listesi, istatistik anlık görüntüleri ve README'ler.
- `api.github.com`: anlık görüntü listesi (geçmiş kurulumu/yenilemede 1–4 istek, kimliksiz, saatte 60 sınırı).
- Çeviri sağlayıcınız: **yalnızca** *Çevir*'e bastığınızda ve bir sağlayıcı ayarladıysanız; yalnızca eklenti açıklamaları gönderilir.

Telemetri yok, hesap yok, vault'unuzla ilgili hiçbir şey gönderilmez. API anahtarları Obsidian'ın anahtar deposunda (SecretStorage) cihaz başına saklanır, `data.json`'a yazılmaz; eklenti yalnızca anahtarın adını (ör. `anthropic-api-key`) saklar.

## Geliştirme

Derleme adımı yok; `main.js` eklentinin kendisi. Testler Node'da, ağsız çalışır: `npm install && npm test`.

## Lisans

[MIT](LICENSE) © Ali Tekdemir

# Nasıl çalışır

*[English](how-it-works.md) · Türkçe*

## Veri nereden geliyor

Obsidian'ın [`obsidian-releases`](https://github.com/obsidianmd/obsidian-releases) deposu `community-plugin-stats.json` dosyasını Ekim 2020'den bu yana **her gün** commit'ler. Her anlık görüntü, her eklentinin indirme sayısını ve son sürüm zamanını tutar.

Günde bir kez bir [GitHub Actions iş akışı](../.github/workflows/metrics.yml) bu anlık görüntülerin hepsini baştan oynatır ve sonucu bu deponun `metrics` dalında yayımlar: eklenti başına en fazla 50 sürüm tarihi, ilk göründüğü gün, son bir yıldaki indirmeleri (son ay gün gün, öncesi hafta hafta), 1K, 5K, 10K, 25K, 50K ve 100K indirmeyi ne zaman geçtiği ve Obsidian'ın listesinden çıkardığı eklentiler (ne zaman ve neden). Community Radar bu dosyayı (yaklaşık 1 MB) bir kez indirir; sonrasında her eşitleme yalnızca son haftanın değişikliklerini (`delta.json`, yaklaşık 150 KB) indirip kendi kopyasına ekler. Bir haftadan eski bir kopya dosyanın tamamını yeniden alır. "4 gün önce (70 günlük kuluçkadan sonra)" bilgisinin yıllarca sessiz kalmış eklentiler için bile tam doğru olması, *Yeni*'nin bir eklentinin ne zaman listelendiğini bilmesi ve `gain(21d)` ya da `milestone(10k)`'nın her pencere ya da sayı için çalışması bu sayededir.

Birbirine bir hafta içinde çıkan sürümler tek bir **güncelleme dalgası** sayılır; böylece sürümden bir gün sonra düzeltme yayımlayan bir eklenti iki kez sayılmaz. *Güncellenen*, 180 günde 9'dan fazla dalgası olan eklentileri dışarıda bırakır (sorgusunda `releases(180d) <= 9`). Kuluçka, dalgalar arasındaki 30+ günlük bir duraklamadır. Ondan sonraki ilk sürüm eklentinin **kuluçkadan çıkışıdır**: `incubated` duraklamanın ne kadar sürdüğü, `hatched` ne kadar önce bittiğidir. Her eklenti kuluçkadan çıktıktan sonra aynı 30 gün boyunca *Kuluçka*'da kalır (en sonuncusu en üstte); sonraki sürümler, bir hotfix ya da bir sonraki güncelleme, bunu geri almaz.

## Benzerler

*Benzerleri* aynı işi yapan eklentileri listeler. Her eklentinin en yakın 50 eklentisi GitHub'da hesaplanır ([scripts/similar](../scripts/similar/build.py), saatlik [profil iş akışıyla](../.github/workflows/profiles.yml)); beş şeye bakılır, ağırlıklar 2-1-3-1-1:

- **açıklaması**: IBM'in açık [granite-embedding-311m-multilingual-r2](https://huggingface.co/ibm-granite/granite-embedding-311m-multilingual-r2) modeliyle (Apache 2.0, [embeddings iş akışı](../.github/workflows/embeddings.yml)) her gün vektöre çevrilir; farklı kelimeler ve diller arasında anlam eşleşir,
- **adı**,
- **AI genel bakışı** (özet, çözdüğü sorun, yaptıkları), kelime kelime,
- **kategorisi** ve
- **etiketleri**; nadir bir ortak etiket daha çok sayılır.

Bu ağırlıklar elle puanlanmış 50 eklentiyle yapılan kör bir testi kazandı: ilk 5, yalnızca açıklama vektörüne göre yaklaşık üçte bir daha yüksek puan aldı (nDCG@5 0,77 / 0,56). Aynı test her yayından önce çalışır; daha düşük puan alan liste yayımlanmaz. Listeler `profiles` dalında `similar.json` olarak durur; Community Radar onları Eşitleme ile indirir ve yalnızca içlerine bakar. *Çok yakın* ilk 5, *yakın* sonraki 10, *ilgili* gerisidir; "Ortak" iki eklentinin paylaştığı kategori ve etiketleri gösterir. Son saatlerde listelenen bir eklentinin listesi bir sonraki hesaplamaya kadar olmaz. Hiçbir yapay zekâ sağlayıcısı devreye girmez.

## AI profilleri

Her saat bir [GitHub Actions iş akışı](../.github/workflows/profiles.yml), yeni ya da değişen her eklentinin README'sini ücretsiz bir yapay zekâ modeline okutup kısa bir profil yazdırır: özet, çözdüğü sorun, yaptıkları, kategorisi (78'lik sabit listeden) ve etiketleri (yaklaşık 500'lük sabit listeden), neye ihtiyaç duyduğu (API anahtarı, ücretli hizmet, hesap…). Başka dilde olup İngilizce sürüme (`README_en.md`…) bağlantı veren ya da İngilizce bir bölüm içeren README İngilizcesinden okunur. Profiller `profiles` dalında yayımlanır; her biri onu yazan modeli ve okuduğu dosyayı kaydeder. Community Radar bunların dizinini günde bir kez ve yalnızca değiştiyse indirir; bir eklentinin profilinin tamamını ayrıntılarını açtığınızda okur. Cihazınız bunlar için yapay zekâ isteği yapmaz; yalnızca Genel bakışı kendi dilinizde istediğinizde bu, bir kez kendi yapay zekâ sağlayıcınıza gider ve `translations.jsonl`'da saklanır.

## Ağ

Community Radar yalnızca şu istekleri yapar:

| Hedef | Ne zaman | Ne |
|---|---|---|
| `raw.githubusercontent.com` | Eşitleme, README güncellemeleri | Herkese açık eklenti listesi ve istatistikleri, eklenti README'leri |
| `api.github.com` | Yalnızca README alışılmış bir yolda değilse | README. Kimlik doğrulamasız, saatte 60 istek |
| `raw.githubusercontent.com/alitekdemir/obsidian-community-radar/metrics/` | Eşitleme, daha yeni bir derleme çıktığında | Sürüm geçmişi ve indirme metrikleri (~600 KB) |
| `raw.githubusercontent.com/alitekdemir/obsidian-community-radar/profiles/` | Eşitleme, günde en fazla bir kez ve yalnızca değiştiyse; ayrıntılar penceresi | AI profillerinin dizini (~5,6 MB), Benzerleri listeleri (~2,8 MB, sıkıştırılmış ~1,2 MB gelir), tek eklentinin profili (~2 KB) |
| Yapay zekâ sağlayıcınız (`api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com` ya da `openrouter.ai`) | **Yalnızca** bir sağlayıcı ayarlıyken çeviri yaptığınızda ya da grup önerisi istediğinizde | Eklenti adları ve açıklamaları, gruplarınızın adları ve çevirmesini istediğiniz README ya da Genel bakış |

Telemetri yok, hesap yok, kasanız hakkında hiçbir şey hiçbir yere gönderilmez. Community Radar kasada yalnızca kendi not klasöründeki notları okuyup yazar; diğer dosyalarınızı hiç listelemez. API anahtarları her cihazda Obsidian'ın anahtar deposunda (SecretStorage) tutulur, asla `data.json`'da değil; eklenti yalnızca anahtarın adını (örn. `anthropic-api-key`) saklar, böylece aynı adı kullanan diğer eklentiler anahtarı paylaşır. Kurulu eklentilerin listesi Obsidian'ın dahili `app.plugins` nesnesinden gelir.

## Depolama

| Veri | Nerede |
|---|---|
| Gruplarınız, puanlarınız, durumlarınız, notlarınız, inceleme tarihleri | Takip notlarınız |
| Ayarlar, sayfa sorguları, kayıtlı görünümler, dışlanan eklentiler, çeviriler, son işlemler | `.obsidian/plugins/plugin-radar/data.json` |
| Katalog, sürüm geçmişi, vektörler ve AI profilleri (önbellek, gerektiğinde yeniden oluşturulur) | `.obsidian/plugins/plugin-radar/cache/` |

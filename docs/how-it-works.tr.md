# Nasıl çalışır

*[English](how-it-works.md) · Türkçe*

## Veri nereden geliyor

Obsidian'ın [`obsidian-releases`](https://github.com/obsidianmd/obsidian-releases) deposu `community-plugin-stats.json` dosyasını Ekim 2020'den bu yana **her gün** commit'ler. Her anlık görüntü, her eklentinin indirme sayısını ve son sürüm zamanını tutar.

Günde bir kez bir [GitHub Actions iş akışı](../.github/workflows/metrics.yml) bu anlık görüntülerin hepsini baştan oynatır ve sonucu bu deponun `metrics` dalında yayımlar: eklenti başına en fazla 50 sürüm tarihi, ilk göründüğü gün, son bir yıldaki indirmeleri (son ay gün gün, öncesi hafta hafta), 1K, 5K, 10K, 25K, 50K ve 100K indirmeyi ne zaman geçtiği ve Obsidian'ın listesinden çıkardığı eklentiler (ne zaman ve neden). Community Radar bu dosyayı (yaklaşık 1 MB) bir kez indirir; sonrasında her eşitleme yalnızca son haftanın değişikliklerini (`delta.json`, yaklaşık 150 KB) indirip kendi kopyasına ekler. Bir haftadan eski bir kopya dosyanın tamamını yeniden alır. "4 gün önce (70 günlük kuluçkadan sonra)" bilgisinin yıllarca sessiz kalmış eklentiler için bile tam doğru olması, *Yeni*'nin bir eklentinin ne zaman listelendiğini bilmesi ve `gain(21d)` ya da `milestone(10k)`'nın her pencere ya da sayı için çalışması bu sayededir.

Birbirine bir hafta içinde çıkan sürümler tek bir **güncelleme dalgası** sayılır; böylece sürümden bir gün sonra düzeltme yayımlayan bir eklenti iki kez sayılmaz. *Güncellenen*, 180 günde 9'dan fazla dalgası olan eklentileri dışarıda bırakır (sorgusunda `releases(180d) <= 9`). Kuluçka, dalgalar arasındaki 30+ günlük bir duraklamadır. Ondan sonraki ilk sürüm eklentinin **kuluçkadan çıkışıdır**: `incubated` duraklamanın ne kadar sürdüğü, `hatched` ne kadar önce bittiğidir. Her eklenti kuluçkadan çıktıktan sonra aynı 30 gün boyunca *Kuluçka*'da kalır (en sonuncusu en üstte); sonraki sürümler, bir hotfix ya da bir sonraki güncelleme, bunu geri almaz.

## Benzerler

*Benzerleri* anlamları karşılaştırır. Günde bir kez bir [GitHub Actions iş akışı](../.github/workflows/embeddings.yml) her eklentinin adını ve açıklamasını IBM'in açık [granite-embedding-311m-multilingual-r2](https://huggingface.co/ibm-granite/granite-embedding-311m-multilingual-r2) modeliyle (Apache 2.0; yalnızca yeni ya da düzenlenmiş eklentiler yeniden kodlanır) bir vektöre çevirir ve `embeddings` dalında yayımlar. Community Radar bu dosyayı indirir ve eklentileri cihazınızda kosinüs benzerliğine göre sıralar; nadir ama ortak bir kelime de sayılsın diye küçük bir pay ortak kelime eşleşmesi (BM25) ekler. Hiçbir yapay zekâ sağlayıcısı devreye girmez.

## Ağ

Community Radar yalnızca şu istekleri yapar:

| Hedef | Ne zaman | Ne |
|---|---|---|
| `raw.githubusercontent.com` | Eşitleme, README güncellemeleri | Herkese açık eklenti listesi ve istatistikleri, eklenti README'leri |
| `api.github.com` | Yalnızca README alışılmış bir yolda değilse | README. Kimlik doğrulamasız, saatte 60 istek |
| `raw.githubusercontent.com/alitekdemir/obsidian-community-radar/metrics/` | Eşitleme, daha yeni bir derleme çıktığında | Sürüm geçmişi ve indirme metrikleri (~600 KB) |
| `raw.githubusercontent.com/alitekdemir/obsidian-community-radar/embeddings/` | Eşitleme, daha yeni bir derleme çıktığında | Benzerler için vektörler (~2,5 MB) |
| Yapay zekâ sağlayıcınız (`api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com` ya da `openrouter.ai`) | **Yalnızca** bir sağlayıcı ayarlıyken çeviri yaptığınızda ya da grup önerisi istediğinizde | Eklenti adları ve açıklamaları, gruplarınızın adları ve çevirmesini istediğiniz README |

Telemetri yok, hesap yok, kasanız hakkında hiçbir şey hiçbir yere gönderilmez. Community Radar kasada yalnızca kendi not klasöründeki notları okuyup yazar; diğer dosyalarınızı hiç listelemez. API anahtarları her cihazda Obsidian'ın anahtar deposunda (SecretStorage) tutulur, asla `data.json`'da değil; eklenti yalnızca anahtarın adını (örn. `anthropic-api-key`) saklar, böylece aynı adı kullanan diğer eklentiler anahtarı paylaşır. Kurulu eklentilerin listesi Obsidian'ın dahili `app.plugins` nesnesinden gelir.

## Depolama

| Veri | Nerede |
|---|---|
| Gruplarınız, favorileriniz, puanlarınız, durumlarınız, notlarınız, inceleme tarihleri | Takip notlarınız |
| Ayarlar, sayfa sorguları, kayıtlı görünümler, dışlanan eklentiler, çeviriler, son işlemler | `.obsidian/plugins/plugin-radar/data.json` |
| Katalog, sürüm geçmişi ve vektörler (önbellek, gerektiğinde yeniden oluşturulur) | `.obsidian/plugins/plugin-radar/cache/` |

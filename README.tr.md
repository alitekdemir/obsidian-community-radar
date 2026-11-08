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
| **Takip** | Takip ettiğiniz eklentiler; her grup için ayrı bölümde (iki gruptaki eklenti ikisinde de görünür); Tümü, Yeni sürüm çıkanlar, Favoriler, Grupsuz ve gruplarınız tek Grup menüsünde |
| **Öneriler** | Kurulu olan ama henüz favori yapmadığınız eklentiler |

![Tümü sekmesi: indirme, son güncelleme, sessizlik süresi ve README / GitHub bağlantılarıyla bütün eklentiler](docs/images/Radar_1-All.png)

Eklenti adına tıklamak, Obsidian'ın kendi eklenti tarayıcısında o eklentinin sayfasını açar; kurulum orada yapılır. Satırdaki **README**, eklentinin README'sini Obsidian içinde, takip notunda açar.

**Favori** yaptığınız ya da **gruba eklediğiniz** eklentiler vault'unuzda README'leriyle birlikte küçük notlara dönüşür; [Bases](https://help.obsidian.md/bases) ile tablo olarak görüp düzenleyebilirsiniz. **Dışladığınız** eklentiler bir daha görünmez.

![Uyananlar sekmesi: en az 90 gün sessiz kaldıktan sonra son 14 günde sürüm çıkaranlar, en uzun ara üstte](docs/images/Radar_3-Revived.png)

![Takip sekmesi: eklentileriniz grup başına renkli bölümlerde, puana göre sıralı](docs/images/Radar_9-Tracked.png)

## Özellikler

- **Her sekmede filtreler**: *İndirme ≥* sekme başına açılıp kapanan bir çip; gün aralığı yazılabilir (ör. son 1 gün) ya da seçilebilir; sıralama indirme, son güncelleme, A–Z ya da listeye giriş tarihine göre, iki yönde.
- **Arama**: virgülle ayrılmış terimler (hepsi eşleşmeli) ya da Obsidian'ın aramasındaki gibi `/düzenli ifade/`, ör. `/project.+task/`.
- **Zamanlanmış eşitleme**: 6 saatte bir, günde bir, haftada bir ya da elle. Panel son eşitlemenin ne zaman yapıldığını ve ne getirdiğini gösterir (*Son eşitlemeden beri: 5 yeni · 23 güncelleme*).
- **Takip notunda README**: yeni sürüm çıkınca not açıldığında, her eşitlemede ya da yalnızca istendiğinde yenilenir. Kendi notlarınıza dokunulmaz.
- **Açıklama çevirisi**: kendi API anahtarınızla Claude, OpenAI, Gemini ya da OpenRouter. Bir sayfa tek istekte çevrilir, çeviriler saklanır.
- **Gruplar**: bir eklenti birden çok grupta olabilir (`groups` listesi). Grup penceresi gruplarınızdan en yakınını ★ ile işaretler, AI önerilerini açıp kapatabileceğiniz çipler olarak gösterir. ⋮ menüsündeki **Bu listedekilere grup öner**, baktığınız listenin her satırının altına AI önerilerini getirir (en çok 50, tek istek); öneriler hem Türkçe hem yaygın İngilizce karşılığıyla gelir (*Yapay Zekâ* ve *AI*). Satırlarda seçersiniz; **Kabul et**'e basılana kadar hiçbir şey kaydedilmez.
- **Anlamca benzer eklentiler**: satırdaki *Benzerleri* en yakın 3 eklentiyi gösterir; *Tümünü gör* tam listeyi satırın bütün işlemleriyle açar: yakınlığa (ya da indirme, son güncelleme, A–Z, en yeni) göre sıralanır, içinde arama yapılır. Her sonuç ne kadar yakın olduğunu (*çok yakın*, *yakın*, *ilgili*) ve ortak terimlerini gösterir. Bir sonuçtaki *Benzerleri* bir adım daha ilerler; üstteki iz (`← Tümü › Periodic Notes › Periodic Calendar`) geri götürür. Anlam, bu reponun GitHub Actions'ında her gün açık bir modelle üretilen vektörlerden gelir; cihazınız yalnızca dosyayı indirir (~2,5 MB) ve karşılaştırır — AI isteği yok, anahtar yok. Dosya inene kadar ortak kelimelere göre eşleştirilir.

  ![Satırın altında Benzerleri: en iyi üç eşleşme ve ortak terimleri](docs/images/Radar_8-Similar_Preview.png)

  ![Benzerler listesi: geldiğiniz sekmeye dönen iz, eşleşme sayısı, her sonuçta yakınlık ve ortak terimler](docs/images/Radar_7-Similar.png)

- **Kartlar**: *Liste / Kart* geçişi her sekmeyi kart olarak gösterir. Bir karta — ya da satırdaki açıklamaya — tıklayın veya `Enter`'a basın; kart büyüyerek **ayrıntı penceresine** dönüşür: indirme, son sürüm, listeye ne zaman girdiği ve ne sıklıkla sürüm çıkardığı; açıklamanın tamamı ve çevirisi; notunuz; README; en yakın beş eklenti; zaman çizgisinde sürüm geçmişi ve işlemler. `←` / `→` listede gezinir.

  ![Kart görünümü](docs/images/Radar_10-Cards.png)

  ![Bir eklentinin ayrıntı penceresi](docs/images/Radar_11-Details.png)

- **Kendi dilinizde README**, istenince: ayrıntı penceresindeki *README · <dil>* sekmesi README'yi AI sağlayıcınızla çevirir (boyutu ve model fiyatı biliniyorsa maliyeti gösterir) ve çeviriyi takip notunda özgününün üstünde saklar. Yeni sürüm README'yi değiştirince *eski* olarak işaretlenir.

- **Puan**: satırdaki ☆'ın üzerine gelip 1–5 yıldız verin (`rating`). Takip sekmesi puana göre sıralar; her grubun en beğendikleri üstte.
- **Yeni sürümler**: Takip sekmesinde sarı sayı, satırda *YENİ SÜRÜM* sinyali, Grup menüsünde *Yeni sürüm çıkanlar* ve *Hepsini incelendi say*.
- **Durum** (isteğe bağlı, varsayılan kapalı): emojili kendi durum listeniz — ör. 🔖 Denenecek, 👀 İzleniyor, 🧪 Deneniyor, ✅ Benimsendi, 🔁 Yerine başkası — ayarlardan düzenlenir, `status` olarak saklanır.
- Kolay taranan satırlar: adla aynı satırda tarih ve indirme (indirmeler liste boyunca alt alta hizalanır), altında sinyaller ve notunuz (gruplar, durum, puan), açıklama, en altta solda bağlantılar ve sağda işlemler. Sessizlik süresi yalnızca uzunsa görünür (*N gün sessizlikten sonra*). Bir işlemle listeden çıkan satır, panel yeniden açılana kadar soluk olarak yerinde kalır.
- **Sonraki sürüme kadar gizle**: eklenti yeni sürüm çıkarınca kendiliğinden geri gelir. Dışlananlar ve önerilmeyenler panelin ⋮ menüsünden; arama ve *Geri al* ile açılır.
- **Sessizlik süresine göre sıralama** ve **klavye** (varsayılan kapalı; *Ayarlar → Klavye kısayolları*): sekme etkinken `j`/`k` vurguyu taşır; `f` favori, `g` gruplar, `x` dışla, `h` sonraki sürüme kadar gizle, `t` çevir, `r` README, `s` benzerleri, `o` aç, `Enter` ayrıntılar, `1`–`5` puan, `0` puanı sil. Filtre çubuğundaki ⌨ simgesi listeyi gösterir.

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
| Not klasörü | Takip notlarının oluşturulacağı yer (varsayılan: *Community Radar*) |
| Notlarınızın başlığı | Yeni takip notlarında kendi notlarınızın üstündeki başlık (varsayılan: arayüz dilinde *Notlarım*) |
| README çevirisi | İstenince (ayrıntı penceresi, komut) ya da kapalı |
| Grup öner | Takip sekmesinin *Grupsuz* listesini gruplama modunda açar |
| Klavye kısayolları | Varsayılan kapalı |
| Durum alanı | Varsayılan kapalı; durum ekleyin, adlandırın (emoji olur), sıralayın ya da kaldırın |
| Listeler | *Yönet*, dışlananları ya da önerilmeyenleri panelde açar |
| Bases görünümü | Takip notlarının Bases tablosunu **Oluştur** ya da **Sıfırla** |
| Eşitleme sıklığı | Elle · 6 saatte bir · **Günde bir** · Haftada bir. Eşitlemeler arasında hiçbir şey indirilmez. **Şimdi eşitle** hemen çalıştırır. |
| README güncelleme | **Notu açtığımda** · Her eşitlemede · Elle (komut paleti) |
| Geçmiş derinliği | 3, 6, 12 ya da 24 ay |
| AI | Sağlayıcı, API anahtarı (Obsidian'ın anahtar deposundan), model, hedef dil — çeviri ve grup önerileri için |

## Nasıl çalışır

Obsidian'ın [`obsidian-releases`](https://github.com/obsidianmd/obsidian-releases) reposu `community-plugin-stats.json` dosyasını **her gün** commit'liyor; her anlık görüntü tüm eklentilerin son sürüm zamanını içeriyor. Community Radar bu anlık görüntüleri okur (son 30 gün her gün, öncesi haftalık), eklenti başına 50'ye kadar sürüm tarihi saklar ve mevcut sürümü bir öncekiyle karşılaştırır. "7 gün önce güncellendi · 52 gün sessizlikten sonra" bilgisi bu yüzden yıllarca sessiz kalmış eklentilerde bile kesindir.

*Benzerleri* anlamları karşılaştırır: her gün bir [GitHub Actions iş akışı](.github/workflows/embeddings.yml), her eklentinin adını ve açıklamasını IBM'in açık [granite-embedding-311m-multilingual-r2](https://huggingface.co/ibm-granite/granite-embedding-311m-multilingual-r2) modeliyle vektöre çevirir (yalnızca yeni ya da değişen eklentiler; Apache 2.0) ve `embeddings` dalında yayınlar. Eklenti bu dosyayı indirir, eklentileri cihazınızda kosinüs benzerliğine göre sıralar; nadir ortak bir ad yine sayılsın diye kelime eşleşmesinden (BM25) küçük bir pay ekler.

## Ağ kullanımı ve gizlilik

- `raw.githubusercontent.com`: herkese açık eklenti listesi, istatistik anlık görüntüleri ve README'ler.
- `raw.githubusercontent.com/alitekdemir/obsidian-community-radar/embeddings/`: Benzerleri için anlam vektörleri (~2,5 MB), eşitlemede ve yalnızca yeni bir derleme çıktıysa.
- `api.github.com`: anlık görüntü listesi (geçmiş kurulumu ve eşitlemede 1–4 istek, kimliksiz, saatte 60 sınırı).
- AI sağlayıcınız: **yalnızca** çeviri ya da grup önerisi istediğinizde ve bir sağlayıcı ayarladıysanız; eklenti adları, açıklamaları, grup adlarınız ve çevirmesini istediğiniz README gönderilir.

Telemetri yok, hesap yok, vault'unuzla ilgili hiçbir şey gönderilmez. Vault içinde eklenti yalnızca kendi not klasöründeki notları okur ve yazar; diğer dosyalarınızı listelemez. API anahtarları Obsidian'ın anahtar deposunda (SecretStorage) cihaz başına saklanır, `data.json`'a yazılmaz; eklenti yalnızca anahtarın adını (ör. `anthropic-api-key`) saklar.

## Geliştirme

Kaynak `src/*.js` (dosya adı sırasıyla birleştirilir); `npm run build`, `locales/*.json` dosyalarını Obsidian'ın yüklediği `main.js` içine gömer. Testler Node'da, ağsız çalışır: `npm install && npm test`.

## Lisans

[MIT](LICENSE) © Ali Tekdemir

<div align="center">

# Community Radar

**Obsidian eklenti mağazasını canlı bir keşif motoruna ve kişisel kürasyon merkezine dönüştürün.**

Hızla yükselen yeni eklentileri yakalayın, uzun bir sessizlikten uyananları kaçırmayın, kataloğu bir veritabanı gibi sorgulayın, anlamca benzer alternatifleri bulun ve önemsediğiniz eklentileri vault'unuzda yaşayan Markdown notları olarak yönetin.

[![Obsidian](https://img.shields.io/badge/Obsidian-%E2%89%A51.9.0-7C3AED?logo=obsidian&logoColor=white)](https://obsidian.md)
[![Lisans: MIT](https://img.shields.io/badge/Lisans-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Masa%C3%BCst%C3%BC%20%26%20Mobil-Destekleniyor-blue)](#kurulum)

*[English](README.md) · Türkçe*

</div>

![Community Radar: ana sayfa, sorgu, tablo, detay, benzerler, takip](docs/images/demo.webp)

---

## Neden Community Radar?

Obsidian'ın yerleşik eklenti tarayıcısı adını bildiğiniz bir eklentiyi kurmak için yeterlidir; ancak binlerce eklentilik ekosistemde gerçek bir keşif yapmak istediğinizde hızla duvara çarpar:

- **Toplam indirme sayıları bugünkü ivmeyi gizler.** Beş yıllık dev eklentiler hep en üstte dururken, bu hafta bin yeni kullanıcı kazanan parlak bir eklenti diplerde kaybolur. Community Radar, **Ekim 2020'den bu yana her gün tutulan sürüm arşivini** işleyerek son 7 ve 30 günlük gerçek büyümeyi, aşılan indirme barajlarını ve sürüm ritmini görünür kılar.
- **Sürekli yama çıkaranlar gerçek geri dönüşleri ezer.** İki günde bir ufak düzeltme yayınlayan eklentiler, diğer her şeyi ekranın dışına iter. Community Radar peş peşe çıkan yamaları *güncelleme dalgaları* olarak gruplar; gürültüyü susturup aylar (hatta yıllar) sonra dev bir güncellemeyle uyanan eklentileri sahneye çıkarır.
- **"Buna sonra bakayım" dedikleriniz kaybolur.** Tarayıcı sekmeleri ve dağınık notlar unutulur. Burada bir eklentiyi yıldızladığınızda veya grupladığınızda vault'unuzda puanınızı, durumunu, kişisel notlarınızı ve her zaman güncel kalan README'sini barındıran düzenli bir not oluşur; tek tıkla **Obsidian Bases** tablosuna dönüşür.

---

## Öne Çıkan Özellikler

### 🏠 Son Baktığınızdan Beri Neler Değişti?

![Ana sayfa: son 7 gün ve keşif kartları](docs/images/home.png)

Sonsuz bir alfabetik listeye düşmek yerine doğrudan **Ana Sayfa (Home)** ile başlarsınız.

En üstteki **Henüz görülmedi** şeridi; yeni çıkan eklentileri, takip ettiklerinizin yeni sürümlerini, yeni aşılan indirme barajlarını ve sessiz güncellemeleri sayar. Sayaçlar Obsidian'ı kapatıp açtığınızda değil, **yalnızca ilgili listeyi açıp baktığınızda** sıfırlanır. Hemen altında sürükleyip sıralayabileceğiniz keşif kartları yer alır: *Yeni gelenler*, *Barajlar* (`1K`–`100K`), *Kuluçkadan çıkanlar*, *Yükselenler*, *Sessiz güncellemeler* ve *Takip ettiklerinizin yeni sürümleri*. Her kartın zaman aralığını veya eşiğini doğrudan üzerinden değiştirebilir, **N yeni** rozetine tıklayarak yalnızca son incelemenizden beri gelenleri açabilirsiniz.

---

### 🥚 Geri Dönenleri Yakalayın, Gürültüyü Susturun

![Kuluçka: uzun bir aradan sonra yeniden sürüm çıkaran eklentiler](docs/images/incubation.png)

Ekosistemdeki en heyecan verici anlardan biri, terk edildiğini sandığınız sevilen bir eklentinin aylar sonra yepyeni bir sürümle geri dönmesidir; ancak sıradan bir listede bu dönüş birkaç saat içinde günlük yamaların altında kaybolur.

- **Kuluçka (Incubation)**, en az 60–360+ gün sessiz kaldıktan sonra yeniden sürüm çıkaran eklentileri yakalar ve *"4 gün önce (1.462 günlük kuluçkadan sonra)"* gibi net bir bağlamla sunar. Üstelik bir eklenti ne kadar uzun süre uyuduysa bu listede o kadar uzun süre görünür kalır.
- **Güncellenen (Updated)** sekmesi ise çok sık sürüm çıkaranları (6 ayda 9'dan fazla güncelleme dalgası) otomatik olarak kenara çekerek daha seyrek ama anlamlı güncellemelerin görülmesini sağlar.

---

### 🔍 İster Görsel Filtreler, İster JQL Seviyesinde Sorgu Motoru

![Sorgu kutusu: renkler, değişiklik rozeti ve kaydetme seçenekleri](docs/images/query-save.png)

Görsel kontrollerle mi çalışmak istiyorsunuz? **Basic** modunda arama terimlerini, `/regex/` ifadelerini ve **Filtre** menüsündeki hızlı çipleri kullanın. Tam kontrol mü istiyorsunuz? Tek tıkla **Query** moduna geçin—çünkü kaputun altında **Community Radar'daki her sekme aslında okunabilir ve değiştirilebilir bir sorgudur**:

```sql
age <= 30d AND downloads >= 50 AND NOT tracked
order by gain30 desc
```

- **27 sorgu alanı ve tarih fonksiyonları:** `gain7`, `rise30` (% büyüme), `gap`, `milestone`, `installed`, `group`, `rating` gibi alanların yanında `startOfMonth(-1)` veya `lastSync()` gibi dinamik fonksiyonlarla dilediğiniz soruyu sorun.
- **Yazarken rehberlik eder:** `Ctrl+Space` ile kendi gruplarınızı, durumlarınızı ve eklenti yazarlarını öneren otomatik tamamlamayı açın; herhangi bir kelimenin üzerine gelerek ne anlama geldiğini görün veya `?` ile tıklanabilir kopya kağıdına göz atın. Hiç sonuç çıkmazsa, **listeyi hangi koşulun sıfırladığını** bile size söyler.
- **Kaydedilmiş Görünümler (Saved Views):** Değiştirdiğiniz bir sorguyu **Görünüm** olarak kaydedin; hem üst şeritte kendi sekmesine kavuşsun (görülmemiş eşleşmeleri `+N` rozetiyle sayarak) hem de Ana Sayfaya bir kart olarak yerleşsin. → *[Sorgu Dili Rehberi](docs/query.md)*

---

### ≈ Anlamca Benzer Eklentileri Bulun — %100 Cihazınızda

![Templater'a anlamca en yakın eklentiler](docs/images/similar.png)

Aynı işi yapan alternatifleri bulmak için geliştiricinin kullandığı kelimeleri tahmin etmek zorunda değilsiniz. Herhangi bir eklentide **Benzerleri →** bağlantısına tıklayın; ortak kelimeleri olmasa bile işlevce en yakın 300 eklenti (*çok yakın*, *yakın*, *ilgili* dereceleri ve ortak terimleriyle) anında sıralansın.

> **API anahtarı yok, bulut sorgusu yok:** Çok dilli anlam vektörleri her gün GitHub Actions üzerinde açık kaynaklı bir modelle hazırlanır. Cihazınız eşitleme sırasında yalnızca ~2,5 MB'lık özet dizini indirir ve kosinüs benzerliği ile BM25 kelime eşleşmesini **tamamen çevrimdışı olarak kendi üzerinde** hesaplar. Keşif zincirinde eklentiden eklentiye atlayabilir, `Esc` ile başladığınız noktaya anında dönebilirsiniz.

---

### 📊 Liste, Kart veya Özel Tablo — Hızlı Eleme İçin Tasarlandı

![Sütun seçici ile tablo görünümü](docs/images/table.png)

O anki işinize en uygun düzende çalışın:

- **Üç farklı görünüm:** Yoğun **Liste**, görsel **Kartlar** veya sürüklenebilir **16 sütunlu Tablo** (7/30 günlük indirme artışı, yüzdesel büyüme, barajlar, sürüm ritmi ve tek tıkla ★/puan değiştirme dahil) arasında geçiş yapın. Her sekme ve kaydedilmiş görünüm kendi sütun düzenini hatırlar.
- **Akıllı Geri Al destekli toplu işlemler:** Satırları tek tek, `Shift+Tık` aralığıyla veya Gmail tarzı *Listedeki tüm N eklentiyi seç* ile işaretleyip topluca favorileyin, puanlayın, gruplayın, incelendi sayın, sonraki sürüme kadar gizleyin veya dışlayın. **Son işlemler** son 20 toplu değişikliği oturumlar arasında saklar; **Geri Al (Undo)** ise işlemden sonra elle düzenlediğiniz notlara dokunmadan geri kalanları güvenle eski haline döndürür.
- **Zengin detay penceresi ve klavye akışı:** Herhangi bir satıra tıklayarak (`Enter`) dört temel metriği, duraklama sürelerini renklerle gösteren görsel sürüm şeridini, en yakın 5 alternatifi ve tam README'yi inceleyin. İsterseniz Ayarlardan Vim tarzı kısayolları (`j`/`k`, `f`, `g`, `1`–`5`, `s`, `h`, `x`) açarak fareye dokunmadan çalışın.

![Detay penceresi: istatistikler, README, sürüm geçmişi ve benzer eklentiler](docs/images/details.png)

---

### 📝 Yaşayan Vault Notları, Obsidian Bases ve İsteğe Bağlı AI

![Grup bölümlerine ayrılmış takip edilen eklentiler](docs/images/tracked.png)

Community Radar kürasyonunuzu kapalı bir veritabanına hapsetmez. Bir eklentiyi yıldızladığınız (**☆**) veya bir gruba eklediğiniz (**＋**) anda vault'unuzda temiz bir Markdown notu oluşturur:

- **Yapılandırılmış özellikler + dokunulmayan kişisel notlar:** `groups`, `favorite`, `rating` (1–5), emojili özel `status` alanları ve kişisel notlarınız tamamen size aittir; indirme/sürüm bilgileri ile gömülü **README** ise otomatik güncellenir (`#etiketler` ve `[[bağlantılar]]` grafiğinizi kirletmemesi için güvenli biçimde kaçış karakteriyle korunur).
- **Tek tıkla Obsidian Bases:** Ayarlardan hazır `.base` görünümünü oluşturarak tüm eklenti koleksiyonunuzu yerleşik bir Obsidian veritabanı tablosunda filtreleyin ve düzenleyin. → *[Takip Notları Rehberi](docs/tracking-notes.md)*
- **Kendi anahtarınızla AI (tamamen isteğe bağlı):** Obsidian'ın güvenli anahtar deposu üzerinden Anthropic, OpenAI, Gemini veya OpenRouter bağlayarak görünür açıklamaları topluca çevirin, eklenti README'lerini kendi dilinize aktarın (tahmini maliyet hesabı ve eski sürüm uyarısıyla) veya seçtiğiniz satırlar için tek tıkla akıllı grup önerileri alın.

---

## Kurulum

1. Obsidian'da **Ayarlar → Topluluk eklentileri → Göz at** yolunu izleyin.
2. **Community Radar** aratın, **Kur** ve **Etkinleştir** düğmelerine basın.
3. Sol şeritteki **radar simgesine** tıklayın veya Komut Paletinden `Community Radar: Community Radar'ı aç` komutunu çalıştırın.

### 60 Saniyede Başlangıç

1. **İlk eşitlemenin tamamlanmasını bekleyin:** Eklenti kataloğu, 6 yıllık sürüm arşivi ve anlamsal benzerlik dizini (~3 MB) indirilir.
2. **Ana Sayfaya göz atın:** *Henüz görülmedi* şeridine bakın ve *Yükselenler* veya *Kuluçkadan çıkanlar* gibi bir kartın listesini açın.
3. **İlk eklentinizi takip edin:** İlginizi çeken bir eklentiyi yıldızlayın (**☆**) veya gruplayın (**＋**)—Markdown notu anında vault'unuzda oluşur (dilediğiniz zaman Ayarlardan **Obsidian Bases** tablosunu da oluşturabilirsiniz).
4. **Kendi görünümünüzü yaratın:** Herhangi bir sekmede **Query** moduna geçip sekmenin kuralını görün, değiştirin ve kendi görünümünüz olarak kaydedin.

---

## Tasarımdan Gelen Gizlilik

- **Hesap yok, telemetri yok, analitik yok.** Sizden veya vault'unuzdan hiçbir veri toplanmaz.
- **Yalnızca kendi klasörüne erişir.** Community Radar sadece belirlediğiniz eklenti notları klasörünü okur ve yazar; vault'unuzun geri kalanını taramaz.
- **Açık veriler ve güvenli anahtar deposu.** Eşitleme yalnızca GitHub üzerindeki herkese açık statik dosyaları indirir. AI istekleri **yalnızca** siz çeviri veya grup önerisi istediğinizde, Obsidian'ın cihaz içi anahtar deposunda (`SecretStorage`) saklanan anahtarınızla yapılır. → *[Tüm ağ isteklerinin tam listesi](docs/how-it-works.md#network)*

---

## Dokümantasyon

| Rehber | İçerik |
|---|---|
| **[Sorgu Dili](docs/query.md)** | 27 alanın tamamı, operatörler, tarih fonksiyonları, otomatik tamamlama ve örnek sorgular |
| **[Takip Notları ve Bases](docs/tracking-notes.md)** | Not özellikleri (frontmatter), README güncelleme modları, çeviriler ve Obsidian Bases kurulumu |
| **[Ayarlar ve Komutlar](docs/settings-commands.md)** | Tüm ayarlar, Komut Paleti eylemleri ve klavye kısayolları |
| **[Nasıl Çalışır ve Gizlilik](docs/how-it-works.md)** | Sürüm arşivi mimarisi, yerel vektör eşleştirme, depolama yapısı ve ağ istekleri tablosu |
| **[Geliştirme ve Çeviri](docs/development.md)** | Kod mimarisi, çevrimdışı testlerin çalıştırılması ve yeni arayüz dili ekleme |
| **[Değişiklik Günlüğü](CHANGELOG.md)** | Sürüm geçmişi ve tüm yenilikler |

---

## Lisans

[MIT](LICENSE) © [Ali Tekdemir](https://github.com/alitekdemir) · [GitHub'da Destek Olun](https://github.com/sponsors/alitekdemir)

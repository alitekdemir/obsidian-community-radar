# Ayarlar, komutlar ve kısayollar

*[English](settings-commands.md) · Türkçe*

## Ayarlar

Ayarlar beş sekmede, her seferinde biri görünecek şekilde gelir:

| Sekme | Ayarlar |
|---|---|
| Genel | Dil (Otomatik, Obsidian'ınkini izler), görünümün nerede açılacağı (Ana sayfa ya da kaldığınız yer), Yeni eklenti süresi (bir eklentinin yeni sayıldığı gün sayısı: rozet ve Yeni kartının `listed <= 14d` sorgusu; varsayılan 14), klavye kısayolları (aşağıya bakın), destek |
| Notlar | Not klasörü, kendi notlarınızın üstündeki başlık, takip notlarınızın Bases tablosu (**Oluştur** ya da sıfırla), durum alanı ve durumlarınız (ekleme, sıralama, kaldırma) |
| Veri | Eşitleme sıklığı (Elle · 6 saatte bir · **Günde bir** · Haftada bir; eşitlemeler arasında hiçbir şey indirilmez), **Şimdi eşitle**, README güncelleme (**Notu açtığımda** · Her eşitlemede · Elle), sürüm geçmişi (**Yeniden indir**) |
| Yapay zekâ | Sağlayıcı (Anthropic, OpenAI, Google, OpenRouter), Obsidian'ın anahtar deposundan API anahtarı, model, hedef dil, README çevirisi (*İstenince* ya da *Kapalı*), çeviri talimatları (*Gelişmiş* altında katlı), model başına kullanım (istek, token, maliyet; Sıfırla), kayıtlı çeviriler |
| Gizlenenler | Kaç eklentiyi dışladığınız, sonraki sürümlerine kadar gizlediğiniz ya da Önerilerden çıkardığınız; **Yönet** o türü Gizlenenler sayfasında açar |

Bir listenin sorgusu burada değil, listenin kendisinde (**Sorgu**) değiştirilir.

## Komutlar

| Komut | |
|---|---|
| Community Radar'ı aç | Görünümü açar (şerit simgesi de aynısını yapar) |
| Ana sayfaya dön | Görünümü Ana sayfada açar; her yerden oraya atlamak için bir kısayol atayın |
| Şimdi eşitle (katalog, geçmiş, notlar) | |
| Sürüm geçmişini yeniden indir | |
| Bu notun README'sini güncelle | Bir takip notunda |
| Tüm takip notlarının README'lerini güncelle | |
| Bu notun README'sini çevir | Yapay zekâ sağlayıcısı gerekir |
| Bu notun eklentisine benzeyenleri göster | Bir takip notunda |
| Bases görünümünü oluştur ya da sıfırla | |
| Grubu olmayan eklentilere grup öner | Yapay zekâ sağlayıcısı gerekir |
| Son işlemler | Geri al seçeneğiyle son 20 toplu işlem |

Görünümün ⋮ menüsü (sağ üst): Şimdi eşitle, Görünenleri çevir, Gizlenenler, Sürüm geçmişini yeniden indir, Ayarlar. Listenin araç çubuğunun sonundaki **⋯** düğmesi: **Görünüm olarak kaydet…**

## Klavye kısayolları

*Ayarlar → Klavye kısayolları* açıkken ve Community Radar sekmesi etkinken çalışır. Araç çubuğundaki ⌨ simgesi hepsini listeler.

| Tuş | |
|---|---|
| `j` / `k` | satırlar arasında gezin |
| `Enter` | ayrıntıları aç |
| `f` | favori |
| `g` | gruplar |
| `1` … `5` / `0` | puan ver / puanı sil |
| `s` | benzerleri |
| `r` | README |
| `t` | çevir |
| `o` | Obsidian'da aç |
| `h` | sonraki sürüme kadar gizle |
| `x` | dışla (bir bildirim Geri al sunar; Gizlenenler sayfasında geri getirin) |

Her zaman açık: `/` arama kutusuna odaklanır, `Ctrl+Space` önerileri açar, `Esc` kutuyu temizler (Basit) ya da sayfanın sorgusuna döner (Sorgu). Kutunun dışında `Esc` bir seviye geri çıkar: önce Benzerler filtresi, sonra açık widget sekmesi, en son listenin kendisinden Ana sayfaya.

## Toplu seçim

Bir satırın üzerine gelip kutusunu işaretleyin (`Shift`+tıklama bir aralığı işaretler). Önce **Görünen N eklentiyi seç**, ardından **Listedeki N eklentinin hepsini seç** daha fazlasını seçer. Alttaki çubuk: Favori, Puan, Gruba ekle, Grup öner, İncelendi işaretle, Gizle, Dışla. Her biri çalışmadan önce sorar ve hemen ya da daha sonra **Son işlemler**'den geri alınabilir (Geri al, o zamandan beri değiştirdiğiniz eklentileri atlar).

# Sorgu dili

*[English](query.md) · Türkçe*

Community Radar'daki her liste bir sorgudur: *Tümü* ve Ana sayfadaki her kart (*Yeni*, *Güncellenen*, *Kuluçka*, *Öneriler*, kaydettiğiniz görünümler…). Kart kendi listesini açar; kutunun yanındaki **Sorgu**'ya basınca sorgusunu görür, değiştirirsiniz; **Basit** düz aramaya ve **Filtre** paneline döner. Değişen bir sorgu **● N değişiklik** rozeti gösterir: onu bir görünüm olarak (Ana sayfada kendi kartı olur) ya da hazır bir kartsa kartın kendi sorgusunun üzerine kaydedin (kartın **⋮ › “…” sorgusunu düzenle** seçeneği; kendi sorgunuzu kaydettikten sonra **Sorguyu varsayılana döndür** varsayılanı geri getirir).

```
downloads > 500 AND released < 30d AND group in ("Tasks", Calendar) AND NOT installed
order by gain(30d) desc
```

## Koşullar

Bir koşul `alan operatör değer` biçimindedir. Koşulları `AND`, `OR` ve `NOT` ile bağlayın, `( )` ile gruplayın. Evet/hayır alanı tek başına yazılır: `installed`, `NOT tracked`. Koşullar arasındaki boşluk da AND demektir. Satır sonları ve fazla boşluklar önemsizdir. Sorgu modunda koşul olmayan bir kelime hatadır; metin aramasını tırnak içine alın: `"daily note"`.

Sona eklenen `order by alan desc` (ya da `asc`) listeyi sıralar.

## Alanlar

| Alan | Tür | Anlamı |
|---|---|---|
| `text` | metin | ad, yazar, id, açıklama ve AI özeti birlikte (düz bir kelimenin aradığı yer) |
| `name` | metin | eklentinin adı |
| `description` | metin | açıklaması |
| `author` | metin | yazarı |
| `id` | metin | eklenti id'si |
| `downloads` | sayı | indirme sayısı |
| `released` | gün | son sürümden bu yana geçen gün ya da bir tarih |
| `listed` | gün | listede geçen gün ya da bir tarih (geçmiş Ekim 2020'de başlamadan önce listelenenler: o tarihten sayılır) |
| `incubated` | gün | son kuluçkasının ne kadar sürdüğü: güncelleme dalgaları arasındaki 30+ günlük son duraklama |
| `hatched` | gün | o kuluçkadan çıkalı geçen gün ya da bir tarih; sonraki sürümler bunu değiştirmez |
| `rating` | sayı | puanınız, 1–5 |
| `group` | liste | notunuzdaki bir grup |
| `status` | liste | notunuzdaki durum |
| `installed` | evet/hayır | bu kasada kurulu |
| `tracked` | evet/hayır | takipte (notu var) |
| `unreviewed` | evet/hayır | takipte ve incelediğinizden beri yeni sürümü var |
| `dismissed` | evet/hayır | Önerilerden çıkarılmış |
| `excluded` | evet/hayır | sizin dışladıklarınız |
| `snoozed` | evet/hayır | sonraki sürümüne kadar gizli |
| `removed` | evet/hayır | Obsidian'ın resmi listeden çıkardıkları; yalnızca kurulu olanlar ve yalnızca sorgu `removed` dediğinde görünür |

Alan adları her dilde İngilizcedir; böylece kayıtlı sorgular dil değişikliğinden etkilenmez. Değerler sizindir (grup adlarınız, durumlarınız).

## AI profili alanları

Bir yapay zekâ, GitHub'da her eklentinin README'sini okuyup kısa bir profil yazar: ne yaptığı, nereye ait olduğu, neye ihtiyaç duyduğu. Eklenti bu profilleri günde bir kez indirir. Henüz profillenmemiş bir eklentide bu alanların hiçbiri yoktur.

| Alan | Tür | Anlamı |
|---|---|---|
| `category` | liste | kategorileri: asıl kategorisi ve en çok iki tane daha |
| `primary` | metin | asıl kategorisi, her eklentinin bir tane |
| `tag` | liste | etiketleri, yaklaşık 500'lük sabit bir listeden |
| `intent` | metin | `new` (yeni bir yetenek), `improve` (bir Obsidian özelliğini iyileştirir), `alternative` (var olan bir eklentiye alternatif) |
| `lifecycle` | liste | `experimental` (deneysel) ya da `deprecated` (bırakılmış); ikisi de değilse `is empty` |
| `apikey` | evet/hayır | çalışmak için API anahtarı ister; isteğe bağlı olan sayılmaz |
| `paid` | evet/hayır | çalışmak için ücretli bir hizmet ister; isteğe bağlı olan sayılmaz |
| `summary` | metin | README'sinin AI özeti |

Kategoriler ve etiketler her dilde profillerdeki adlarıyla yazılır (`project-management`, `daily-notes`); sorgu kutusu bunları sayılarıyla önerir. Örnekler: `category = ai AND NOT apikey AND NOT paid` (anahtar ve fatura istemeyen AI eklentileri), `primary = tasks AND intent = alternative` (görev yönetiminin başka yolları), `tag = kanban order by downloads desc`.

## Parametreli alanlar

Bunlar fonksiyon gibi yazılır. Parametreyi siz belirlersiniz; `()` varsayılanı alır.

| Alan | Varsayılan | Anlamı |
|---|---|---|
| `gain(30d)` | `gain()` = 30 gün | son N günde kazanılan indirme |
| `rise(30d)` | `rise()` = 30 gün | son N gündeki % büyüme (yalnızca 1K indirmeden itibaren) |
| `releases(30d)` | `releases()` = 30 gün | son N gündeki güncellemeler (bir hafta içindeki sürümler bir kez sayılır) |
| `milestone(10k)` | `milestone()` = son barajı | N indirmeye ulaşalı geçen gün |

Her sayı olur: `gain(21d)`, `rise(45d)`, `milestone(7k)`. İndirme geçmişi son bir yılı kapsar: son ay gün gün, öncesi hafta hafta (aradaki bir pencere orantılı okunur). `( )` olmadan düz `gain` yazmak, nasıl yazılacağını söyleyen bir hata verir.

```
gain(21d) >= 500 AND NOT tracked
milestone(10k) <= 30d order by downloads desc
releases(180d) > 9
```

## Operatörler

| Tür | Operatörler |
|---|---|
| sayı, gün | `=` `!=` `>` `>=` `<` `<=` `is empty` |
| metin | `=` `!=` `~` (içerir) `!~` (içermez) `in (…)` `not in (…)` |
| liste | `=` `!=` `in (…)` `not in (…)` `is empty` |
| evet/hayır | tek başına yazılır; hayır için `NOT` |

## Gün alanlarını okumak

Gün alanı **bugünden geriye** sayar; bu yüzden küçük sayı daha yakın tarihtir:

| Yazdığınız | Anlamı |
|---|---|
| `released <= 30d` | son 30 gün **içinde** sürüm çıkmış |
| `released >= 1y` | bir yıl ya da daha uzun süredir **sürüm yok** |
| `listed <= 14d` | son iki haftada listelenmiş |
| `incubated >= 60d` | son kuluçkası **60 gün ya da daha uzun** sürmüş |
| `hatched <= 30d` | son 30 gün **içinde** kuluçkadan çıkmış |
| `milestone(10k) <= 30d` | bu ay 10K indirmeye ulaşmış |

Bir eklentinin zaman çizelgesinde dört gün alanı:

```
listed ── sürüm ── … kuluçka … ── kuluçkadan çıkış · hotfix ── sürüm ── bugün
   │                                │                            │        │
   │                                └────────────── hatched ──────────────┤
   │                                                             └ released
   └───────────────── listed ─────────────────────────────────────────────┘
```

Bir alanda değeri olmayan eklenti (henüz geçmişi yok, indirme istatistiği yok, `rise` için 1K'nın altında) o alandaki hiçbir karşılaştırmaya uymaz ve o alana göre sıralarken, iki yönde de **en sona** düşer. Bunları `is empty` bulur.

## Değerler

| Değer | Örnek |
|---|---|
| Sayı, `k` ya da `m` ile | `500`, `1k`, `2.5k`, `1m` |
| Gün, hafta, ay, yıl | `14d`, `2w`, `3m`, `1y` |
| Tarih | `2026-01-01` |
| Boşluklu metin | `"Daily notes"` |
| Liste | `("Tasks", Calendar)` |

## Tarih fonksiyonları

| Fonksiyon | Değeri |
|---|---|
| `today()` | bugün gece yarısı |
| `startOfWeek()` | bu pazartesi |
| `startOfMonth()` | bu ayın 1'i |
| `startOfYear()` | 1 Ocak |
| `lastSync()` | son eşitlemeden bir önceki eşitleme |

Her biri bir kaydırma alır: `startOfMonth(-1)` geçen ayın 1'i, `today(-7)` bir hafta öncesidir.

```
released >= startOfMonth() order by downloads desc
listed >= lastSync()
```

## Üç adımda bir sorgu kurun

*Gizli cevherler*: henüz ünlü olmayan iyi eklentiler.

1. **Boyut:** dev değil. `downloads <= 10k`
2. **Canlılık:** bakımı süren ve büyüyen. `AND released <= 30d AND rise(30d) >= 20`
3. **Sizin için yeni:** `AND NOT tracked`, ardından sıralama: `order by rise(30d) desc`

```
downloads <= 10k AND released <= 30d AND rise(30d) >= 20 AND NOT tracked
order by rise(30d) desc
```

Liste boş çıkarsa durum satırı onu hangi koşulun boşalttığını söyler.

## Hazır sorgular

Ana sayfadaki **Widget ekle** ve boş sorgu kutusuyla aynı liste. **+ Ekle** birini Ana sayfaya kayıtlı görünüm olarak koyar; **Sorguda aç** önce değiştirmek için listede açar.

| Ad | Sorgu | Bulduğu |
|---|---|---|
| Bu ay güncellenenler | `released >= startOfMonth() order by downloads desc` | ayın 1'inden beri sürüm çıkaranlar |
| Hızlı çıkış yapanlar | `listed <= 60d AND downloads >= 1k AND NOT tracked order by downloads desc` | son 2 ayda listelenip 1K'yı geçmişler |
| Gizli cevherler | `downloads <= 10k AND released <= 30d AND rise(30d) >= 20 AND NOT tracked order by rise(30d) desc` | 1K–10K, bu ay güncellenmiş, %20+ büyüyen |
| Uykudan uyananlar | `incubated >= 180d AND hatched <= 30d AND NOT tracked order by hatched desc` | 6+ aydan sonra bu ay dönenler |
| Popülerlerde yeni sürüm | `downloads >= 50k AND released <= 14d AND NOT tracked order by released desc` | çok kişiye ulaşan değişiklikler |
| 10K'yı yeni aşanlar | `milestone(10k) <= 30d order by downloads desc` | bu ay 10K'ya ulaşanlar, sonra nereye vardıklarından bağımsız |
| Aktif geliştirilenler | `releases(30d) >= 3 AND downloads >= 1k AND NOT tracked order by gain(30d) desc` | bu ay 3+ güncelleme |
| Terk edilmiş kurulu eklentiler | `installed AND released >= 1y order by released asc` | kurulu, bir yıldır güncellenmemiş |
| Denenecekler | `tracked AND NOT installed order by rating desc` | takipte, burada kurulu değil |
| Grupsuzlar | `tracked AND group is empty order by name asc` | takipte, grubu yok |
| Puansızlar | `tracked AND rating is empty order by downloads desc` | takipte, henüz puanlanmamış |
| Takipte uyuyanlar | `tracked AND released >= 1y order by released asc` | takipte, bir yıldır sürüm yok |

Ana sayfadaki **Kategori izleme** widget'ı (**+ Widget ekle › Bildirim** içinde) asıl kategorisi o olan eklentileri, en çok indirilen üstte listeler; listeye yeni girenleri "+N yeni" ile işaretler: `primary = tasks AND NOT removed order by downloads desc`.

Daha fazlası: `author ~ zsviczian` (bir yazarın tüm eklentileri), `"daily note" OR "journal"` (metin arama).

## Sık karşılaşılan sürprizler

- **`rise()` 1K indirmenin altında boştur.** 10 → 30 yükseliş sayılmaz; küçük eklentiler için `gain()` kullanın.
- **`milestone(10k)` 10K'ya ulaştığı gündür,** sonra nereye vardığından bağımsız: bu ay 9K'dan 30K'ya çıkan bir eklenti hem `milestone(10k) <= 30d` hem de `milestone(25k) <= 30d` içindedir.
- **Güncellenen, yeni eklentileri dışarıda bırakmaz.** Onları yalnızca Yeni'de görmek istiyorsanız sorgusuna `NOT listed <= 14d` ekleyin.
- **Dışlanan ve gizlenen eklentiler** sorgu `excluded` ya da `snoozed` demedikçe hiçbir listede görünmez.
- **Kuluçkadan çıkış herkes için aynı 30 gündür.** Bir yıl uyumak daha uzun kalma hakkı kazandırmaz; en son dönen en üsttedir. Dönüşten sonraki sürümler eklentiyi listeden çıkarmaz.

## Kutudaki yardım

- **Öneriler** siz yazarken açılır: alanlar, operatörler, gruplarınız ve durumlarınız, yazarlar. `Ctrl+Space` onları her an açar; boş kutu son sorgularınızı ve bu örnekleri sunar.
- Bir kelimenin üzerine **gelin**, anlamını görün (tarih fonksiyonu karşılık geldiği tarihi gösterir).
- Kutudaki **`?`** Yardım'ı Sorgu kılavuzunda açar (bir tıklama öğeyi kutuya koyar); görünümün başlığındaki **?** Yardım'ı Hızlı başlangıçta, yanında Hazır sorgularla açar.
- **`/`** kutuya odaklanır. **Esc** Basit modda kutuyu temizler, Sorgu modunda sayfanın sorgusuna döner.
- Boş bir liste onu hangi koşulun boşalttığını söyler: "`downloads >= 1k` olmadan 312 eklenti".

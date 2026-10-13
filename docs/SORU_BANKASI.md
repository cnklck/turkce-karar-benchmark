# Soru bankası

[← Ana sayfa](../README.md)

Banka **800 soru kümesi ve 2.400 örnek** içerir. Her kümede üç mesaj vardır. Mesajlar sentetiktir. Yanıt anahtarı yapay zekayla yazıldı ve incelendi. İnsan doğrulaması yapılmadı.

## Bir küme nasıl çalışır?

![C001 kümesinde anlam değişimi ve anlamı koruyan yeniden anlatım](../assets/question-family.png)

| Rol | Veri alanı | Amaç |
|---|---|---|
| Başlangıç | `base` | İlk mesajdaki kararı ölçer. |
| Anlamı değiştiren örnek | `contrast` | Hedef bilgi değişince yanıtın değişmesini ölçer. |
| Anlamı koruyan örnek | `preserve` | Farklı anlatımda aynı kararın korunmasını ölçer. |

Bir küme, üç ayrı rastgele soru değildir. Örnekler aynı hedef soruyla bağlantılıdır. Bu yapı, sözcük eşleştiren bir model ile anlam değişimini izleyen bir model arasında ayrım yapar.

## Hangi beceriler var?

Her beceri için 80 küme vardır: Development 10, Core 20, Challenge 50.

| Kod | Beceri | Ölçülen fark |
|---|---|---|
| NEG | Olumsuzluk ve kapsam | Eylem oldu mu, olmadı mı? |
| QUANT | Tutar, sayı ve eşik | Sayı verilen sınırı aşıyor mu? |
| TIME | Tarih ve süre | Verilen zaman kuralı karşılanıyor mu? |
| ACTOR | Eylemi yapan kişi | Müşteri mi, başka biri mi yaptı? |
| SOURCE | Bilginin kaynağı | Doğrudan beyan mı, aktarılan iddia mı? |
| COND | Koşul ve gerçekleşmemiş olay | Olay gerçekleşti mi, yalnızca düşünüldü mü? |
| UPDATE | Düzeltme ve geri çekme | Son geçerli durum hangisi? |
| REQ | Talep ve plan | Mesajda geçerli bir talep veya kesin plan var mı? |
| REF | Gönderim ve eksiltili anlatım | Sözcük veya atlanan ifade neye gönderme yapıyor? |
| LIST | Liste, istisna ve küme kapsamı | Hangi öğeler gerçekten dahil? |

Beceri başına sonuçlar `analysis.json` içindeki `byCapability` alanında bulunur. Bu sınıflar aynı çalışma tasarımının parçalarıdır; bağımsız dil yetkinlik sınavları değildir.

## Belirsizlik de doğru yanıttır

**Soru:** Müşterinin rezervasyonunun toplam tutarı 3.000 TL veya daha fazla mı?

| Örnek | Mesaj | Geçici anahtar |
|---|---|---|
| C034-A | Grup yemeği için restoranda kişi başı 250 TL'lik menü seçtim, rezervasyondaki kişi sayısı henüz belli değil. | Anlaşılmıyor |
| C034-B | Grup yemeği için restoranda kişi başı 250 TL'lik menü seçtim, rezervasyonu 14 kişilik yaptırdım. | Evet |
| C034-C | Restoranda grup yemeği için menüyü kişi başı 250 TL'den seçtim; rezervasyondaki kişi sayısı henüz kesinleşmedi. | Anlaşılmıyor |

A ve C'de kişi sayısı yoktur. Toplam tutar hesaplanamaz. B'de `14 × 250 = 3.500 TL` olduğu için eşik aşılır. Eksik sayı için varsayım yapılmaz.

## Dağılım

| Bölüm | Evet | Hayır | Anlaşılmıyor | Toplam |
|---|---:|---:|---:|---:|
| Development | 120 | 119 | 61 | 300 |
| Core | 225 | 222 | 153 | 600 |
| Challenge | 548 | 543 | 409 | 1.500 |
| Tüm banka | 893 | 884 | 623 | 2.400 |

680 küme olay sorusudur (T2). 120 küme mesaj özelliği sorusudur (T1). 171 küme ek karar kuralı içerir. Kişi seçimi sorusu 123 kümede vardır.

İnceleme sırasında 268 örnek işaretlendi. İşaret, gözden geçirilmesi gereken dil veya politika özelliğini belirtir. Otomatik olarak hatalı anahtar anlamına gelmez. İşaretli alt grup ana sıralamanın yerine kullanılmaz.

## Test öncesi düzeltmeler

43 bulgu grubu çözüldü. 138 küme etkilendi. 60 mesaj ve 91 istek eşlemesi düzeltildi. Ana yanıt ve kişi seçimi anahtarları bu düzeltmede korunarak mesajlarla uyum sağlandı. Yaklaşık hesap isteyen dört sayısal kümede ±%10 sınırı açık kural olarak verildi.

Düzeltme geçmişi [changes.json](../data/changes.json), gerekçeler [resolutions.json](../audit/bank/resolutions.json) içindedir. Sayısal yeniden hesaplama [CSV dosyasında](../audit/bank/numerical-recalculation.csv) bulunur. Test başladıktan sonra yanıt anahtarı değiştirilmedi.

## Veriyi incele

- [Tam soru bankası](../data/sample.json): mesaj, soru, kural, anahtar, kanıt ve türetim.
- [Küme dizini](../data/family-index.csv): kimlik, bölüm, beceri ve soru.
- [Veri sözlüğü](VERI_SOZLUGU.md): alanların anlamı.

Yayın için yalnızca idari metaveri sadeleştirildi. Mesajlar, sorular, kurallar ve anahtarlar ölçülen haliyle korundu. [Bunun nasıl doğrulandığı](KAYITLAR.md)

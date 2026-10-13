# Veri sözlüğü

[← Ana sayfa](../README.md)

## Soru kümesi

Tam veri [data/sample.json](../data/sample.json) içindedir. Küme kimlikleri `D`, `C`, `X` önekleriyle Development, Core ve Challenge bölümlerini belirtir.

| Alan | Anlamı |
|---|---|
| `families[].id` | Soru kümesi kimliği |
| `split` | Development, Core veya Challenge |
| `capability` | Beceri kodu |
| `taskType` | T1 mesaj özelliği veya T2 olay sorusu |
| `question` | B1 hedef sorusu |
| `rule` | Varsa modele verilen ek karar kuralı |
| `predicates.P`, `predicates.notP` | Önerme ve mantıksal karşıtı |
| `trackA.P`, `trackA.notP` | A biçimindeki tam soru metinleri |
| `entity` | Varsa B2 sorusu ve seçenekleri |
| `cases` | Kümenin üç örneği |

## Örnek

| Alan | Anlamı |
|---|---|
| `id` | Örnek kimliği; küme kimliği ve A/B/C eki |
| `role` | `base`, `contrast` veya `preserve` |
| `of` | Değişimin bağlı olduğu başlangıç örneği |
| `message` | Modelin okuyacağı müşteri mesajı |
| `key` | Geçici B1 yanıt anahtarı |
| `entityKey` | Varsa geçici B2 yanıt anahtarı |
| `gold.trackA` | A sorularının doğru kanıt durumu |
| `facts`, `factTrace` | Anahtarın dayandığı bilgi ve izi |
| `evidence` | Mesajdaki destekleyici ifadeler |
| `derivation` | Anahtarın türetim açıklaması |
| `ambiguity` | İnceleme işaretleri ve notu |
| `review` | İnceleme ve insan doğrulaması durumu |

`facts`, `gold`, `evidence`, `derivation` ve `review` puanlama ve inceleme içindir. Bu alanlar API'ye gönderilmez. İstek sınırı [inputs.mjs](../harness/inputs.mjs) dosyasında tanımlıdır.

## Karar ve HTTP denemesi

Bir **karar**, tek örnek için tek modelin tek soru biçimindeki değerlendirmesidir. Ortak A'da iki HTTP isteği bir karar oluşturur. B1 ve B2'de bir HTTP isteği bir karar oluşturur.

Bir **HTTP denemesi**, sağlayıcıya yapılan tek gönderimdir. Aynı isteğin tekrarı ayrı deneme sayılır. Bu ayrım maliyet ve hata hesabında korunur.

| Dosya / alan | Anlamı |
|---|---|
| `manifest.entries` | Beklenen karar yerleri ve tam istek gövdeleri |
| `slot` | Model, koşul, biçim, örnek, varyant ve bölümden oluşan benzersiz yer |
| `requestId`, `bodyHash` | İsteğin kimliği ve SHA-256 özeti |
| `records.jsonl` | Karar başına bir son kayıt |
| `answers` | Puanlanacak ayrıştırılmış yanıt |
| `requests` | Karara ait tüm HTTP denemeleri |
| `attempts.jsonl` | Gönderim başlangıcı ve tamamlanma olayları |
| `servedModel` | Sağlayıcının bildirdiği sunulan kimlik |
| `cost` | Geçerli sağlayıcı maliyeti; yoksa bilinmiyor |

JSONL arşivlerinin her satırı bir JSON nesnesidir. Sıkıştırılmış dosyalar standart gzip biçimindedir. İndirmeden küçük sonuçları görmek için [leaderboard.csv](../results/leaderboard.csv) kullanılabilir.

## Analiz alanları

| Alan | Anlamı |
|---|---|
| `accuracyEndToEnd` | Hatalar dahil planlanan karar paydasındaki doğruluk |
| `accuracyCompleted` | Yalnızca geçerli tamamlanan kararlardaki doğruluk |
| `familyBootstrap95` | Küme düzeyinde %95 güven aralığı |
| `confusion` | Anahtar ve tahmin sınıfı dağılımı |
| `unsupportedInference` | Belirsiz anahtar için verilen kesin karar sayısı |
| `contrast.rate` | Anlam değişen çiftlerin ikisinin de doğru olduğu oran |
| `preserve.rate` | Anlam korunan çiftlerin ikisinin de doğru olduğu oran |
| `preserve.samePredictionRate` | Anlam korunan çiftlerde aynı yanıt oranı |
| `probability` | Brier, log-loss ve olasılık doğrulama sayımları |
| `riskCoverage` | Güven eşiğine göre kapsama ve hata |
| `ops` | Karar gecikmesi, tekrarlar ve maliyet kapsamı |
| `paired` | Aynı örneklerde iki modelin küme düzeyindeki farkı |
| `integrity` | Eksik, yinelenen veya kimliği uyuşmayan kayıtlar |

CSV yüzdeleri sayısal uyum için noktalı ondalık kullanır. Türkçe tablolarda virgüllü ondalık gösterilir. Yüzde farkı ile yüzde puan farkı ayrı kavramlardır.

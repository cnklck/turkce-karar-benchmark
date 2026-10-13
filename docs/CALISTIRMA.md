# Çalıştırma

[← Ana sayfa](../README.md)

## Kayıtlı sonuçları tekrar üret

Node.js 22 veya üzeri gerekir. Bu bölümdeki komutlar ağ isteği göndermez. Ek npm paketi gerekmez.

```sh
npm test
npm run verify
npm run replay
npm run check:publication
```

| Komut | Ne yapar? | Çıktı |
|---|---|---|
| `test` | Çalıştırıcı, olasılık, kimlik ve hata kontrollerini sınar. | Test özeti |
| `verify` | 95.259 istek gövdesini ve 64.059 karar kaydını doğrular. | Doğrulama özeti |
| `replay` | Arşivdeki yanıtları yeniden puanlar. | `out/replayed-summary.json` |
| `check:publication` | Yayın dosyalarını, bağlantıları ve anahtar sızıntısı örüntülerini kontrol eder. | Yayın özeti |

Arşivler çalışma sırasında bellekte açılır. Paket yaklaşık 71 MiB'dir. Doğrulama ve yeniden puanlama için birkaç GB boş bellek ayırın. Node komutlarında üst bellek sınırı 6 GiB olarak verilir; bu ayrılmış sabit bellek değildir.

## Yeni test hazırla

Bu komut 10 Core kümesi seçer. Üç örnekli kümeleri bölmez. 30 B1 kararı için mesajları, kodu ve istekleri dondurur. API isteği göndermez.

```sh
npm run prepare --   --models '~typesafe/jev-latest'   --split core   --families 10   --tracks B1   --out experiments/ornek
```

Seçim sabittir: aynı sürüm ve seçenekler aynı kümeleri seçer. Çıktı klasörü daha önce varsa komut durur. Desteklenmeyen bir model kimliği veya boş soru biçimi kabul edilmez.

| Seçenek | Anlamı |
|---|---|
| `--models` | Virgülle ayrılmış kayıtlı API kimlikleri |
| `--all-models` | Kayıtlı 13 API modeli |
| `--split` | `dev`, `core`, `challenge` veya `all` |
| `--families` | Seçilecek soru kümesi sayısı |
| `--tracks` | `A`, `B1`, `B2` veya bunların virgüllü listesi |
| `--native-jev` | Jev için A'da iki soruyu tek istekte gönderen ek koşul |
| `--out` | Yeni deney klasörü |

Bir model, seçilen biçimlerden yalnızca desteklediklerine katılır. Span modelleri için B1 veya B2'ye geçiş yapılmaz. Yalnızca B1 seçip Span dahil ederseniz hazırlama durur. 13 modeli birlikte hazırlamak için `A,B1,B2` kullanın.

## Yeni testi API'de çalıştır

Bu adım ücretli API isteği gönderir. Çalıştırıcı bir fiyat tavanı koymaz. Planı ve güncel hizmet fiyatlarını çalıştırmadan önce inceleyin. 2026-10-08 kullanım kaydı güncel fiyat garantisi değildir.

API anahtarını `OPENROUTER_API_KEY` ortam değişkenine verin. Alternatif olarak `.env.example` dosyasını `.env` olarak kopyalayın ve anahtarı yalnızca bu dosyaya yazın. `.env` Git'e eklenmez. Anahtarı komut satırına veya kayıt dosyalarına yazmayın.

```sh
npm run execute -- --run experiments/ornek --env-file .env --execute
```

`--execute` açıkça eklenmeden test başlamaz. Önce yanıt biçimi kontrol edilir. Uyumsuzluk varsa ana test başlamaz. Bu kontrol de API isteği gönderir ve kullanım kaydına girer.

Model hizmeti, katalog kaydından sonra değişmiş olabilir. Takma ad güncel bir model sürümüne yönlenebilir. Çalıştırıcı gerçekten sunulan kimliği kaydeder. Çalışma sırasında bu kimlik değişirse yeni gönderimler durur.

Yeni deney varsayılan olarak aynı anda 8 HTTP isteği ve model başına en fazla 2 istek kullanır. Tarihsel tam çalışmanın kuyruk ayarları farklıdır. Mesajlar ve sorular aynı olsa bile yeni süre ve maliyet farklı olabilir.

## Yanıtları puanla

```sh
npm run score -- --run experiments/ornek
```

Sonuç `experiments/ornek/analysis.json` dosyasına yazılır. Puanlama, deney klasöründeki dondurulmuş kodu ve veriyi kullanır. Bölümler ayrı kalır. Eksik kararlar yanlış sayılır.

Tamamlanmış istekler tekrar gönderilmez. Sonucu bilinmeyen bir gönderim varsa yeniden başlatma durur. Önce sağlayıcı kaydıyla uzlaştırma gerekir. Deney klasörünü silerek bu kontrolü aşmayın.

## Tam tarihsel kapsamı hazırla

Aşağıdaki komut 800 küme, 13 model ve tüm kayıtlı koşullarla **64.059 karar / 95.259 ilk istek bileşeni** hazırlar. Yalnızca dosya üretir.

```sh
npm run prepare --   --all-models   --split all   --families 800   --tracks A,B1,B2   --native-jev   --out experiments/tam-test
```

Hazırlanan deney yeni bir kimlik alır. Yayın kodunun idari metinleri ve varsayılan kuyruk ayarları özgün çalışmadan farklıdır. Özgün istekler [manifest arşivinde](../results/hosted/manifest.json.gz) korunur. Kayıtlı skoru birebir tekrar üretmek için API'yi yeniden çağırmak yerine `npm run replay` kullanın.

## Görselleri yeniden üret

Yalnızca grafik üretimi Python ve Matplotlib gerektirir. Puanlama bunlara bağlı değildir.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-figures.txt
.venv/bin/python scripts/render_figures.py
```

Dosyalar `out/figures` klasörüne yazılır. `--out` ile farklı bir klasör seçilebilir. PNG, SVG ve PDF üretilir. Yazı taşması, etiket çakışması, oran ve eksen kontrolleri çalışır. İşletim sisteminin yazı tipleri nedeniyle harf görünümü değişebilir. Sayısal veri ve renkler sabit kalır.

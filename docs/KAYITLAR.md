# Kayıtlar ve doğrulama

[← Ana sayfa](../README.md)

## Özgün çalışma kimliği

| Kimlik | SHA-256 |
|---|---|
| Deney | `6a68a802025f95589aacdc0d67ac13276e51d0dca26ea1333dcbe1c25762562a` |
| Dondurulmuş veri | `5dfaf5c486781a3e5420aafb80fc6c1d315f146034c8b53e1ee1a9f92aa9c2b7` |
| Dondurulmuş uygulama | `bc6f6c3b834b38eb6fd38db80499b5123453d0c18af67669a65561be82cce964` |

Dondurma kaydı 2026-10-08, 11:15:26 UTC tarihini içerir. Tamamlama kaydı 13:38:14 UTC tarihini içerir. Bunlar çalışma dosyalarındaki zamanlardır. Yayın, çalışmadan sonra hazırlandı; bağımsız zaman damgası kanıtı olarak sunulmaz.

## Yayın dosyaları neden farklı özet taşıyor?

Yayın için idari adlar, özel dosya yolları ve kullanılmayan plan metaverisi sadeleştirildi. Bu yüzden yayımlanan veri dosyasının byte özeti özgün veri özetiyle farklıdır. **Mesaj, soru, kural ve yanıt anahtarı değiştirilmedi.**

[Bilimsel alan karşılaştırması](../audit/scientific-projection.json), idari alanlar dışındaki veri içeriğinin aynı olduğunu gösterir. `verify` ayrıca özgün 95.259 istek gövdesini yayımlanan bankadan yeniden kurar ve tek tek karşılaştırır. Böylece yalnızca üst düzey bir dosya özetiyle yetinilmez.

Çalıştırıcıdaki yayın değişiklikleri taşınabilir komutlar ve idari metinlerle ilgilidir. Özgün uygulama özeti ayrı saklanır. Yeni hazırlanan deney, kendi kodunu ve verisini yeniden dondurur; eski deney kimliğini taklit etmez.

## Arşivde ne var?

| Dosya | İçerik | Koruma |
|---|---|---|
| [manifest.json.gz](../results/hosted/manifest.json.gz) | Özgün karar yerleri ve istek gövdeleri | Açılmış içerik byte olarak aynı |
| [records.jsonl.gz](../results/hosted/records.jsonl.gz) | 64.059 karar kaydı | Açılmış içerik byte olarak aynı |
| [attempts.jsonl.gz](../results/hosted/attempts.jsonl.gz) | Ana testin gönderim ve yanıt olayları | Açılmış içerik byte olarak aynı |
| [preflight-attempts.jsonl.gz](../results/hosted/preflight-attempts.jsonl.gz) | Biçim kontrolü olayları | Açılmış içerik byte olarak aynı |
| [per-case.csv.gz](../results/hosted/per-case.csv.gz) | Karar başına puan ve hata | Açılmış içerik byte olarak aynı |
| [analysis.json](../results/hosted/analysis.json) | Tüm analiz grupları | İdari metaveri sadeleştirildi |
| [source-freeze.json](../results/hosted/source-freeze.json) | Özgün dondurma kaydı | Özgün kimlikleri korur |
| [source-completion.json](../results/hosted/source-completion.json) | Özgün tamamlama kaydı | Özgün kimlikleri korur |
| [source-audit.json](../results/hosted/source-audit.json) | Çalışma sonrası denetim sonucu | Özgün kimlikleri korur |

[publication-provenance.json](../audit/publication-provenance.json), kaynak ve yayın dosyalarının SHA-256 özetlerini içerir. gzip dosyalarında hem sıkıştırılmış dosya hem açılmış içerik kontrol edilir. Özgün tamamlamada adı geçen her idari dosya bu repoya kopyalanmadı; yayın karşılıkları bu tabloda listelenir.

## Otomatik doğrulama

```sh
npm test
npm run verify
npm run replay
npm run check:publication
```

`verify` beklenen yerlerin tamlığını, istek gövdelerini, kimlikleri, olasılık yanıtlarını ve grafik verisini kontrol eder. `replay` doğruluk, sınıf dağılımı ve güven aralıklarını kayıtlı analizle birebir karşılaştırır. Bu işlemler sağlayıcıya yeni istek göndermez.

Yayın kontrolü gerçek anahtar örüntülerini, özel dosya yollarını ve bozuk belge bağlantılarını tarar. Şüpheli içerik çıktıya yazılmaz. Tarama belirli örüntüleri kontrol eder; her olası hassas veri türünü tanıdığı iddia edilmez.

GitHub Actions aynı kontrolleri çalıştırır. Son durum [Kontroller sayfasında](https://github.com/cnklck/turkce-karar-benchmark/actions/workflows/checks.yml) görünür.

## Anahtar hatası bulunursa

Arşivdeki anahtar değişmeden kalır. Yeni bir hata kaydı örnek kimliği, önerilen yanıt ve gerekçeyle açılır. Düzeltme yeni bir veri sürümüne uygulanır. Eski ve yeni puanlar ayrı tutulur. [Katkı yöntemi](../CONTRIBUTING.md)

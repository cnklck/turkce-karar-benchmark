# Model kimlikleri

[← Ana sayfa](../README.md)

Bu tablo 8 Ekim 2026 tarihinde **gerçekten ölçülen** API kimliklerini gösterir. Model adı ile sunulan kimlik ayrı kaydedildi. Güncel hizmet kullanılabilirliği iddiası değildir.

| Görünen ad | İstenen API kimliği | Kaydedilen model kimliği | Soru biçimi |
|---|---|---|---|
| Perplexity Decider V1.1 | `perplexity/pplx-decider-v1.1-27b` | `perplexity/pplx-decider-v1.1-27b-20261006` | A, B1, B2 |
| Jev Latest | `~typesafe/jev-latest` | `typesafe/jev-1.13-20260917` | A, B1, B2 |
| Clef | `cloudflare/clef` | `cloudflare/clef` | A, B1, B2 |
| Mercury Decide (ücretsiz) | `inception/mercury-decide:free` | `inception/mercury-decide-20260930` | A, B1, B2 |
| GPT-6 Luna Decisions | `openai/gpt-6-luna-decisions` | `openai/gpt-6-luna-decisions-20261006` | A, B1, B2 |
| Liquid d1 | `liquid/d1` | `liquid/d1-20260930` | A, B1, B2 |
| Solar Decide | `upstage/solar-decide` | `upstage/solar-decide-20260928` | A, B1, B2 |
| Clef Flash | `cloudflare/clef-flash` | `cloudflare/clef-flash` | A, B1, B2 |
| Tev1 4B | `togethercomputer/tev1-4b-experimental` | `togethercomputer/tev1-4b-experimental-20260923` | A, B1, B2 |
| Kev 4B | `jaredpalmer/kev-4b` | `jaredpalmer/kev-4b-20260924` | A, B1, B2 |
| Solar Decide Flash | `upstage/solar-decide-flash` | `upstage/solar-decide-flash-20261008` | A, B1, B2 |
| Span 01 | `respan/span-01` | `respan/span-01-20260925` | A |
| Span 01 Lite | `respan/span-01-lite` | `respan/span-01-lite-20260925` | A |

Jev'in `latest` takma adı bu çalışmada `typesafe/jev-1.13-20260917` kimliğine yönlendi. Takma ad ileride başka bir sürüme yönlenebilir. Bu nedenle yalnızca görünen adı yazarak aynı çalışma tekrar edilmiş sayılmaz.

Span 01 ve Span 01 Lite için durum metin olarak gönderildi. Diğer modellerde aynı alanlar JSON nesnesi olarak gönderildi. Span modelleri yalnızca `noul` tipi A sorularını kullandı. B1/B2 puanları yoktur.

Mercury'nin `:free` kimliği ayrı bir API erişim biçimidir. Bu çalışmadaki satır bu kimliği ölçer. Sürüm ve hizmet koşulları gelecekte değişebilir.

Perplexity V1.1, eski V1 ile aynı model olarak sayılmadı. Aynı sunulan kimliğe yönlenebilecek takma adlar ek model gibi çoğaltılmadı. Katalog dışı kimlikler `model-registry.json` içindeki `notScheduled` alanında kayıtlıdır.

## Katalog ve çalışma kanıtı

- [Katalog anlık görüntüsü](../model-registry.json): 2026-10-08, 11:13:36 UTC.
- [Biçim kontrolü](../results/hosted/preflight-receipt.json): planlanan API biçimleri için çalışma öncesi sonuç.
- [Kullanım kaydı](../results/hosted/usage.json): sunulan kimlik, sağlayıcı, deneme, token ve bildirilen maliyet.
- [Ham denemeler](../results/hosted/attempts.jsonl.gz): istek ve yanıt bazında ayrıntı.

Katalogda yer almak çalışma uyumluluğu kanıtı değildir. Bunun için biçim kontrolü yapıldı. Model kimliği sabit görünse bile ağırlıkların ve hizmet altyapısının değişmediği bağımsız olarak doğrulanamaz.

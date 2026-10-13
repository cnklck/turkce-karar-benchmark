# Katkı

Bir soru veya yanıt anahtarında sorun görürseniz [yeni bir kayıt açın](https://github.com/cnklck/turkce-karar-benchmark/issues/new). Üç bilgi yeterlidir:

1. Örnek kimliği: örneğin `C034-A`.
2. Önerdiğiniz yanıt ve mesajdaki kanıt.
3. Mevcut kanıt kuralıyla neden uyuşmadığı.

Hata, doğal Türkçe okumasıyla verilen test kuralı arasındaki farktan doğabilir. İkisini ayrı açıklayın. Kişisel bilgi veya API anahtarı eklemeyin.

## Değişiklik kuralı

Kayıtlı sonuçlar ve özgün arşiv değiştirilmez. Yeni soru veya anahtar düzeltmesi yeni bir sürüme uygulanır. Eski ve yeni ölçümler ayrı kalır. Bir hata giderildiğinde yeni sonuç üretilmeden eski grafik güncellenmez.

Kod değişikliğinde `npm test`, `npm run verify` ve `npm run replay` çalıştırın. Belge veya görsel değişikliğinde `npm run check:publication` çalıştırın. Grafik sayıları [chart-data.json](results/chart-data.json) ve [analysis.json](results/hosted/analysis.json) ile aynı olmalıdır.

Belgeleri kısa Türkçeyle yazın. [Yazım ilkelerini](docs/YAZIM.md) izleyin. Ölçülmeyen bir sonuç veya koşulsuz model üstünlüğü eklemeyin.

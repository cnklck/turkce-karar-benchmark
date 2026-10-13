# Yöntem

[← Ana sayfa](../README.md)

## Ölçülen görev

Model, bir müşteri mesajını ve varsa bir karar kuralını okur. Ardından yalnızca bu bilgilerden karar verir. Dış bilgi eklemez. Bu görev, belirtilen kanıt politikası altında Türkçe mesaj yorumlamayı ölçer.

İki görev türü vardır:

| Tür | Soru neyi ölçer? | Hayır ne demektir? |
|---|---|---|
| T2 · Olay | Bir olay mesajdan çıkarılabiliyor mu? | Olayın tersi için kanıt var. |
| T1 · Mesaj özelliği | Mesajda geçerli talep veya kesin plan var mı? | Sorulan mesaj özelliği yok. |

T2'de bilgi eksikliği Hayır değildir. T1'de geçerli bir talebin bulunmaması Hayır olabilir. Bu iki durum ayrı raporlanır.

## Modele verilen kanıt politikası

Politika her istekte bulunur. [Tam metin ve istek oluşturucu](../harness/inputs.mjs)

- Mesajı müşteri yazmıştır. Sorudaki müşteri bu yazardır.
- Şimdiki an, mesajın yazıldığı andır. Yazılmayan tarih ve saat eklenmez.
- Yazarın doğrudan beyanı esas alınır. Kaynağı belirtilmeyen `-mış` ifadesi de bu testte yazarın beyanıdır.
- Başkasına, ekrana veya belgeye açıkça atfedilen iddia tek başına olayın gerçekleştiğini doğrulamaz.
- Yazarın açık düzeltmesi son durumu belirler. Çözülmeyen çelişki belirsiz kalır.
- Olasılık veya gerçekleşmemiş koşul, gerçekleşmiş olay sayılmaz.
- Geçmişe ilişkin karşıolgusal ve pişmanlık ifadelerinde olağan Türkçe çıkarımı kullanılır. Yalnızca “yapabilirdim” demek, eylemin yapılmadığını kanıtlamaz.
- Verilen karar kuralı önceliklidir. Koşullu talepler, daha dar bir kural yoksa T1'de talep sayılır.

Bu politika, her Türkçe okurun doğal okumasıyla aynı olmak zorunda değildir. Skorun anlamı politikaya uyumla birlikte değerlendirilmelidir.

## Bölümler ve bağımlılık

| Bölüm | Soru kümesi | Örnek | Kullanım |
|---|---:|---:|---|
| Development (`dev`) | 100 | 300 | Tanı ve geliştirme |
| Core (`core`) | 200 | 600 | Temel test sonuçları |
| Challenge (`challenge`) | 500 | 1.500 | Daha zor tasarlanmış test sonuçları |

Her küme bir başlangıç, bir anlam değiştiren örnek ve bir anlam koruyan örnek içerir. Üç örnek bağımsız sayılmaz. Güven aralıkları ve ikili model karşılaştırmaları kümeleri birlikte ele alır. Development, ana sıralamaya eklenmez.

Bu banka yapay zekayla yazıldı. Önceki pilotlar soru tasarımını etkiledi. Test öncesinde ayrı yapay zeka incelemeleri ve sayısal kontroller yapıldı. Bunlar insan doğrulamasının yerine geçmez.

## Üç soru biçimi

### A · İki kanıt sorusu

`P`, bir önermedir. `notP`, onun mantıksal karşıtıdır. Ortak koşulda ikisi ayrı API isteklerine gönderilir. Her soru kanıt olasılığı döndürür. `p ≥ 0,5`, olumlu karar sayılır.

| P destekleniyor mu? | Karşıtı destekleniyor mu? | Elde edilen karar |
|---|---|---|
| Evet | Hayır | Evet |
| Hayır | Evet | Hayır |
| Hayır | Hayır | Anlaşılmıyor |
| Evet | Evet | Çelişkili; yanlış puanlanır |

“Karşıtı desteklenmiyor” demek “P destekleniyor” demek değildir. İki ayrı soru bu farkı ölçer.

Jev'e özgü ek koşul iki soruyu tek istekte gönderir. Sonuçları `native` etiketiyle ayrı tutulur. Ortak koşuldaki sıralamaya eklenmez.

### B1 · Üç seçenek

Olay sorusunda seçenekler `EVET`, `HAYIR`, `ANLASILMIYOR` olarak gönderilir. API açık bir seçim döndürürse o seçim puanlanır. Açık seçim yoksa tek başına en yüksek olasılığa sahip seçenek kullanılır. Eşitlik çözülemiyorsa biçim hatası oluşur.

T1 sorularında Anlaşılmıyor seçeneğinin tanımı mesaj özelliğiyle uyumlu biçimde verilir. Seçenek metinleri [bankanın `mainOptions` alanında](../data/sample.json) bulunur.

### B2 · Kişi seçimi

Uygun sorularda eylemi yapan kişi seçilir. Seçenekler soruya göre değişir. Bu biçim 123 kümenin 369 örneğinde vardır. Core paydası 93, Challenge paydası 234 örnektir.

## İstek ve çalıştırma

İstek, mesajı, yazar bilgisini, zaman politikasını, kanıt politikasını, görev politikasını ve varsa karar kuralını içerir. Yanıt anahtarı, kanıt notları ve inceleme metaverisi API'ye gönderilmez.

Testten önce veri, plan, kod ve tüm istek gövdeleri SHA-256 ile bağlandı. Ardından 36 biçim kontrolü yapıldı. Ana çalışmada genel sınır aynı anda 64 HTTP isteğiydi. Her modelin ayrı kuyruk ve zaman aşımı ayarı vardı.

Çalıştırıcı her denemeyi göndermeden önce kalıcı kayda yazar. Tamamlanan sonuçları yeniden göndermez. Sonucu bilinmeyen gönderim varsa otomatik tekrar ücretlendirmeyi durdurur. Sunulan model kimliği değişirse yeni gönderimleri durdurur.

## Puanlama

**Doğruluk = doğru karar / planlanan karar.** Eksik veya nihai hatalı yanıt paydada kalır. Yinelenen kayıt ek puan getirmez. Deney, istek veya örnek kimliği uyuşmayan kayıt geçerli kabul edilmez.

Yan ölçümler:

- **Dayanaksız çıkarım:** Anahtar Anlaşılmıyor iken Evet veya Hayır seçilmesi.
- **Kaçırılan kanıt:** Anahtar Evet veya Hayır iken Anlaşılmıyor seçilmesi.
- **Çift doğruluğu:** İlgili iki örneğin de doğru olması.
- **Yanıt tutarlılığı:** Anlam korunan iki örneğe aynı yanıt verilmesi.
- **Brier ve log-loss:** Doğru seçeneklere verilen olasılıkların hatası. Daha düşük değer daha iyidir.
- **Risk ve kapsama:** Belirli bir güven eşiğinde kalan örneklerin oranı ve bu örneklerdeki hata oranı.

Olasılıklar sonlu sayı olmalıdır. Aralık ve toplam kontrolleri uygulanır. Seçenek toplamında `0,005 × seçenek sayısı` kadar yuvarlama farkı kabul edilir; kabul edilen değerler yeniden toplamı bire getirilir. `1e-9` aralık taşması sayısal gürültü olarak düzeltilir. Log-loss hesabında `1e-6` alt sınırı kullanılır. Sıfır olasılık verilen doğru seçenekler ayrıca sayılır.

A'da iki ayrı ikili Brier ölçümü vardır. B1 ve B2'de tüm seçeneklerin kare hataları toplanır. Bu farklı ölçekler tek olasılık skorunda birleştirilmez. Açık seçimin olasılıkların en yüksek değeriyle uyuşmadığı durumlar ayrıca kaydedilir.

## Güven aralıkları ve karşılaştırma

Skor aralıkları 2.000 yeniden örneklemeyle, `seed=7` kullanılarak hesaplandı. Yeniden örnekleme birimi soru kümesidir. Ana grafikte 500 küme vardır; 1.500 bağımsız gözlem varsayılmaz.

İkili karşılaştırma aynı örneklerdeki kararları eşleştirir. Küme başına ortalama doğruluk farkı hesaplanır. Fark için 5.000 yeniden örnekleme ve `seed=11` kullanılır. İki yönlü işaret testi, her bölüm ve biçimde Holm yöntemiyle düzeltilir.

Bu aralıklar bankadaki küme değişkenliğini gösterir. Yanıt anahtarı hatalarını, banka dışı genellemeyi veya tekrar çalışmadaki model değişkenliğini kapsamaz. [Puanlayıcı](../scoring/score.mjs) · [İkili karşılaştırma](../harness/paired.mjs)

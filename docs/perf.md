# Performans ölçümü (Faz 1b)

Tarih: 2026-10-09 · Makine: **RTX 4070**, Chrome (Claude masaüstü uygulamasının tarayıcı paneli), Windows 11.
Bu makine ortalamanın üstündedir; bu yüzden aşağıda ham sayıların yanında **daha zayıf donanım için tahminler** ve bunların ne kadar güvenilir olduğu da yazılı.

## Nasıl ölçüldü

`?debug=1` ile açılınca konsolda `await __tb.probe(genişlik, yükseklik)` çalışır (`apps/client/src/ui/perfProbe.ts`, normal pakete girmez, yalnızca debug'ta yüklenir). Tarayıcılar gerçek GPU zamanlayıcılarını vermez; bu yüzden aynı kare art arda çizilir, her turun sonunda 1 piksellik geri okuma ile GPU'nun bitmesi beklenir ve süre ölçülür. Sayılar **aynı makinede parçaları ve çözünürlükleri karşılaştırmak** içindir, kesin FPS vaadi değildir.

Senaryo: eğitim haritası (14 ada + 48 resif), 8 gemi hareket halinde, oyuncu top + roket + makineli ile sürekli ateş ediyor (mermiler, izler, vuruş efektleri aktif). Her değer birkaç tekrarın tipik değeridir.

## Sonuçlar (suyu hızlandırmadan önce → sonra)

| | 1920×1080 | 3840×2160 (4 kat piksel) |
|---|---|---|
| Sahne GPU süresi (önce) | ≈ 0,39 ms | ≈ 1,3 ms |
| **Sahne GPU süresi (sonra)** | **≈ 0,25 ms** | **≈ 0,8 ms** |
| Köpük (iz) haritası geçişi | ≈ 0,03 ms | ≈ 0,05 ms |
| CPU, tam oyun karesi (sim + efekt + çizim komutları) | 0,15–0,5 ms | 0,3–0,5 ms |
| Çizim çağrısı | 89–99 | 88–99 |
| Üçgen | ≈ 110 bin | ≈ 110 bin |
| JS heap (1800 kare yoğun savaş) | ≈ 30 MB, büyümüyor | |

Sahne süresinin **%90'ından fazlası su shader'ıdır** (piksel bound: süre piksel sayısıyla neredeyse doğrusal artıyor). Adalar, gemiler, parçacıklar ve mermiler birlikte ≈ 0,05–0,1 ms.

Yapılan tek optimizasyon: köpük gürültüsü (beyaz köpük ve gemi izi) yalnızca köpüğün çıkabileceği yerlerde hesaplanıyor. Su süresini yaklaşık **%35 düşürdü**. Görüntü aynı.

## Daha zayıf donanım için tahmin

Su shader'ı ALU ağırlıklı olduğu için GPU'nun işlem gücü oranı kabaca iyi bir yaklaşıktır (4070 ≈ 29 TFLOPS). **Bu bir tahmindir, ölçüm değil**; sürücü, bellek bant genişliği ve tarayıcı farkı payı yüzde onlarca oynatabilir.

| Donanım sınıfı (yaklaşık) | 4070'e göre | 1080p sahne GPU süresi tahmini | Yorum |
|---|---|---|---|
| GTX 1650 / GTX 1060 sınıfı | ≈ 7–10× yavaş | ≈ 2–2,5 ms | rahat, 60 fps'in çok üstünde |
| Intel Iris Xe / Apple M1 sınıfı | ≈ 10–14× | ≈ 2,5–3,5 ms | rahat |
| Retina/HiDPI dizüstü (2880×1800 ≈ 2,5× piksel) + Iris Xe | | ≈ 7–9 ms | 60 fps içinde, ama pay azalır |
| Eski Intel UHD 620 sınıfı | ≈ 60–70× | ≈ 15–18 ms | 1080p'de sınırda (≈ 50–60 fps); düşük çözünürlükte rahat |

CPU tarafı: hızlı bir masaüstünde ≈ 0,15–0,5 ms; 3–4 kat yavaş bir işlemcide bile 2 ms altı. 50 oyunculu odada sunucu verisi işlenince artacaktır (Faz 2+), şimdi ölçülemez.

Sonuç: hedef (orta seviye masaüstü tarayıcıda ≥ 60 fps, ≤ 120 çizim çağrısı) şu anki sahne için karşılanıyor görünüyor. Tarayıcı-öncelikli proje kararı gereği ayrı kalite katmanı eklemedik. Eski entegre ekran kartlarında sorun çıkarsa ilk adım su shader'ını (en pahalı parça) sadeleştirmek ya da ekran çözünürlük ölçeğini düşürmek olur; ikisi de ucuz.

## Kendi makinende ölçmek için

1. `pnpm dev`, tarayıcıda `http://localhost:5173/?debug=1` aç.
2. Konsola (F12) şunu yaz: `await __tb.probe(1920, 1080)`. Çıktıdaki `sceneMs` GPU süresidir. `without` ve `only` alanları hangi parçanın ne kadar tuttuğunu gösterir.
3. Gerçek akıcılık için ekranın sol üstündeki debug HUD'ye bak (fps, kare süresi, çizim çağrısı). Tarayıcı dikey senkronu yüzünden fps ekranın yenileme hızında takılı kalır; asıl bilgi `sceneMs`'dir.

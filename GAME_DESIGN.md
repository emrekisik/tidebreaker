# Tidebreaker.io — Oyun Tasarım ve Teknik Doküman

> **Sürüm:** 0.1 (taslak) · **Çalışma adı:** Tidebreaker.io (marka ve alan adı kontrolü yapılmadı)
> **Dil:** Doküman Türkçe. Kod, tanımlayıcılar, kod yorumları ve commit mesajları İngilizce.
> Bu doküman projenin **tek doğruluk kaynağıdır**. Kodla çelişen bir yer bulunursa önce doküman güncellenir, sonra kod.

---

## 0. Bu doküman nasıl kullanılır (Claude Code için)

1. Önce `CLAUDE.md` okunur (kısa ve değişmez kurallar). Bu doküman ayrıntıdır.
2. İş **fazlarla** ilerler (§17). Bir faza başlamadan önce o fazın ilgili bölümlerini oku, kısa bir plan yaz, kullanıcıdan onay al, sonra kodla.
3. Sayısal değerler (hasar, hız, maliyet vb.) **başlangıç tahminidir**. Kodda gömülü sabit olarak durmaz; `packages/shared/src/config/` altında veri olarak tutulur (bkz. Ek A). Dengeleme değişikliği = config değişikliğidir.
4. Her görev sonunda: tip kontrolü + lint + testler geçer, ilgili doküman bölümü güncellenir, küçük ve anlamlı bir commit atılır.
5. §19'daki açık sorular için makul varsayımlar yapıldı. Bir varsayımı değiştirmek gerekiyorsa kullanıcıya sor, kendi kararınla değiştirme.
6. Ağ protokolünü (§10) değiştirirsen `PROTOCOL_VERSION` değerini artır ve codec testlerini güncelle.
7. Emin olmadığın bir teknik karar için "daha basit olanı seç, ölç, gerekirse karmaşıklaştır" ilkesini uygula.

---

## 1. Vizyon ve tasarım sütunları

**Tek cümle:** İki takımın birbirinin **uçak gemisini** (üssünü) batırmaya çalıştığı, denizde geçen, 3D low-poly takım savaşı. Adını yaz, oyna, takımınla düşman uçak gemisini yok et. (Tür ilhamı: Starblast.io'nun .io kolaylığı; oyun modu bizim.)

**Sütunlar**

1. **Anında eğlence.** "Oyna" tuşundan ilk top atışına ≤ 10 sn. Hesap, kayıt, uzun öğretici yok.
2. **Risk–ödül.** Değerli şeyler tehlikeli yerlerde durur (iç bölge, korsan kaleleri). Ölürsen her şeyi kaybedersin ama ganimet bırakırsın.
3. **Okunabilirlik.** Düz renkli low-poly siluetler. Gemi sınıfı bir bakışta anlaşılır, efektler bilgi taşır.
4. **Ucuz ve ölçeklenebilir.** Bir VPS çekirdeği ≈ bir oda. Sıcak döngüde sıfır allocation, sıkı ikili protokol.
5. **Tarayıcı öncelikli.** Masaüstü tarayıcı birincil platformdur (klavye + fare). Mobil/dokunmatik desteği hedeflenmez, kalite katmanı yoktur. Hedef: orta seviye masaüstünde ≥ 60 fps.
6. **Juice.** Su, kıç izi, duman, sarsıntı, ses. Oyunun "hissi" ayrı bir kalite kapısıdır.

**Telif/marka notu:** Starblast'ın varlıkları, isimleri, arayüzü ve ship tree'si kopyalanmaz. Yalnızca tür ve mekanik ilhamı alınır. Tüm asset'lerin kaynağı ve lisansı `ASSETS.md` dosyasında tutulur.

---

## 2. Referans: Starblast AMA'sından dersler ve bizim kararlarımız

Starblast geliştiricilerinin 2017 r/gamedev AMA'sından çıkarılan bilgiler ve bu projedeki karşılıkları:

| Starblast (2017) | Bizim kararımız |
|---|---|
| THREE.js ile render | three.js (sürüm sabitlenir) |
| Node.js sunucu, oyun durumu bellekte düz JS nesneleri, Redis yok | Node.js ≥ 22 LTS, durum bellekte, harici veritabanı yok (v1) |
| engine.io ile WebSocket iletişimi | Düz WebSocket (`ws`), `Transport` arayüzü arkasında. engine.io'nun long-polling fallback'i bugün gereksiz |
| Bir oyun örneği = bir CPU çekirdeği, çekirdek başına süreç | Oda başına bir süreç, çekirdek başına bir oda |
| Çekirdek yükü %65'i geçince yeni oyuncu alınmıyor | Tick-busy EMA < 0.65 kapısı (§11.6) |
| Sıcak döngülerde object allocation yok (GC takılması) | Aynı kural. Lint kuralı + benchmark ile zorlanır (§11.3) |
| Instance başına ≤ ~150 MB bellek, $5 VPS'te 100+ oyuncu | Bütçe: oda başına ≤ 200 MB (§16) |
| Client-side prediction + rollback / interpolasyon | Kendi gemi için prediction + reconciliation, diğerleri için interpolasyon (§10.5) |
| 200 ms sabit ping hâlâ oynanabilir | Hedef: 200 ms'e kadar akıcı, 300 ms'e kadar oynanabilir |
| Procedural görseller, ~72 KB istemci | Bizde 3D low-poly GLB var, bütçe daha yüksek: ilk yükleme ≤ 2.5 MB. Ada geometrisi procedural (indirme yok) |
| Pictogram chat (serbest chat yok, çok dilli, moderasyon yükü yok) | Serbest chat yok, sadece emote |
| MongoDB sadece kayıtlı oyuncular için | v1'de veritabanı yok. İleride SQLite (§17, Faz 10) |
| Snapshot tabanlı özel dağıtım, 5 bölge | Docker Compose + bölge başına VPS, ilk bölge EU |
| Mobil oyuncu < %1, kontroller zor | Mobil desteklenmez, oyun masaüstü tarayıcı içindir |
| WebAssembly yerine önce kod optimizasyonu | WASM yok |
| Electron ile Steam | Backlog |

---

## 3. Oyun döngüsü ve oyuncu yolculuğu

```
Gir (isim) → T1 gemide doğ → topla / vur → Para + Score kazan → stat yükselt → sınıf atla
   ▲                                                                              │
   └── öl → ganimet bırak → T1'de tekrar doğ ◄── risk: iç bölge, PvP, boss ◄──────┘
```

**Zaman hedefleri (aktif oyuncu, tahmini):** T2 ≈ 2–3 dk · T3 ≈ 6–9 dk · T4 ≈ 15–20 dk · T5 ≈ 30–40 dk. `tools/balance-sim` ile doğrulanır, config ile ayarlanır.

**İlk 60 saniye tasarımı**
- Doğuş noktasının yakınında "starter cluster" (5–6 sandık/varil) garanti edilir. İlk ödül ≤ 10 sn içinde gelmeli.
- **Spawn koruması:** doğuştan sonra 3 sn (`MATCH.spawnProtectSec`) hasar alınmaz; **ilk atışta biter** (korumadan ateş edip kamp yapılamaz).
- Ekranda 15 sn boyunca kontrol ipucu (WASD / nişan / ateş). Sonra kaybolur.
- İlk upgrade'e (12 para) ≈ 20–30 sn'de ulaşılmalı.

**Ölüm kuralı (io standardı)**
- Gemi batınca tüm score/para/upgrade sıfırlanır, T1'de yeniden doğulur.
- Ölünce `YOU_DIED` ekranı: yaşama süresi, öldürme sayısı, score, öldüren kişi. "Tekrar oyna" ismi hatırlar.
- Bağlantı kopması: son 10 sn içinde hasar alıp vermişse gemi 10 sn boyunca kontrolsüz yavaşlayarak kalır (combat-log koruması), yoksa anında kaldırılır.
- AFK: portta değilken 45 sn girdi yoksa oyuncu menüye atılır.

---

## 4. Dünya

### 4.1 Harita
- Kare harita, **1100 × 1100 birim** (1 birim ≈ 1 metre, stilize; ilk tasarımda 2400 idi, oynanırken çok büyük gelince iki kez küçültüldü). Merkez (550, 550). Sınırlarda görünmez yumuşak duvar: kenardan 60 birim içinde hız sönümü (`MAP.boundary.damp`) ve içeri doğru itme (`push`), en uçta sert kıskaç; oyuncunun gemisi banda girince ekranın kenarları kararır ve "fırtına" uyarısı çıkar (`boundaryDepth`).
- Harita **seed'den deterministik üretilir**. Sunucu yalnızca seed'i gönderir, istemci aynı kodla (`shared`) aynı haritayı üretir. Üretim kodu hem Node'da hem tarayıcıda aynı sonucu vermelidir (hash testi, §14).
- Koordinat sistemi: simülasyon 2D `(x, y)`. three.js dünyası `(x, 0, y)`. **Heading** θ radyan, +x'ten +y'ye doğru ölçülür, model ileri yönü +x'tir ve `mesh.rotation.y = -θ` uygulanır (sık yapılan hata: işareti unutmak).

### 4.2 Bölgeler (risk–ödül)
| Bölge | Merkeze uzaklık | Sandık/varil/hazine çarpanı | Korsan yoğunluğu |
|---|---|---|---|
| Dış (Güvenli Sular) | > 375 | ×1.0 | düşük |
| Orta (Ticaret Yolları) | 200–375 | ×1.5 | orta |
| İç (Korsan Suları) | < 200 | ×2.5 | yüksek, kaleler, boss |

### 4.3 Adalar
Toplam 22 ada (3 liman, 3 kale, 4 hazine, 12 düz) + 45 resif kümesi (≈ 90 kaya). Seed ile Poisson-disc örnekleme (min mesafe), gövde: 12–18 köşeli, gürültüyle bozulmuş çokgen (yarıçap 12–30; liman ≥ 18, kale ≥ 20, çünkü binalar sığmalı).

| Ada tipi | Adet | İşlev |
|---|---|---|
| **Liman (port)** | 3 (dış/orta bölgede, ~120° aralıklı) | Güvenli bölge: silahlar kapalı, can/kalkan rejenerasyonu ×4. Hasar bağışıklığı bütçesi: ziyaret başına 12 sn, ayrıldıktan 30 sn sonra yenilenir. Bütçe bitince savunmasız ama silahlar yine kapalı, yani saklanıp kamp yapmak cazip değil |
| **Korsan kalesi (fort)** | 3 (orta/iç) | Sabit kale topları (PvE), merkez kulesi, ödül sandıkları. Yıkılınca 5 dk sonra yeniden kurulur |
| **Hazine adası** | 3 (orta) | Sahil halkasında 4 sn durarak "kazı" yapılır, sandık çıkar (ada başına 120 sn bekleme) |
| **Düz ada** | 5 | Siper ve navigasyon engeli. Mermileri engeller |
| **Fener** (opsiyonel, Faz 10) | 1 (merkez) | Ele geçirme noktası |

- Adalar **katıdır**: gemi çokgen kenarında kayar (hızın adaya doğru bileşeni sıfırlanır, kalan teğet hız her tick `ISLAND_COLLISION.tangentKeep` = ×0.96 ile sönümlenir; tek seferlik ×0.9 yerine sürtünme gibi çalışır), hasar yok. Mermiler adalara ve resiflere çarpınca biter (swept test, tünelleme yok); vuruş yerinde toz, kaya parçası ve kıvılcım çıkar. Adanın arkasına ateş edilemez.
- Harita kodu: `packages/shared/src/world/` (`generateMap(seed)`, `mapHash`, `circleVsWorld`, `segmentVsWorld`). Köşeler 1/16 birime yuvarlanır; böylece Node ile tarayıcı `sin/cos` farkları haritayı değiştirmez. Hash testi üç seed için sabit değer kontrol eder, 200 seed için kural testleri (sayı, boşluk, bölge, basit çokgen) koşar. İstemcide `?seed=<sayı>` ile başka harita denenebilir; debug HUD seed, hash, ada ve resif sayısını gösterir.
- Resifler: küçük dairesel engeller (yarıçap 4–8), görsel olarak kayalık.

### 4.4 Doğuş (spawn)
- Oyuncular **kendi takımının uçak gemisinin** çevresinde doğar ve yeniden doğar (bkz. §4.5). Doğuş noktası uçak gemisinin düşmana bakan tarafındaki bir halkadan seçilir; mevcut gemilere en uzak aday alınır.
- (FFA için tasarlanan "8 aday nokta" kuralı kullanılmıyor.)

### 4.5 Oyun modu: takım savaşı ve uçak gemisi
**Amaç:** Karşı takımın uçak gemisini yok etmek. Her takımın üssü kendi uçak gemisinin bulunduğu yerdir.
- **Takımlar:** 0 = mavi, 1 = kırmızı. Oda kapasitesi başlangıçta 20 oyuncu (takım başına 10, `MATCH.maxPlayers`). Yeni oyuncu oyuncu sayısı az olan takıma atanır (eşitse mavi). Takım seçimi yok.
- **Uçak gemileri** (`aircraft_carrier` modeli, `MATCH.carriers`): haritanın iki karşıt kenarına demirli (mavi batı, kırmızı doğu), **hareketsiz**, yüksek can + kalkan (`hull 4000`, `shield 1500`, başlangıç tahmini). Gemi çarpışmalarında **itilemez** (sonsuz kütle), çarpan taraf hasar alır. Çevresinde ada üretilmez (`MAP.baseClear`).
- **Otomatik savunma:** uçak gemisinin tareti (modelde iki taret düğümü) menzildeki en yakın **düşman** gemiyi kendi seçer, hedefin hızına göre öne nişan alıp ateş eder (roketin yavaş kalkışı da hesaba katılır). Birinci taret makineli tüfek (`carrier_gun`: hasar 8, 0,25 sn, menzil 60, hız 75), ikinci taret **roket atar** (`carrier_rocket`: hasar 36, 1,5 sn, menzil 70; uçak gemisi için taret tipi istisnasıdır). Dost ateşi yoktur.
- **Maç akışı:** uçak gemisinin canı 0'a inince o takım yenilir. Galip takım duyurulur, 15 sn ara verilir, sonra yeni tur başlar: iki uçak gemisi tam canla yenilenir, herkes kendi uçak gemisinde yeniden doğar. Harita aynı kalır (seed sabit).
- **Ölüm ve yeniden doğuş:** batan oyuncu `respawnSec` (5 sn) sonra kendi uçak gemisinde otomatik yeniden doğar (yeniden `PLAY` gerekmez). Sınıfını değiştirmek için yeniden `PLAY` gönderebilir.
- **Dost ateşi / çarpışma:** takım arkadaşının mermisi hasar vermez. Takım arkadaşlarıyla gemi–gemi çarpışmasında itme olur, hasar olmaz.
- **Gemi sınıfı (geçici):** ilerleme sistemi (puan, para, T1–T5) takım modu için yeniden tasarlanana kadar oyuncu `PLAY` sırasında **herhangi bir sınıfı seçer** (test ve denge için). Para/yükseltme, korsanlar, limanlar, kaleler, hazine adaları ve tüccar bu fazda yok; takım oyununa nasıl uyarlanacakları Faz 4–5'te ayrıca konuşulacak (§6, §7, §8 FFA varsayımıyla yazıldı).

---

## 5. Gemi

### 5.1 Kontroller
| | Masaüstü |
|---|---|
| Hareket | **W** = gaz, **S** = fren, durunca **geri vites** (ileri hızın %40'ı), **A/D** = dümen (gemi kendi başına döner). **Sağ tık** = gaz (W ile aynı). Gazı bırakınca gemi yavaşça durur |
| Nişan | Fare konumu |
| Ateş | Sol tık basılı tut |
| Upgrade | 1–5 tuşları veya paneldeki butonlar | Panel butonları |
| Sınıf atla | `U` veya buton | Buton |
| Emote | `E` tekerleği / 1–4 | Emote butonu |

### 5.2 Hareket modeli (sunucu ve istemci aynı `shared` fonksiyonunu çalıştırır)
Durum: `pos(x,y)`, `heading θ`, `speed v` (heading yönünde skaler). Her tick (`dt = 1/TICK_RATE`):

```
steer, throttle in [-1, 1]            // INPUT mesajında moveX = steer, moveY = throttle
turnScale = lerp(0.35, 1, clamp(v / (0.5*vMax), 0, 1))   // duran gemi hantal döner
θ += steer * turnRate * turnScale * dt
if throttle > 0:  vTarget = vMax*throttle*(1 - 0.15*|steer|);  v += clamp(vTarget - v, -coast*dt, +accel*dt)
if throttle < 0:  önce v -> 0 (fren: vMax / 1.5 sn), sonra v -> -0.4*vMax (geri vites, ivme %60)
if throttle = 0:  v -> 0   (süzülme: vMax / 5.0 sn)
accel = vMax / 2.5
pos += (cosθ, sinθ) * v * dt
```
- Yanal kayma yok. Geri gidebilir (düşük hızda). Dümen yönü geri giderken de aynı kalır. `turnRate` sınıfa göre değiştiği için ağır gemiler daha yavaş ve zor döner. Dalga sallanması (yalpa/yatma) sadece istemci tarafında kozmetiktir (sunucuyu etkilemez).
- Sayılar `SHIP_MOVEMENT` (`config/ships.ts`).
- `vMax`, `turnRate` = sınıf tabanı × upgrade çarpanı (§6).
- **Gemi–gemi çarpışması (hasarlı):** gövde daire zincirleri çakışınca gemiler ayrılır, temas normali boyunca momentum alışverişi olur (kütle = can), merkez dışı vuruş gemiyi **savurur (yan itme)** ve **döndürür (spin)**; ikisi de kendiliğinden söner. Yaklaşma hızı `minDamageSpeed`'i aşarsa iki gemi de hasar alır; **hafif gemi aynı çarpmada daha çok hasar alır** (`damage = damagePerSpeed × hız × 2 × diğerinin kütlesi / toplam`). Gemi batarsa öldüren çarpan sayılır. Sayılar `config/collision.ts`. İstemci tarafı: gemi ve kamera sarsıntısı, kıvılcım/su efektleri (kozmetik). Geniş faz şimdilik düz çift döngü, Faz 6'da uzamsal grid.
- **Gemi–ada çarpışması:** gövde 2–3 daire zinciri olarak modellenir, çokgen kenarına itme.

### 5.3 Silah sistemi: mount modeli
Her gemi sınıfı birden fazla **mount** (top yuvası) taşır. Mount: gemi yerel konumu, bakış yönü, yay genişliği, silah tipi.

```ts
interface MountDef {
  id: string;
  offset: [number, number];  // [forward, starboard] local units
  facingDeg: number;         // 0 = bow, 90 = starboard, -90 = port, 180 = stern
  arcDeg: number;            // half-arc; 180 = full 360° turret
  weapon: WeaponId;          // key into WEAPONS table
}
interface WeaponDef {
  damage: number; intervalSec: number; range: number;
  projectileSpeed: number; radius: number; spreadDeg: number;
}
```
- **Ateş kuralı:** `fire` bayrağı açıkken, nişan açısı mount'un dünya yayı içindeyse ve cooldown bittiyse mount ateşler. Yön = nişan açısı (+ küçük sunucu taraflı rastgele sapma). Yay dışındaysa o mount ateş etmez, arayüz yayları gösterir.
- Cooldown = `weapon.intervalSec × reloadMultiplier`. Aynı gruptaki mount'lar gecikmeli ateşler (kozmetik "yaylım ateşi" efekti).
- **T1 tek 360° güverte topuyla başlar** (yeni oyuncu için kolay), üst sınıflar yan bordalar (broadside) ve ek taretlerle zenginleşir. Bu, "gemiyi topun menziline döndürme" taktik derinliğini sınıf büyüdükçe getirir.
- **Mermi:** düz çizgi, sabit hız, `range` sonunda söner. Yeterince yavaş olduğu için **lag compensation / rewind yoktur**: oyuncular önden nişan almayı öğrenir, sunucu kararı kesindir (§10.7).

### 5.4 Hasar modeli
- Hasar önce **kalkan**ı, kalkan 0 olunca **gövde (hull)** canını düşürür.
- **Kalkan yenilenme:** son hasardan 4 sn sonra başlar, boş bir kalkan 6 sn'de dolar (`COMBAT` config'i; sınıf bazlı sabit, upgrade'siz). **Uçak gemisi** de yenilenir ama çok yavaş: 10 sn sonra başlar, boştan doluya 60 sn. Sürekli baskı turu kazandırır, kısa bir saldırı kalıcı hasar bırakmaz demek değildir.
- **Gövde yenilenme** (upgrade'li "health regen"): son hasardan 6 sn sonra, `seviye × %0.4 maxHull / sn`.
- Limanda yenilenme ×4 (Faz 5).
- Can sıfırlanınca: batma animasyonu (≈ 2 sn), `SHIP_SUNK` olayı, kill feed ve skor tablosu güncellenir. Ganimet (kağıt para) saçılması ekonomiyle birlikte Faz 4'te tasarlanır.
- **Vuruş testi:** mermi hareketi **swept segment–circle** testiyle yapılır (tünelleme yok). Gemi vuruş şekli: gövde boyunca daire zinciri.

---

## 6. Gelişim sistemi

### 6.1 İki sayaç
- **Score:** sadece artar. Sınıf atlama kapısı + liderlik tablosu. Ölünce sıfırlanır.
- **Para (`cash`):** harcanabilir cüzdan, **kağıt para (banknot)** temalıdır: dünyada yeşil banknot destesi olarak görünür ve toplanır. Stat yükseltmeye gider.
- Her kazanım (`gain(amount)`) ikisine birden eşit eklenir. Harcama sadece parayı düşürür.

### 6.2 Yükseltilebilir 5 stat
| Stat | Etki (seviye L başına) | Kodda |
|---|---|---|
| **Speed** | `vMax × (1 + 0.04·L)` | `speed` |
| **Reload** (attack interval) | `interval × (1 − 0.04·L)` | `reload` |
| **Turn rate** | `turnRate × (1 + 0.05·L)` | `turn` |
| **Max shield** | `maxShield × (1 + 0.12·L)` | `shield` |
| **Health regen** | `L × %0.4 maxHull / sn` (6 sn hasarsızlıktan sonra) | `regen` |

- Her stat seviyesi 0..cap. **Cap sınıfa bağlıdır:** `statCap(tier) = [3, 4, 5, 7, 8][tier-1]`. Yani sınıf atlamak yeni stat potansiyeli açar.
- **Maliyet:** `statCost(L) = ceil(12 × 1.4^L)` para (L = mevcut seviye). L=0→1: 12, 1→2: 17, 2→3: 24, … 7→8: 129. Bir statı sonuna kadar çıkarmak ≈ 420 para.
- Sınıf atlayınca stat seviyeleri korunur (yeni cap'e göre geçerlidir), can oranı korunur, kalkan tam dolar.

### 6.3 Gemi sınıfları (başlangıç değerleri, hepsi tunable)
Sınıf atlamak **otomatik değil, oyuncu seçimidir**: score eşiği aşılınca panelde "Sınıf Atla" butonu belirir.

| Tier | id | Ad (TR) | Min score | Hull | Shield | Hız (u/s) | Dönüş (°/s) | Uzunluk | Mount'lar |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `coast_guard_boat` | Sahil Güvenlik Botu | 0 | 100 | 40 | 16 | 120 | 5 | 1 × güverte topu (360°, dmg 10, 0.9 sn) |
| 2 | `gunboat` | Top Gambotu | 200 | 180 | 70 | 14.5 | 100 | 7 | 1 × taret (360°, dmg 12, 0.8 sn) + 2 × yan top (±90°, yay ±25°, dmg 8, 1.1 sn) |
| 3 | `corvette` | Korvet | 800 | 320 | 130 | 13 | 85 | 9 | 1 × taret (dmg 16, 0.75 sn) + yan başına 2 top (dmg 10, 1.0 sn) |
| 4 | `frigate` | Fırkateyn | 2400 | 560 | 220 | 12 | 70 | 12 | 2 × taret (dmg 18, 0.8 sn) + yan başına 3 top (dmg 12, 1.0 sn) |
| 5 | `heavy_frigate` | Ağır Fırkateyn | 6000 | 900 | 380 | 11 | 60 | 15 | 3 × taret (dmg 22, 0.8 sn) + yan başına 4 top (dmg 15, 1.0 sn) |

- Mermi hızı 60 u/s, menzil: makineli 45, top T3 58 → T5 70, roket 70 birim (config).
- **Model tabanlı sınıflar (güncel durum):** sınıflar artık elimizdeki 3D modellere bağlıdır ve her gemi `packages/shared/src/config/ships.ts` içinde kendi hız/dönüş/can/kalkan/boy/vuruş dairesi/mount listesiyle tanımlıdır. Eşleşme: T1 `coast_guard_boat` = assault_boat, T2 `gunboat` = hovercraft ve `landing_craft`, T3 `corvette` = frigate1, T4 `frigate` = frigate2 ve `cruiser`, T5 `heavy_frigate` = battleship. Denizaltı şimdilik yalnızca görsel (oynanabilir sınıf değil). Boylar: coast_guard 5, gunboat/landing 7, corvette ve frigate 11, cruiser 14,5, heavy_frigate 18 (hit daireleri, mount ve namlu ölçüleri aynı oranda ölçeklenir). **Takımlar:** oyuncu mavi, düşman kırmızı. Takım rengi yalnızca modelin **orta gri "gövde boyası" texellerine** uygulanır (mavi takım cyan'a yakın, kırmızı açık/somon tonlu); **silahlar (taretler, launcher'lar) hiç boyanmaz**; beyaz çizgiler, açık gri/beton yüzeyler, koyu detaylar (silahlar), mavi pencereler kendi renginde kalır. Üstteki tablodaki mount düzenleri model gelene kadar tahmindi; gerçek düzen modeldeki taret sayısıdır.
- **Silah tipleri** (`weapons.ts`): `machine_gun` (hızlı, düşük hasar), `cannon_t3/t4/t5` (tablodaki hasar/aralık), `rocket` (uzun reload, **düz isabet**, alan hasarı yok; namludan %25 hızla çıkar ve 0,8 sn boyunca karesel (ease-in) hızlanıp tam hıza (66 u/s) ulaşır: başta yavaş, hedefe yaklaşırken hızlı; görsel olarak belirgin bir yay (bombeli) çizer: yükselip hedefe düşer, vuruş hesabı yine 2D). Her silahın kendi reload'u vardır; bir gemideki mount'lar sırayla ateş eder (`SALVO_GAP_SEC`, arka arkaya yaylım). Mermi, taretin pivotundan namlu ucuna (`muzzle`) kadar ilerlemiş noktada doğar. Reload süreleri sim adımına (50 ms) yukarı yuvarlanır.
- Vuruş daireleri her modelin gövde ayak izinden türetilir (yarıçap ≈ genişlik × 0,45).
- Kamera uzaklaştırması sınıfla artar (§12.3).
- **Dallanma (backlog, Faz 10):** T4'ten itibaren iki yol (ör. "Fırkateyn" dengeli / "Hızlı Saldırı Gemisi" cam top). Veri modeli buna hazır olmalıdır: `ShipDef.next: ShipId[]`.

### 6.4 Ödül formülleri (config'te)
```
tierScore      = [0, 200, 800, 2400, 6000]
killReward     = min(victimScore * 0.35, 1500) * tierDiffFactor * repeatFactor
wreckLoot      = victimScore * 0.25            // max 25 banknote entity, min banknote değeri 5, 40 sn sonra söner
tierDiffFactor = victimTier >= killerTier ? 1 : (−1: 0.7, −2: 0.3, ≤−3: 0.1)
repeatFactor   = aynı katil→aynı kurban 300 sn içinde 3. ve sonrası: 0.25
pirateReward(playerTier) = base * clamp(1 − 0.25*(playerTier − pirateTier), 0.1, 1)
assist         = son 10 sn içinde hasar verenler, killReward'ı hasar oranında paylaşır
```
- **Anti-snowball:** liderlik tablosunda 1. oyuncunun öldürülme ödülüne +%20 bounty.
- **Anti-farm:** aynı IP'den katil–kurban çiftinde ödül yok (en iyi çaba). Yeni doğanı ezmeyi cezalandıran `tierDiffFactor` + spawn koruması.

---

## 7. Kazanç kaynakları

### 7.1 Denizde toplanabilirler
Hepsi gemiyle üstünden geçince toplanır (toplama yarıçapı ≈ gemi yarıçapı + 1.5). Değerler bölge çarpanıyla çarpılır (§4.2).

| Öğe | Değer | Notlar |
|---|---|---|
| **Sandık (crate)** | 8 para | Harita genelinde hedef ≈ 140 adet, 25 sn sonra yeniden doğar |
| **Varil (barrel)** | 4 para + %25 ihtimalle gövdeyi %15 onarır | ≈ 60 adet |
| **Hazine sandığı (chest)** | 100 para | ≈ 8 adet, kale ve hazine adalarının yakınında, 90 sn bekleme. Harita üstünde ışın işareti |
| **Ganimet parası (banknote)** | değişken | Batan gemilerden düşer |
| **Deniz mayını (mine)** [P2] | patlayınca 5 para | İç bölgede sabit mayın tarlaları, değince 40 hasar. Yok edilebilir |
| **Şamandıra (power-up)** [P2] | geçici güç | Tamir (hull %40), Aşırı Yükleme (reload −%35, 10 sn), Rüzgâr Arkadan (hız +%30, 8 sn), Kalkan İncisi (kalkan tam). Harita genelinde en çok 12 adet |

Spawner kuralı: bölge ve hücre başına hedef sayıya göre, mevcut öğeler ve oyuncu mesafesi gözetilerek (oyuncunun görüş alanında aniden belirmez, ≥ 100 birim uzakta doğar).

### 7.2 Korsanlar ve PvE hedefleri
| Hedef | Tier (ödül ölçeği için) | Hull | Davranış | Ödül (para) |
|---|---|---|---|---|
| **Korsan Sandalı** (`skiff`) | 1 | 40 | Hızlı, zayıf, sürü halinde | 18 |
| **Akıncı** (`raider`) | 2 | 130 | 1 taret + 2 yan top | 45 |
| **Korsan Brigi** (`corsair`) | 3 | 380 | Güçlü, mesafe korur | 140 |
| **Kaptan Gemisi** (`flagship`, boss) | 5 | 1600 + 400 kalkan | Her ≈ 6 dk'da en çok 1 adet, tüm oyunculara duyurulur, haritada işaretli | 600 |
| **Tüccar Gemisi** (`merchant`) | 3 | 700 | Silahsız, limanlar arası rota, saldırıya uğrayınca kaçar. Her ≈ 4 dk'da 1 adet | 350 + 3 sandık |
| **Kale topu** (`fort_turret`) | 3 | 300 | Sabit, menzil 55, ada başına 3–4 adet | 80 |
| **Kale çekirdeği** | — | 800 | Tüm toplar yıkılınca hasar alabilir | 300 + 3 hazine sandığı |

- Korsan sayısı hedefi: `clamp(10 + 0.5 × oyuncu, 10, 40)`; CPU kapısı açıksa.
- Tüccar gemisi kasıtlı bir **PvP mıknatısı**: büyük ödül, oyuncuları aynı noktada çatıştırır.
- Backlog olay fikirleri: **Kraken** (hull 3000, ödül hasar oranında paylaşılır), **Fırtına bölgesi**, **Korsan Armadası**.

### 7.3 Oyuncu öldürme
§6.4'teki formüller. Ayrıca batan geminin ganimeti herkes tarafından toplanabilir (intikam ve geri dönüş mekaniği).

### 7.4 Ada etkileşimleri
- **Liman:** can/kalkan yenilenmesi, silah kapalı.
- **Hazine adası kazısı:** sahil halkasında 4 sn hareketsiz kal, sandık çıkar.
- **Kale:** topları yık, çekirdeği yık, ödülleri topla.

---

## 8. Düşman yapay zekası (korsanlar)

Basit, ucuz **sonlu durum makinesi (FSM)**. Amaç zeka değil, oyuncuya hedef ve hareketli dünya hissi vermek.

| Durum | Davranış | Geçiş |
|---|---|---|
| `PATROL` | Ev noktası (cove/kale) çevresinde rastgele hedefe seyir | Algılama yarıçapında (≈ 55–70 birim) oyuncu → `ENGAGE` |
| `ENGAGE` | Hedefe tercih edilen mesafeye (`0.7 × menzil`) yaklaş/orbit yap, yan borda yayına girmeye çalış, nişan al, ateş et | Hedef kayboldu veya uzaklaştı → `RETURN`; can < %25 (sadece `skiff`/`raider`) → `FLEE` |
| `FLEE` | Hedeften uzaklaş, eve dön | Can toparlanınca/mesafe açılınca → `PATROL` |
| `RETURN` | Ev noktasına dön (leash yarıçapı 150 birim) | Eve varınca → `PATROL` |

- **Engel kaçınma:** 3 "bıyık" ışını (ön, ±35°) ada çokgenlerine/resiflere karşı. Çarpacaksa dümeni çevir.
- **Hedef seçimi:** algılama yarıçapındaki en yakın oyuncu (basit). Tek hedefe kilitlenme süresi ≥ 3 sn (titremeyi önler).
- **Maliyet kontrolü:** AI düşünme 5 Hz (her 4. tick, `id % 4` ile ofsetli, yük dağılır). Hareket/ateş her tick.
- Korsanlar **oyuncularla aynı** `stepShip` ve silah kodunu kullanır (girdi üreten AI katmanı).
- **Doldurma botları (fill bots, sahte oyuncu):** `FILL_BOTS=false` varsayılan. Açılırsa liderlik tablosunda ayrı işaretlenir ve kalıcı skor tutulmaz. Oyuncuları yanıltmamak için korsan botlar zaten "Korsan" adıyla ve farklı renkle gösterilir.

---

## 9. Teknik mimari

### 9.1 Yığın
| Katman | Seçim | Not |
|---|---|---|
| Dil | **TypeScript (strict)** her yerde | `noUncheckedIndexedAccess` açık |
| Paket yönetimi | **pnpm workspaces** monorepo | |
| Sunucu | Node.js ≥ 22 LTS + **`ws`** | `Transport` arayüzü arkasında. Profil gerektirirse `uWebSockets.js`'e geçilebilir (arayüz aynı kalır) |
| İstemci render | **three.js** (sürüm sabit) + Vite | Framework yok (vanilla TS DOM modülleri) |
| UI | HTML/CSS katmanı (canvas üstünde) | HUD, menü, liderlik tablosu. Karmaşıklaşırsa Preact |
| Protokol | **Özel ikili** (`DataView`, little-endian) | JSON yok |
| Test | **vitest**, `fast-check` (property test), **Playwright** (smoke) | |
| Lint/format | ESLint + Prettier + `tsc --noEmit` | Sıcak yol için özel kural (§11.3) |
| CI | GitHub Actions | typecheck + lint + test + build |
| Dağıtım | Docker Compose (Caddy + oda süreçleri) + Cloudflare Pages (statik istemci) | |

### 9.2 Repo yapısı
```
/
├─ CLAUDE.md
├─ GAME_DESIGN.md
├─ ASSETS.md                      # her asset'in kaynağı ve lisansı
├─ package.json, pnpm-workspace.yaml, tsconfig.base.json
├─ packages/
│  └─ shared/                     # istemci VE sunucu kullanır, DOM/Node API'si YOK
│     └─ src/
│        ├─ config/               # ships.ts, weapons.ts, economy.ts, world.ts, net.ts, pirates.ts
│        ├─ protocol/             # mesaj tipleri, codec (encode/decode), sabitler, PROTOCOL_VERSION
│        ├─ sim/                  # stepShip, çarpışma, hasar, mount ateş kuralı (saf fonksiyonlar)
│        ├─ world/                # seeded PRNG, harita üretimi, ada geometrisi
│        └─ math/                 # açı, vektör, quantization, spatial grid
├─ apps/
│  ├─ server/
│  │  └─ src/
│  │     ├─ index.ts              # giriş, env okuma
│  │     ├─ transport/            # ws adaptörü, bağlantı yönetimi, rate limit
│  │     ├─ room/                 # Room, tick döngüsü, tick sırası
│  │     ├─ sim/                  # varlık havuzları, spawner'lar, AOI, mermiler (hot/ = sıfır-alloc bölgesi)
│  │     ├─ ai/                   # korsan FSM
│  │     ├─ http/                 # /status, /metrics
│  │     └─ util/                 # logger (pino), metrik halkaları
│  └─ client/
│     ├─ index.html
│     ├─ public/                  # models/*.glb, audio/*
│     └─ src/
│        ├─ main.ts
│        ├─ net/                  # WS istemcisi, saat senkronu, prediction, interpolasyon
│        ├─ game/                 # varlık görünümleri, kamera, efektler
│        ├─ render/               # renderer, su, ada mesh üretimi, instanced mesh'ler
│        ├─ input/                # klavye+fare
│        ├─ ui/                   # menü, HUD, liderlik, minimap, upgrade paneli
│        └─ audio/
├─ tools/
│  ├─ loadtest/                   # N sahte istemci (gerçek protokol)
│  ├─ netem/                      # WS proxy: gecikme/jitter/takılma simülasyonu
│  ├─ balance-sim/                # ekonomi/zamanlama simülasyonu
│  └─ assets/                     # GLB optimizasyon boru hattı (gltf-transform)
├─ assets-src/                    # ham kaynak modeller (Blender/GLB)
├─ deploy/                        # Dockerfile, compose.yml, Caddyfile
└─ .github/workflows/ci.yml
```

**Bağımlılık kuralları:** `shared` hiçbir şeye bağımlı değildir (Node/DOM yok). `server` ve `client` yalnızca `shared`'a bağımlıdır, birbirlerine değil. `shared/sim` saf fonksiyonlardır (rastgelelik dışarıdan enjekte edilir) ve ağırlıkla test edilir.

### 9.3 Süreç ve oda modeli
- **Bir Node süreci = bir oda.** Tek iş parçacığı, tek `Room` nesnesi. Çok çekirdekli VPS'te çekirdek başına bir süreç.
- Ortam değişkenleri: `ROOM_ID`, `PORT`, `REGION`, `MAX_PLAYERS` (varsayılan 50), `TICK_RATE` (20), `SEED` (rastgele ya da sabit).
- Odalar birbirinden bağımsızdır (paylaşımlı durum yok). Harita seed'i oda başına farklı olabilir.

---

## 10. Ağ mimarisi

### 10.1 Genel model
**Yetkili sunucu.** İstemci yalnızca **girdi** gönderir. Sunucu simülasyonu çalıştırır, her oyuncuya yalnızca çevresindeki dünyayı (AOI) gönderir.

| Parametre | Varsayılan | Not |
|---|---|---|
| `TICK_RATE` (sunucu simülasyonu) | 20 Hz | `net.ts`; 30 Hz denenebilir |
| `SNAPSHOT_EVERY` | 2 tick (10 Hz) | Anlık görüntü gönderim sıklığı |
| İstemci girdi gönderimi | Her sim tick'inde (20 Hz) | Sıra numaralı |
| İnterpolasyon gecikmesi | 150 ms | Başka oyuncuların gösterimi |
| Ekstrapolasyon sınırı | 250 ms | Sonra son konumda dondur |
| AOI yarıçapı | 150 birim | Kamera görüş alanı ≈ 100–130 birim, kenar payı var |

### 10.2 Mesaj protokolü (ikili, little-endian)
İlk bayt **mesaj tipi**. Tüm okuyucular sınır kontrolü yapar, geçersiz mesaj bağlantıyı düşürmez ama sayılır (§13).

**İstemci → Sunucu**
| Tip | Ad | Alanlar |
|---|---|---|
| 0x01 | `HELLO` | `u8 protoVersion` |
| 0x02 | `PLAY` | `u8 nameLen, utf8 name[≤48 byte], u8 shipId` (`shipId` = `SHIP_IDS` sırası; Faz 2'de serbest sınıf seçimi, ileride ilerleme) |
| 0x03 | `INPUT` | `u16 seq, u8 flags (bit0=fire), i8 moveX, i8 moveY, u16 aim, u8 aimDist` (9 bayt; `aimDist` = gemiden imlece uzaklık, birim, 0–255) |
| 0x04 | `UPGRADE` | `u8 statId (0..4)` |
| 0x05 | `TIER_UP` | `u8 choiceIndex` |
| 0x06 | `PING` | `u32 clientTimeMs` |
| 0x07 | `EMOTE` | `u8 emoteId` |

**Sunucu → İstemci**
| Tip | Ad | Alanlar |
|---|---|---|
| 0x81 | `WELCOME` | `u8 protoVersion, u32 mapSeed, u8 tickRate, u8 snapshotEvery, u32 serverTimeMs, u32 configHash` |
| 0x8A | `JOINED` | `PLAY`'e yanıt: `u16 entityId, u8 team, u8 shipId`; her yeniden doğuşta da gönderilir |
| 0x8B | `MATCH` | `u8 state (0 oynanıyor, 1 bitti), u8 winnerTeam, u8 restartSec, u16 killsBlue, u16 killsRed` (değişince ve 1 sn'de bir) |
| 0x8C | `KILL` | Kill feed: `u16 killerId, u16 victimId, u8 killerTeam, u8 victimTeam, u8 weapon (255 = çarpışma), u8 len+killerName, u8 len+victimName`. Uçak gemisi katil ise `killerId` 1 ya da 2 |
| 0x8D | `SCORES` | Skor tablosu: `u8 count`, her satır `u16 id, u8 team, u16 kills, u16 deaths, u8 len+name`. Değişince, en çok 1 sn'de bir |
| 0x82 | `SNAPSHOT` | aşağıda |
| 0x83 | `EVENTS` | `u32 tick, u8 count, event[]` |
| 0x84 | `LEADERBOARD` | (FFA varsayımı; takım modunda `SCORES` kullanılır, ilerleme gelince yeniden değerlendirilir) Her 1 sn: en iyi 10 (`u16 id, u32 score, name`) + kendi sıran |
| 0x85 | `YOU_DIED` | `u16 killerId, u8 nameLen, killerName, u8 respawnSec` |
| 0x86 | `PONG` | `u32 clientTimeMs, u32 serverTimeMs` |
| 0x87 | `REJECT` | `u8 reason (VERSION, ROOM_FULL, BAD_NAME, RATE, BANNED)` |
| 0x88 | `STATS` | Kendi durumun değişince: `u32 score, u32 cash, u8 tier, u8[5] statLevels, u16 maxHull, u16 maxShield, u8 flags (canTierUp)` |
| 0x89 | `NOTICE` | Dünya duyurusu: `u8 noticeId, params` (boss doğdu, vb.) |

**El sıkışma:** `HELLO` → `WELCOME` (ya da `REJECT`) → oyuncu isim girince `PLAY` → `JOINED` → `SNAPSHOT`'lar. Öldükten sonra bağlantı açık kalır ve oyuncu `respawnSec` sonra kendi uçak gemisinde otomatik yeniden doğar (`JOINED` tekrar gelir); sınıf değiştirmek için yeniden `PLAY` gönderilir. İstemci `WELCOME`'daki `configHash` kendisininkiyle eşleşmiyorsa bağlanmaz ("oyun sürümü uyuşmuyor").

### 10.3 `SNAPSHOT` düzeni
```
u8  type=0x82
u32 serverTick
u16 lastInputSeq          // reconciliation için
-- self (tam hassasiyet; reconciliation için kx/ky/spin de gerekir) --
f32 x, f32 y, f32 heading, f32 speed, f32 kx, f32 ky, f32 spin, u16 hull, u16 shield
-- varlık listeleri (AOI farkı) --
u8 nEnter, u8 nUpdate, u8 nLeave   // 255'i aşarsa birden çok mesaja böl
ENTER[]:  u16 id, u8 kind, u8 shipId, u8 team, x u16, y u16, heading u8, u8 hp%, u8 shield%, (oyuncuysa) u8 nameLen+name
UPDATE[]: u16 id, u16 x, u16 y, u8 heading, i8 speed, u8 hp%, u8 shield%        // 10 bayt
LEAVE[]:  u16 id
```
- **Kuantizasyon:** konum `u16 = round(x × 16)` (çözünürlük 1/16 birim, harita ≤ 4095 birim), heading `u8 = round(θ/2π × 256)`. Maks. hata < 1/32 birim (test edilir).
- **Varlık türleri (`kind`):** 0 oyuncu gemisi, 1 korsan, 2 tüccar, 3 kale topu, 4 sandık, 5 varil, 6 hazine sandığı, 7 banknote, 8 mayın, 9 power-up, **10 uçak gemisi**.
- **Mermiler snapshot'ta yoktur** (§10.4).
- Statik varlıklar (adalar) hiç gönderilmez (seed'den üretilir).
- Sandık/varil gibi hareketsiz varlıklar için `UPDATE` gönderilmez, sadece `ENTER`/`LEAVE`.
- **Gönderim önceliği (bant genişliği baskısında):** yakın varlıklar her snapshot'ta, uzak varlıklar (> 100 birim) her 2 snapshot'ta bir (5 Hz).

### 10.4 Olaylar (deterministik şeyler için olay tabanlı, bant genişliği tasarrufu)
`EVENTS` mesajı alt-olaylar taşır:
| Olay | Alanlar |
|---|---|
| `PROJECTILE_SPAWN` | `u16 projId, u16 ownerId, u8 weaponId, x u16, y u16, angle u16` (doğuş tick'i mesaj başlığındaki `tick`) |
| `PROJECTILE_END` | `u16 projId, u8 reason (HIT_SHIP, HIT_ISLAND, EXPIRED), x u16, y u16` |
| `SHIP_HIT` | `u16 targetId, u16 attackerId, u8 dmgQuantized, u8 flags (bit0 shieldHit), u8 weaponId, x u16, y u16` (efektler ve hasar sayıları için) |
| `SHIP_SUNK` | `u16 id, u16 killerId, x u16, y u16` |
| `PICKUP` | `u16 entityId, u16 byId, u16 value` |
| `EXPLOSION` | `x u16, y u16, u8 size` |
| `BUMP` | `u16 shipId, u16 otherId (0xFFFF = ada/resif), x u16, y u16, u8 impact×8` (çarpışma efektleri ve sarsıntı) |

İstemci mermiyi **kendisi simüle eder** (düz çizgi, sabit hız, `weapon` config'inden hız/menzil), `PROJECTILE_END` gelince yok eder. Böylece 1000 mermi bile sürekli bant genişliği harcamaz.

### 10.5 İstemci tarafı: prediction, reconciliation, interpolasyon
- **Sabit adım:** istemci simülasyonu sunucuyla aynı `TICK_RATE`'te accumulator ile çalışır. Çizim, iki sim durumu arasında `alpha` ile enterpolasyondur (60+ fps akıcı).
- **Kendi gemi (prediction):** girdi hemen yerel `stepShip`'e uygulanır, `seq` numarasıyla geçmiş halkasına (≤ 64) yazılır ve sunucuya gönderilir.
- **Reconciliation:** `SNAPSHOT` gelince self durumu sunucudan alınır, `lastInputSeq`'ten sonraki girdiler yeniden oynatılır. Hata < 0.05 birimse yok say; 0.05–5 birim arası 100 ms'de yumuşakça düzelt; > 5 birimse anında ışınla.
- **Diğer varlıklar (interpolasyon):** her varlık için son birkaç snapshot tutulur, render zamanı `tahminiSunucuZamanı − 150 ms`. Doğrusal enterpolasyon, heading için en kısa yol. Veri bittiyse en çok 250 ms ekstrapolasyon.
- **Saat senkronu:** sunucu zamanı = `tick × 50 ms`. Her snapshot "T anındaki dünya" der; `T − varış zamanı` farkının **en büyük** değeri (en az gecikmeli paket) alınır ve yavaşça (örnek başına ≤ 0,5 ms) o değere kaydırılır, ani sıçrama olmaz. `PING/PONG` yalnızca RTT göstergesi içindir.
- **Zaman çizelgesi:** diğer oyuncular, gemiler, mermi doğuşları/bitişleri ve vuruş olayları `sunucuZamanı − 150 ms`'de gösterilir (olaylar kendi `tick`'inde işlenir). **Kendi gemin ve kendi mermilerin şimdiki zamanda** çizilir: kendi mermin olay gelince hemen görünür, gecikmesi kadar ileri sarılır (`ProjectileSet.advance`). Kendi gemini ilgilendiren olaylar (vuruş, batma, çarpışma) hemen uygulanır.
- **Kozmetik tahmin:** ateş edince namlu ışığı ve ses hemen çalar. Mermi nesnesi sunucu `PROJECTILE_SPAWN` olayından gelir (hayalet mermi yok).

### 10.6 İlgi alanı yönetimi (AOI)
- Dünya, **64 birimlik hücrelerden** oluşan tek bir **uzamsal grid** ile indekslenir (38×38). Hücre listeleri `Int32Array` baş/sonraki zincirleriyle tutulur (nesne yok).
- Her oyuncu için her snapshot'ta: yarıçap içindeki hücreler taranır, görünür küme hesaplanır, önceki görünür kümeyle **fark** alınır (`ENTER`/`UPDATE`/`LEAVE`). Karşılaştırma `Uint32Array` damga (stamp) dizisiyle O(görünen) olur.
- Oyuncu başına en çok 120 varlık (aşarsa en uzaklar kesilir).

### 10.7 Gecikme kararları (kayıt altında)
1. **Lag compensation / rewind yok.** Mermiler yavaş (60 u/s), gemiler büyük. Hedefi önden vurma oyunun parçası. Karar ve vuruş tamamen sunucuda, o tick'in durumuyla.
2. 200 ms'e kadar akıcı, 300 ms'e kadar oynanabilir olmalı. TCP üzerinde paket kaybı "takılma" olarak görünür (head-of-line blocking), `netem` aracı bunu simüle eder.
3. İleride düşük gecikme gerekirse WebTransport / WebRTC DataChannel (güvenilmez kanal) değerlendirilir, v1 kapsamı dışı.
4. Bant genişliği hedefi: oyuncu başına **ortalama ≤ 4 KB/s aşağı yön**, ≤ 1 KB/s yukarı yön.

---

## 11. Sunucu simülasyonu

### 11.1 Tick döngüsü
```ts
const STEP_MS = 1000 / TICK_RATE;
let next = performance.now();
function loop() {
  const now = performance.now();
  let steps = 0;
  while (now >= next && steps < 3) { tick(); next += STEP_MS; steps++; }
  if (now >= next) next = now + STEP_MS;       // birikmiş gecikmeyi at (spiral of death yok)
  setTimeout(loop, Math.max(0, next - performance.now() - 1));
}
```
Her tick'in süresi ölçülür (`tickBusyMs`), halka tamponda tutulur (§11.6).

### 11.2 Tick sırası (sabit ve belgelenmiş)
1. Gelen girdileri işle: **girdi tabanlı adım**. Her oyuncunun gemisi, kuyruktan aldığı **her `INPUT` için tam bir `stepShip` adımı** atar (adım uydurulmaz, boşsa gemi bu tick hareket etmez). Böylece istemci, sunucunun henüz görmediği girdileri birebir yeniden oynatabilir (reconciliation). Hız hilesine karşı oyuncu tick başına 1 adım kredi kazanır (kullanılmayan krediler en çok 12 adım birikir; takılma sonrası yığılan girdileri bu kredi eritir). Kuyruk 16 girdiyle sınırlıdır; fazlası atılır.
2. `UPGRADE` / `TIER_UP` isteklerini uygula (doğrula: para, cap, eşik)
3. AI düşün (5 Hz dilimli) → korsan girdileri üret
4. Gemi hareketi + çarpışmalar (ada, gemi–gemi, sınır)
5. Mount ateşi → `PROJECTILE_SPAWN` olayı kuyruğa
6. Mermi adımı (swept) + vuruş çözümü → hasar, `SHIP_HIT`/`SHIP_SUNK`/`PROJECTILE_END`
7. Toplama (pickup) çözümü
8. Yenilenme (kalkan/gövde), limanda bağışıklık bütçesi, efekt süreleri
9. Spawner'lar (toplanabilir, korsan, tüccar, boss) + ölü varlıkların temizliği
10. `SNAPSHOT_EVERY`'ye denk gelen tick'te: AOI farkı + serileştirme + gönderim. Olaylar her tick'te toplu gönderilir.
11. Metrikleri güncelle

### 11.3 Sıfır-allocation kuralları (`apps/server/src/sim/hot/**`)
Starblast geliştiricisinin ana tavsiyesi: sıcak döngüde nesne üretme, GC takılması yaratır.
- Gemiler (az sayıda): **nesne havuzu** (`acquire/release`), id'ler `Uint16` serbest listesiyle geri dönüştürülür (en az 5 sn bekleyerek).
- Mermiler ve toplanabilirler (çok sayıda): **struct-of-arrays** (`Float32Array` x, y, vx, vy, `Uint8Array` tip, vb.) + serbest liste. Üst sınırlar (`MAX_PROJECTILES=2048`, `MAX_PICKUPS=512`) sabittir, aşılırsa en eskisini düşür.
- Önceden ayrılmış **gönderim tamponları** (`Buffer.allocUnsafe` büyük slab, `DataView` yeniden kullanılır). Her istemci için yeni `Buffer` üretme, ortak tampondan kopyala.
- Yasak (sıcak yolda): `.map/.filter/.forEach/.reduce/.concat/.slice`, spread, nesne/dizi literali üretimi, closure, `Map`/`Set` oluşturma, string birleştirme. ESLint `no-restricted-properties` + `no-restricted-syntax` ile `hot/**` içinde zorlanır.
- Vektör matematiği çıkış parametreli fonksiyonlarla (`add(out, a, b)`) ya da skaler yerel değişkenlerle.
- Mikro-benchmark (`vitest bench`) ile "N=2000 mermi tick'i" ve "50 oyuncu snapshot serileştirme" ölçülür, regresyon kontrol edilir.

### 11.4 Bağlantı yönetimi
- `ws` seçenekleri: `perMessageDeflate: false` (CPU maliyeti, paketler zaten küçük), `maxPayload: 256`.
- `TCP_NODELAY` açık olmalı (`ws` varsayılan olarak açar, doğrula).
- **Geri basınç:** `ws.bufferedAmount > 64 KB` ise o istemciye snapshot atla; 5 sn sürekli aşarsa bağlantıyı kes.
- Uygulama seviyesi ping 5 sn'de bir; 20 sn yanıt yoksa kes.
- IP başına en çok 4 bağlantı. Giriş kapısı: yalnızca `Origin` izin listesindeki alan adları.

### 11.5 Veri bütünlüğü
- Sunucu oyun durumu bellekte tek gerçek kaynaktır. Çökme = oda sıfırlanır (v1 kabul edilebilir).
- `SIGTERM`: yeni oyuncu kabulünü durdur, `NOTICE` ile duyur, 15 sn sonra temiz kapan.

### 11.6 Yük kapısı ve metrikler
- `tickBusyEma` = tick işlem süresi / `STEP_MS` (üstel hareketli ortalama). **`tickBusyEma < 0.65` ve `players < MAX_PLAYERS` ise** yeni oyuncu kabul edilir, değilse `REJECT(ROOM_FULL)`.
- Yük artarsa kademeli azaltma: önce korsan sayısı hedefini düşür, sonra uzak varlık güncelleme sıklığını azalt.
- **`GET /status`** (herkese açık JSON): `{room, region, players, max, accepting, build}`.
- **`GET /metrics`** (yalnızca localhost): tick süresi p50/p99, `tickBusyEma`, `eventLoopDelay` (`perf_hooks.monitorEventLoopDelay`), giden bayt/sn, varlık sayıları, bellek.
- Profil: `node --inspect` + Chrome DevTools (AMA'da önerilen yöntem).
- Günlük: `pino` (JSON, düşük yük). Sıcak yolda log yok.

---

## 12. İstemci

### 12.1 Render ve performans
- three.js, `WebGLRenderer({ powerPreference: 'high-performance', antialias: <DPR < 2> })`. **`pixelRatio = min(devicePixelRatio, 2)`**.
- **Çizim çağrısı bütçesi ≤ 120**, görünür üçgen ≤ 150k.
- **Instancing:** mermiler, sandık/varil/banknot, parçacıklar, kıç izi parçaları `InstancedMesh` ile.
- Gemiler ayrı `Mesh` (≈ 30 görünür), **tek paylaşımlı materyal**, doku yok, **vertex color**. Takım/korsan rengi `userData` ile.
- Işık: tek yönlü ışık + ortam ışığı (`MeshLambertMaterial` veya basit toon). **Gölge haritası yok**: geminin altındaki yumuşak gölge ve gövdeye yapışık köpük şeridi, su shader'ında gövdenin şeklini izleyen bir "stadyum" olarak çizilir (köpük haritasının B/A kanalları; her kare yeniden basılır). Düz disk/halka kullanılmaz, çünkü büyük gövdelerde dalga tepeleri tarafından kesilip bozuluyordu.
- **Kalite katmanı yok:** tek kalite ayarı vardır (masaüstü hedefli). Bütçeler ve instancing ile performans korunur.
- İstemcide de **kare başına allocation yok**: `Vector3`/`Quaternion` nesneleri yeniden kullanılır. HUD DOM güncellemesi ≤ 10 Hz.
- `devicePixelRatio`/boyut değişimi `ResizeObserver` ile, `user-select: none`.

### 12.2 Su
- Kameranın altında kayan **tek plane** (dünyayı kaplayan dev mesh yok, 200×200 segment). Vertex shader'da **keskin tepeli** dalgalar: her bileşen `2a·(s^p − ortalama)`, s = (1+sin)/2; p > 1 olduğu için tepeler dar ve sivri, çukurlar geniş ve düz (gerçek rüzgâr dalgası gibi). 4 bileşen, derin su dispersiyonuna göre hızlar (uzun dalga daha hızlı). Aynı sabitler JS'te de kullanılır (gemiler tam çizilen dalgada sallanır).
- Fragment shader: eğim dalganın kendisinden analitik hesaplanır (üçgenden değil), üstüne vertex ızgarasının çözemediği ince dalgacıklar (analitik "chop") ve hafif gürültü eklenir; güneş parıltısı, ufukta gökyüzü yansıması (fresnel), ince dantelli beyaz köpük (whitecap) ve ince tepelerden geçen ışık tonu vardır.
- **Gemi izi (köpük haritası):** kameraya bağlı 200×200 birimlik, 1024² yarım-hassasiyetli (half-float) bir render hedefi (`WakeMap`). Her kare: eski içerik kameraya göre kaydırılır, sönümlenir ve hafifçe yayılır (iz zamanla genişleyip dağılır); sonra gemiler yumuşak "kapsül" damgaları basar (max karışım). R kanalı = kıç türbülansı (uzun ömürlü), G kanalı = baş dalgası ve Kelvin kolları (kısa ömürlü). Su shader'ı haritayı okuyup gürültüyle delerek dantelli köpük çizer; iz kesintisizdir, gemiyle birlikte kıvrılır. Kıç damgaları dağınık rastgele noktalardır (düzgün çizgi/ok şekli yok); baş tarafı sıçrama parçacıkları ayrıca vardır.

### 12.2b Efektler (low-poly, kozmetik)
- Tüm efektler **havuzlu parçacıklardır** (7 `InstancedMesh`: duman/su (lit, alfa), ateş ve parlamalar (additive), **yumuşak yuvarlak glow** (billboard, additive: mermi halesi, roket egzozu, yangın ışıması), hız yönünde uzayan kıvılcımlar (additive), **iz çizgileri (tracer, normal karışım: parlak suda rengini korur)**, dönen enkaz, yumuşak kenarlı köpük). Düz renkli, kenarlı (flat-shaded), toplam 7 çizim çağrısı. Ayarlar `config/effects.ts`. Ateş üç renk durağıyla (beyaz-sarı → turuncu → koyu kırmızı) solar. Enkaz suya düşünce sıçrama yapar. Gemi gövdesinin su çizgisinde köpük halkası vardır.
- Sim olaylarına bağlıdır: namlu alevi + duman (silah tipine göre), isabet patlaması (kalkan cyan, gövde turuncu; silaha göre büyür: makineli < top < roket, `FX.impactScale`), ıska = su sıçraması, roket izi, batarken patlama + parçalanma (dönen low-poly parçalar). Hasar durumları gövde oranına göre: < %66 duman, < %33 alev + siyah duman. Duman ve alev geminin her yerinden değil, hasar alınca seçilen **3 sabit noktadan** çıkar (onarılınca sıfırlanır).
- **Top mermisi:** kalın sarı iz (turuncu kısım yok), mermi çevresinde hafif sarı glow; roket gibi ama sarı.

### 12.2c Sahne sanat yönü
- **Okyanus:** parlak turkuaz-mavi (koyu `#0b6989`, açık `#13a0dd`); dalga yüzleri ışık/gölge bantları oluşturur, tepelerde ince köpük.
- **Takımlar:** mavi (boya `#72a9e4`, halka `#23b4ff`), kırmızı (boya `#ff6b78`, halka `#ff2a45`); parlaklık 4,0, ışıma 0,2 (kullanıcının "Görünüm" panelinden seçtiği kombinasyon). Takım rengi gemilerin gövde boyasına uygulanır ve hafif kendi ışığı vardır (parlar); silahlar boyanmaz. Yalnızca **oyuncunun kendi gemisinin** altında parlayan bir halka vardır; diğer gemilerde halka yoktur.
- **Can/kalkan:** can çubuğu takım renginde, kalkan çubuğu daha ince ve **açık camgöbeği** (takım mavisinden ayrışır), kayıp kısım beyaz. Kalkan efektleri de camgöbeği.
- **Gemi izi:** kıçtan kesintisiz, dantelli beyaz köpük şeridi; baş tarafında gövdeye yapışık köpük ve geriye açılan soluk Kelvin kolları (bkz. §12.2).
- **Kontur:** gemi gövdesinde ince koyu kenar çizgisi (ters gövde / inverted hull), sadece gövdede (silahlarda yok). Varsayılan **kapalı**, "Görünüm" test panelinden açılır.
- **"Görünüm" test paneli:** okyanus (koyu/açık), takım boyaları, takım halkaları için renk seçiciler; takım parlaklığı ve ışıma kaydırıcıları; kontur anahtarı. Değerler canlı uygulanır, tarayıcıda hatırlanır ve "Kodları kopyala" ile hex kodları olarak alınır (seçilen kombinasyon config'e işlenir).

### 12.3 Kamera
- **Zoom:** fare tekerleği kamera mesafesini çarpar (`CAMERA.zoomMin/zoomMax`, yumuşatılmış).
- Sabit açı: pitch ≈ 58°, FOV 45. Gemiyi yumuşak takip (kritik sönümlü). Yükseklik/uzaklık `70 + 10 × tier` birim (sınıf büyüdükçe uzaklaşır).
- Vuruş alınca küçük sarsıntı, batma sırasında yavaş zoom-out.

### 12.4 Adalar ve dünya görünümü
- Ada geometrisi **çalışma anında procedural** üretilir (seed + ada numarasından, deterministik; indirme yok): çarpışma çokgeninden polar ızgara arazi (kum plajı → çimen → çıplak kaya → karlı tepe; yükseklik gürültü + sivri tepeler, düz gölgeli düşük poligon, yüz başına renk), üstünde **çam ve yuvarlak ağaçlar**, kayalar ve kaya sivri uçları. Tür farkı: **liman** = kulübe kümesi (kırmızı çatılı), **kale** = düz tepede surlar, 4 kule ve kule/keep, **hazine** = geniş kum, az ağaç, **düz ada** = en yüksek dağlar. Resifler küçük sivri kaya yığınlarıdır (çarpışma dairesiyle aynı boyda). Her ada kendi mesh çifti (kara + saydam kıyı köpüğü/sığ su bantları) olduğu için ekran dışı adalar atlanır; görünen ada başına 2 çizim çağrısı. Sığ su: kıyıdan dalgalı, düzensiz açık turkuaz bantlar. Sahil çizgisi çarpışma çokgeninin ~1 birim içindedir, gemiler hep suda kalır. Adalar küçük tutulur (yarıçap 12–30).
- Limanda iskele, kalede kule/duvar prefab'ları basit kutu birleşimleri ya da küçük GLB.

### 12.5 Asset hattı (3D low-poly GLB)
- Kaynak: `assets-src/`. Biçim: **glTF/GLB**, doku yok (vertex color) ya da tek 128 px atlas.
- `pnpm assets:build` → `gltf-transform` ile `dedup + prune + weld + meshopt` → `apps/client/public/models/`.
- **Bütçe:** gemi başına ≤ 40 KB, toplam model ≤ 400 KB. Toplam ilk yükleme ≤ 2.5 MB (JS dahil).
- **`AssetProvider` soyutlaması:** `modelKey` → GLB yoksa **procedural placeholder** (kutu birleşimleri). Böylece oyun, nihai modeller gelmeden oynanabilir. Nihai gemi modelleri Faz 7'de ya da sanatçıdan gelince eklenir.
- **Model manifesti (`apps/client/src/render/modelSpecs.ts`):** her GLB için gövde düğümü, baş yönü, uzunluk, su çizgisi ve nişanı takip edecek taret düğümleri veri olarak tanımlanır. Yükleyici modeli normalize eder (baş +x, uzunluk, su çizgisi y=0). Taret pivotu = Blender'daki düğümün origin'i; namlunun hangi yöne baktığı (baş/kıç) mesh sınırlarından otomatik bulunur. `pnpm assets:build` ağ sıkıştırması sırasında her mesh'i alt düğüme taşır; çünkü kuantizasyon mesh taşıyan düğümün dönüşümünü değiştirir ve pivotu bozar. Doku atlası 256 px'e indirilir.
- Lisans: her asset `ASSETS.md`'ye (kaynak, lisans, yazar, URL) işlenir. CC0 ya da ticari kullanıma izin veren lisans şart.

### 12.6 UI / HUD
- **Menü:** logo, isim alanı (otomatik odak), "Oyna" tuşu, bölge/sunucu seçici (varsayılan: otomatik), ayarlar (ses, dil).
- **Can/kalkan çubukları:** kaybedilen kısım **beyaz** kalır ve erir (Dota 2 tarzı). **Her hasar kendi parçasıdır:** 0,1 sn bekler, sonra 0,9 sn'de yumuşakça erir; sürekli hasarda beyaz kısım sınırsız uzamaz, hasar hızıyla orantılı bir uzunlukta dengelenir. Hem gemi üstü çubuklarda hem oyuncu HUD'ında.
- **HUD:** kalkan ve gövde çubuğu, score/para, 5 upgrade butonu (seviye + maliyet, yetersizse soluk), "Sınıf Atla" butonu (eşik aşılınca titreşir), liderlik tablosu (top 10 + kendi sıran), **minimap** (Faz 1b'de ilk sürümü eklendi: sol altta küçük, `M` ile büyür; tüm harita, adalar türüne göre işaretli, resifler, kıyı bandı, mesafe halkaları, 500 birimlik ölçek çubuğu, kameranın gördüğü alan, oyuncu oku ve düşman noktaları. İlerideki fazlarda AOI/limanlar/sandık ışınlarıyla genişler) (2D canvas: adalar, limanlar, kendi konum, yakın gemiler (AOI), sandık ışınları, boss işareti), öldürme akışı (kill feed), duyurular (toast).
- **Ölüm ekranı:** özet + "Tekrar Oyna" (aynı isim).
- Yerelleştirme: `tr` ve `en` metin dosyaları (JSON). Kullanıcı adı: Unicode harf/rakam/boşluk/`_`/`-`, 1–16 karakter.

### 12.7 Ses
- Web Audio, küçük ogg/mp3 dosyaları (toplam ≤ 300 KB), **oyun başladıktan sonra tembel yüklenir**. Tarayıcının otomatik oynatma kuralı gereği ses bağlamı ilk tıklamada açılır.
- Sesler: top, isabet, batma, sandık toplama, upgrade, sınıf atlama, su ambiyansı, UI tıkları. Mesafeyle ses azaltma basit gain.

### 12.8 Girdi
- Klavye + fare: pointer lock gerekmez. Nişan, ekran koordinatından zemin düzlemine ışın ile hesaplanır, `u16 aim` (açı) ve `u8 aimDist` (uzaklık) olarak gönderilir. Gövdeye yayılmış topların mermileri imleç noktasında **kesişir** (paralel gitmez); `aimDist` en az `MOUNT_CONVERGE_MIN` alınır.
- Sekme görünmezse girdi gönderimi `setInterval` ile devam eder (AFK kuralı geçerli).

---

## 13. Güvenlik ve kötüye kullanım

Tarayıcı oyunlarında hile tamamen önlenemez (ör. aimbot). Hedef: **sunucu yetkili olduğu için hız/ışınlanma/hasar hileleri imkânsız**, kötüye kullanım ucuz ve sınırlı kalsın.

| Konu | Önlem |
|---|---|
| Girdi doğrulama | `moveX/moveY ∈ [-127,127]`, `aim` u16, `seq` u16 sarmalı monoton, `UPGRADE/TIER_UP` sunucuda doğrulanır (para, cap, eşik). İstemcinin gönderdiği hiçbir değer güvenilmez |
| Mesaj hızı | Bağlantı başına token bucket: ≤ 40 mesaj/sn, aşan mesajlar düşer, tekrarlanırsa bağlantı kesilir |
| Paket ayrıştırma | Sınır kontrollü okuyucu. Hatalı/kısa/uzun mesaj hata sayar, asla throw/loop etmez. **Fuzz testi** (rastgele bayt) |
| İsim | NFC normalize, izinli karakter seti (`\p{L}\p{N} _-`), 1–16 karakter, çoklu boşluk daralt, TR+EN küfür/taklit kara listesi ("admin", "moderator"), kontrol karakterleri yasak |
| Chat | Serbest chat yok, sadece emote |
| Bağlantı | `Origin` izin listesi, IP başına ≤ 4 bağlantı, `HELLO` protokol sürümü eşleşmeli |
| DoS | Küçük `maxPayload`, geri basınç kesmesi, kimlik doğrulamasız bağlantı 5 sn içinde `HELLO` göndermezse kapanır |
| Taşıma | TLS (wss) Caddy'de sonlanır, HSTS |
| Anti-farm | Aynı IP katil–kurban ödülü yok, tekrar eden öldürmede azalan ödül (§6.4) |
| Combat-log | Bağlantı koparsa savaştaki gemi 10 sn kalır (§3) |
| Bağımlılıklar | Lockfile + `pnpm audit` CI'da, sürümler sabit |
| Gizlilik | v1'de hesap yok, yalnızca isim ve geçici oyun verisi. Reklam/analitik eklenirse çerez/KVKK-GDPR bildirimi şart |

---

## 14. Test stratejisi ve kalite kapıları

| Katman | Araç | Kapsam |
|---|---|---|
| Birim | vitest | açı/vektör matematiği, `stepShip`, mount ateş kuralı, hasar/kalkan/rejen, ekonomi formülleri, kuantizasyon, spatial grid |
| Özellik tabanlı | fast-check | **codec round-trip** (encode→decode eşitliği), kuantizasyon hata sınırı, rastgele bayt fuzz (hiç throw yok) |
| Determinizm | vitest | (a) seed → ada geometrisinin **hash'i sabit** (sunucu/istemci aynı), (b) aynı girdi dizisiyle `stepShip` iki ortamda birebir aynı sonuç |
| Vuruş testi | vitest | swept segment–daire: yüksek hızda tünelleme regresyonu |
| Entegrasyon | vitest + gerçek `ws` | Sunucuyu rastgele portta başlat, başsız istemciler bağlan, hareket et, ateş et, öl, tekrar doğ, snapshot'ları doğrula |
| Yük | `tools/loadtest` | N sahte istemci (gerçek protokol, basit hareket/ateş). Çıktı: tick p50/p99, `tickBusyEma`, bant genişliği/oyuncu |
| Ağ koşulları | `tools/netem` | WS proxy: sabit gecikme + jitter + ara sıra 200–500 ms takılma (TCP kaybı benzetimi). İstemcide `?netem=` debug bayrağı da olabilir |
| Denge | `tools/balance-sim` | Basit "oyuncu botu" ile T2–T5 süre hedeflerini doğrular (§3) |
| E2E | Playwright | Sayfa yüklenir, isim girilir, "Oyna" tıklanır, canvas çizilir, konsol hatası yok, bir snapshot alınır |
| Mikro-benchmark | `vitest bench` | 2000 mermi tick'i, 50 oyuncu snapshot serileştirme (allocation yok, süre bütçesi) |

**Kalite kapıları (CI'da zorunlu):** `tsc --noEmit`, ESLint (sıcak yol kuralları dahil), tüm testler, istemci build'i ve **bundle boyutu denetimi** (JS gz bütçesi aşılırsa uyarı/başarısızlık).

**Debug yardımcıları (geliştirmede `?debug=1`):** FPS, ping, tick/snapshot hızı, bayt/sn, varlık sayısı, prediction hata miktarı, AOI sınırı, çarpışma şekilleri.

---

## 15. Dağıtım ve maliyet (minimum maliyet)

**Mimari**
- **İstemci:** Cloudflare Pages (ücretsiz katman) ya da benzeri statik host. Dosyalar hash'li ve `immutable` önbellekli, `index.html` önbelleksiz, brotli.
- **Oyun sunucusu:** bölge başına bir VPS. Docker Compose: `caddy` (TLS + reverse proxy) + `room-1..N` (aynı imaj, farklı `ROOM_ID`/`PORT`).
- **Yönlendirme:** `wss://eu.example.com/r/1/ws` → `room-1:9001`. `https://eu.example.com/r/1/status` → oda durumu.
- **Bölge dizini:** istemciyle birlikte gelen statik `regions.json` (`[{id, name, rooms:[{url, statusUrl}]}]`). İstemci açılışta `/status` uçlarını paralel çağırır (2 sn zaman aşımı), RTT'yi ölçer, kapasitesi olan en düşük gecikmeli odayı seçer. Kullanıcı elle değiştirebilir.
- **İlk bölge:** EU (kullanıcı konumuna yakın). Kitle oluşunca NA/Asya bölgeleri eklenir.

**Tahmini maliyet (yaklaşık, güncel fiyatları doğrula):** statik host ücretsiz, bir EU VPS ≈ birkaç dolar/ay, alan adı ≈ yıllık 10–15 $. Starblast AMA'sına göre ucuz bir VPS'te 100+ oyuncu mümkün (kodun optimize edilmesi şartıyla); bizim hedefimiz çekirdek başına ≥ 50 oyuncu + 30 korsan.

**Dağıtım süreci**
- GitHub Actions: `main`'e merge → imaj build → registry → VPS'te `docker compose pull && up -d` (odalar sırayla yeniden başlar, `SIGTERM` temiz kapanış).
- **İzleme:** UptimeRobot benzeri dış ping `/status`'a. `/metrics` yerel. İstemci hata takibi (Sentry ücretsiz katman) opsiyonel.
- **Yedek:** Durum bellekte olduğu için yedeklenecek veri yok (v1). Config ve imajlar repoda.

---

## 16. Performans bütçeleri (ölçülebilir hedefler)

| Alan | Bütçe | Nasıl ölçülür |
|---|---|---|
| İlk yükleme | ≤ 2.5 MB toplam, JS ≤ ~350 KB gz | build raporu, Lighthouse |
| "Oyna"ya hazır süre | ≤ 3 sn (4G, orta cihaz) | manuel + Lighthouse |
| İstemci kare hızı | orta seviye masaüstü ≥ 60 fps (50 oyuncu sahnede) | debug HUD |
| Çizim çağrısı / üçgen | ≤ 120 / ≤ 150k | `renderer.info` |
| Sunucu tick (50 oyuncu + 30 korsan + 1000 mermi) | p99 ≤ 8 ms (bütçe 50 ms), `tickBusyEma` < 0.65 | `/metrics`, loadtest |
| Sunucu bellek | ≤ 200 MB/oda | `/metrics` |
| Bant genişliği | ort. ≤ 4 KB/s aşağı, ≤ 1 KB/s yukarı (oyuncu başına) | loadtest |
| GC | Sıcak yolda allocation yok, tick süresinde GC sıçraması yok | `--trace-gc`, benchmark |
| Giriş gecikmesi | yerel girdi → ekranda tepki ≤ 1 kare (prediction) | manuel |

---

## 17. Yol haritası (fazlar, görevler, kabul kriterleri)

Her fazın sonunda oynanabilir ve test edilebilir bir şey vardır. **Fazı bitirmeden sonrakine geçme.** Kabul kriterleri (KK) geçmeden faz bitmiş sayılmaz.

### Faz 0: Altyapı
**Görevler:** pnpm monorepo iskeleti, TS strict, ESLint/Prettier, vitest, Vite istemci kabuğu, `tsx` ile sunucu kabuğu, GitHub Actions CI, `CLAUDE.md` + `GAME_DESIGN.md` repoya, `shared/config` taslakları (Ek A), `ASSETS.md` şablonu, sıcak yol ESLint kuralları.
**KK:** `pnpm dev` hem sunucuyu hem istemciyi başlatır · `pnpm test`, `pnpm lint`, `pnpm typecheck` geçer · CI yeşil.

### Faz 1: Çevrimdışı tek kişilik dilim (ağ yok)
Faz 1 iki alt faza bölünür. Alt fazı bitirmeden diğerine geçilmez.

#### Faz 1a: Oynanabilir çekirdek
**Görevler:** renderer + kamera + su plane'i, placeholder gemi (`AssetProvider` ile), WASD hareket (`shared/sim.stepShip`), fare nişanı + dönen top, T1 güverte topu + mermiler (yerel simüle, `InstancedMesh`), swept vuruş + hasar (kalkan→gövde), **hareketsiz hedef gemi** (batınca 3 sn sonra yeniden doğar), sabit adımlı istemci simülasyonu + render enterpolasyonu, debug HUD (`?debug=1`).
**KK:** WASD + fare nişanı + tık ile ateş çalışır, mermi hedefi vurur, hedef batar ve yeniden doğar · 60 fps masaüstü, ≤ 120 draw call · `stepShip`, mermi/vuruş (tünelleme dahil) ve hasar birim testleri geçer · konsol hatası yok.

#### Faz 1b: Adalar ve performans
**Görevler:** seed'den ada üretimi (shared) + çizim + gemi–ada çarpışması, harita sınırı yumuşak duvarı, harita hash testi, masaüstü fps ölçümü.
**KK:** harita hash testi geçer · masaüstünde ≥ 60 fps (ölçüm notu `docs/perf.md`'ye) · gemi–ada çarpışması testleri geçer.
**Durum:** kod ve testler tamam; oynanış hissi (ada kayması, sınır, kıyı görünümü) kullanıcı testi bekliyor. Ölçüm: `docs/perf.md`.

### Faz 2: Yetkili sunucu + ağ çekirdeği
**Görevler:** `Transport` (ws), codec + testler (round-trip, fuzz), `HELLO/WELCOME/PLAY/JOINED/INPUT/SNAPSHOT/EVENTS/MATCH/PING/PONG`, tick döngüsü, sunucuda `stepShip` + ada/gemi çarpışmaları, **tam** varlık listesi gönderimi (ENTER/UPDATE/LEAVE biçiminde, ama herkes herkesi görür; AOI Faz 6), istemci prediction + reconciliation + interpolasyon + saat senkronu, **takımlar + uçak gemileri + otomatik savunma + maç döngüsü (§4.5)**, **olay tabanlı mermiler** (`PROJECTILE_SPAWN/END`), swept vuruş, kalkan/gövde, batma ve otomatik yeniden doğuş (Faz 3'ten öne çekildi), isim + Oyna menüsü (geçici sınıf seçimi), `tools/netem`, debug HUD'ye ağ metrikleri. Çevrimdışı sandbox `?offline=1` ile kalır.
**Durum:** yapıldı; `tools`: `pnpm bot` (basit rakip bot), `pnpm netem` (kötü ağ), `pnpm bench` (sunucu tick süresi: 20 oyuncu ateş ederken ortalama 0,15 ms, p99 0,3 ms). Netem altında (RTT ≈ 190 ms + takılmalar) tahmin hatası çoğu saniye 0, nadiren 0,5–0,7 birim, çizilen gemide görünür sıçrama yok.
**KK:** iki tarayıcı birbirini görür, birbirine ateş edebilir, düşman uçak gemisini batırınca tur biter ve yeniden başlar · 150 ms ± 30 ms jitter + ara sıra 300 ms takılmada kendi gemi akıcı, kalıcı geri sıçrama yok · reconciliation hatası debug HUD'de görünür ve çoğunlukla < 0.05 birim · mermi bant genişliği mermi sayısıyla artmaz · entegrasyon testi (bağlan, hareket et, ateş et, öl, yeniden doğ, uçak gemisini batır) geçer.

### Faz 3: Savaş
**Görevler:** (olay tabanlı mermiler, swept vuruş, kalkan/gövde, batma, yeniden doğuş Faz 2'de yapıldı) kalan: rejen, ganimet saçılması, öldürme akışı, spawn koruması, combat-log koruması, silah/denge ayarı.
**Durum (ilk sürüm):** yapıldı, ganimet hariç (para ekonomisiyle Faz 4'e kaldı; kararla). Kalkan yenilenmesi (gemi ve uçak gemisi), spawn koruması (ilk atışta biter), combat-log (savaşta kopan oyuncu 10 sn kontrolsüz kalır, öldürülürse katile sayılır), `KILL`/`SCORES` mesajları (`PROTOCOL_VERSION` = 2), kill feed (sol üst), gemi üstü isim etiketi, `Tab` ile skor tablosu (tur arasında kendiliğinden açık), `pnpm balance-sim` (sınıf çiftleri ve uçak gemisi için batırma süreleri tablosu; ekonomi kısmı Faz 4'te eklenir).
**KK:** iki oyuncu birbirini batırabilir · tünelleme testi geçer · mermi bant genişliği mermi sayısıyla artmaz (ölç) · ölüm/yeniden doğuş döngüsü entegrasyon testinde.

### Faz 4: Ekonomi ve ilerleme
**Görevler:** sandık/varil/hazine sandığı spawner'ı (bölge çarpanları), `gain()` (score+cash), 5 stat + maliyet/cap, T1–T5 linear sınıflar + "Sınıf Atla" akışı, `STATS` mesajı, upgrade paneli, liderlik tablosu, öldürme ödülü formülleri (assist, tierDiff, repeat), `tools/balance-sim`.
**KK:** ekonomi birim testleri · `balance-sim` zaman hedeflerini (§3) ±%30 içinde verir · T1→T5 oynanabilir · liderlik tablosu doğru.

### Faz 5: Korsanlar, kaleler, limanlar, tüccar
**Görevler:** korsan FSM + engel kaçınma, korsan tipleri (skiff/raider/corsair), spawner + `FILL_BOTS=false`, limanlar (güvenli bölge mantığı), kale topları + çekirdek, tüccar gemisi + rota, hazine adası kazısı, flagship boss + duyuru (`NOTICE`), (P2) mayınlar ve şamandıralar.
**KK:** korsanlar oyuncuya karşı makul davranır (kaçma/orbit/ateş) · portta silah çalışmaz, bağışıklık bütçesi doğru · AI maliyeti tick bütçesinde (ölç).

### Faz 6: Ölçeklenme (AOI, bant genişliği, GC, yük testi)
**Görevler:** uzamsal grid + **AOI farkı** (`ENTER/UPDATE/LEAVE`), gönderim önceliği, struct-of-arrays mermi/toplanabilir, nesne havuzları, gönderim tamponu yeniden kullanımı, yük kapısı (`tickBusyEma`), `/status` ve `/metrics`, `tools/loadtest`, `node --inspect` ile profil, bütçe doğrulaması (§16).
**KK:** 50 bot + 30 korsan + yoğun savaşta tick p99 ≤ 8 ms · oyuncu başına ≤ 4 KB/s · sıcak yolda allocation yok (benchmark) · 65% kapısı çalışıyor.

### Faz 7: Juice, görsel kalite, ses
**Görevler:** nihai low-poly modeller (GLB hattı) ya da iyileştirilmiş placeholder'lar, su shader'ı + kıç izi + baş dalgası, top dumanı/isabet/patlama efektleri, kamera sarsıntısı, yalpa/yatma, batma animasyonu, banknot patlaması, minimap, ses, yerelleştirme (tr/en).
**KK:** masaüstünde ≥ 60 fps · ilk yükleme ≤ 2.5 MB · iki dilde arayüz.

### Faz 8: Sağlamlaştırma
**Görevler:** rate limit + token bucket, isim doğrulama/kara liste, `Origin` kontrolü, IP bağlantı sınırı, AFK kicker, fuzz testleri, hata durumları (bağlantı kopması mesajı, yeniden bağlanma akışı), `SIGTERM` temiz kapanış, Playwright E2E smoke, bağımlılık denetimi.
**KK:** fuzz testi 1M rastgele mesajda sunucu çökmez · saldırgan senaryo testleri (mesaj sel, büyük paket) bağlantıyı keser, oda etkilenmez.

### Faz 9: Yayına alma
**Görevler:** Dockerfile + compose + Caddyfile, Cloudflare Pages dağıtımı, `regions.json` + sunucu seçici, GitHub Actions dağıtım hattı, izleme, alan adı + TLS, gizlilik/çerez metni (gerekiyorsa), basit landing meta etiketleri/OG görseli, küçük kapalı beta.
**KK:** gerçek alan adında `wss` ile 10+ kişi oynayabilir · deploy tek komut · `/status` izleniyor.

### Faz 10: Sonrası (backlog)
Sınıf dallanması (T4+), Kraken/fırtına olayları, fener ele geçirme, kalıcı liderlik (SQLite), kozmetik skin'ler, doldurma botları, portal SDK'ları (CrazyGames/Poki vb.), analitik, ek bölgeler, Electron ile Steam, WebTransport.

---

## 18. Riskler ve önlemler

| Risk | Etki | Önlem |
|---|---|---|
| Oyuncu bulma/tutma (io oyunlarının asıl zorluğu) | Yüksek | Faz 9'dan önce dağıtım planı: io oyun dizinleri, YouTuber/yayıncı, portal siteleri. Oyun çekirdeği hızlı eğlence versin |
| Boş sunucu hissi | Yüksek | Korsan botlar + tüccar + olaylar. Gerekirse doldurma botları |
| TCP head-of-line takılması | Orta | `netem` testi, interpolasyon tamponu, ileride WebTransport |
| Node tek iş parçacığı CPU sınırı | Orta | Oda başına süreç, `tickBusyEma` kapısı, sıfır-alloc |
| GLB asset boyutu / yükleme süresi | Orta | Meshopt, bütçe, procedural ada, placeholder → nihai |
| Denge/his ayarı | Orta | Config tabanlı sayılar, `balance-sim`, sık oyun testi (insan işi) |
| Hile (aimbot, çoklu hesap) | Orta | Sunucu yetkili, anti-farm, rate limit. Aimbot tamamen önlenemez, kabul edilir |
| "Starblast klonu" algısı/telif | Orta | Kendi isim, kendi asset'ler, farklı mekanik detay (deniz, mount, ada, tüccar) |
| three.js sürüm değişimi | Düşük | Sürüm sabit, yükseltme ayrı görev |
| Tek geliştirici + AI iş yükü | Orta | Faz kapıları, küçük commit'ler, her fazda oynanabilir sürüm |

---

## 19. Açık sorular ve varsayımlar

Aşağıdakiler için **varsayım yapıldı**. Değişiklik gerekirse kullanıcıya sor.

1. **Oyun adı/marka:** "Tidebreaker.io" yer tutucu. Marka/alan adı kontrolü yapılmadı.
2. **Mod:** v1 tek mod, **iki takımlı uçak gemisi savaşı** (§4.5). FFA ve ilerleme/ekonomi sistemleri takım moduna göre yeniden değerlendirilecek.
3. **Gemi teması:** stilize "karma modern" (sahil güvenlik botundan fırkateyne). Korsanlar sandal/tekne/brik karışımı. Dönem netleşirse modeller buna göre.
4. **Hesap/kalıcılık:** v1'de yok. Sadece isim.
5. **Kontroller:** klavye + fare (W gaz, S fren, A/D dümen). Mobil desteklenmez.
6. **Oda kapasitesi:** 50 oyuncu + 10–40 korsan. Harita 1100×1100 (kalabalık yoğunluğu için ileride yeniden ölçülecek).
7. **Doldurma botları:** kapalı.
8. **Para kazanma:** v1'de yok. Reklam/portal SDK sonra. (Faz 10)
9. **Bölge:** ilk sunucu EU.
10. **Asset kaynağı:** CC0/ticari uygun hazır paketler ya da özel model, karar bekliyor. Başlangıçta procedural placeholder.
11. **Ses/müzik kaynağı:** karar bekliyor.
12. **Alan adı ve hosting sağlayıcısı:** karar bekliyor.

---

## 20. v1 dışı (kapsam dışı)

Hesap sistemi, satın alma, serbest chat, rüzgâr/yelken fiziği, sınıf dallanması, Kraken/fırtına olayları, fener ele geçirme, kalıcı liderlik, kozmetikler, doldurma botları, WebTransport, Steam/Electron, çoklu harita.

---

## Ek A: Başlangıç config sabitleri (`packages/shared/src/config/`)

Aşağıdakiler başlangıç noktasıdır. Dosya yapısı ve alan adları sabit kalsın, değerler dengeleme ile değişir.

```ts
// net.ts
export const PROTOCOL_VERSION = 1;
export const TICK_RATE = 20;
export const SNAPSHOT_EVERY = 2;
export const INTERP_DELAY_MS = 150;
export const EXTRAPOLATE_MAX_MS = 250;
export const AOI_RADIUS = 150;
export const GRID_CELL = 64;
export const POS_QUANT = 16;              // u16 = round(x * 16)
export const MAX_PLAYERS_DEFAULT = 50;
export const MAX_PROJECTILES = 2048;
export const MAX_PICKUPS = 512;
export const TICK_BUSY_GATE = 0.65;

// world.ts
export const WORLD_SIZE = 1100;
export const ZONES = { innerRadius: 200, midRadius: 375, mult: { outer: 1.0, mid: 1.5, inner: 2.5 } };
export const ISLANDS = { total: 14, ports: 3, forts: 3, treasure: 3, plain: 5, reefClusters: 25 };
export const PORT = { safeRadius: 70, immunitySec: 12, immunityResetSec: 30, regenMult: 4 };

// economy.ts
export const TIER_SCORE = [0, 200, 800, 2400, 6000] as const;
export const STAT_CAP_BY_TIER = [3, 4, 5, 7, 8] as const;
export const STAT_COST_BASE = 12;
export const STAT_COST_GROWTH = 1.4;
export const statCost = (level: number) => Math.ceil(STAT_COST_BASE * Math.pow(STAT_COST_GROWTH, level));
export const STAT_EFFECT = {            // per level
  speed: 0.04, reload: 0.04, turn: 0.05, shield: 0.12, regenPctMaxHullPerSec: 0.004,
} as const;
export const KILL = { victimScorePct: 0.35, cap: 1500, wreckPct: 0.25, wreckMaxBanknotes: 25, banknoteMin: 5,
                      wreckDecaySec: 40, leaderBountyPct: 0.2, assistWindowSec: 10, repeatWindowSec: 300 };
export const COMBAT = { shieldDelaySec: 4, shieldRechargeSec: 6, hullRegenDelaySec: 6, spawnProtectSec: 4 };

// pickups.ts
export const PICKUPS = {
  crate:  { cash: 8,   target: 140, respawnSec: 25 },
  barrel: { cash: 4,   target: 60,  respawnSec: 25, repairChance: 0.25, repairPct: 0.15 },
  chest:  { cash: 100, target: 8,   respawnSec: 90 },
};

// pirates.ts  (hull, speed, reward, detectRadius, tier)
export const PIRATES = {
  skiff:    { tier: 1, hull: 40,  speed: 15,  reward: 18,  detect: 55 },
  raider:   { tier: 2, hull: 130, speed: 12.5, reward: 45, detect: 60 },
  corsair:  { tier: 3, hull: 380, speed: 11,  reward: 140, detect: 70 },
  flagship: { tier: 5, hull: 1600, shield: 400, speed: 9.5, reward: 600, detect: 90, spawnEverySec: 360 },
  merchant: { tier: 3, hull: 700, speed: 7,   reward: 350, spawnEverySec: 240 },
};
export const PIRATE_TARGET = { base: 10, perPlayer: 0.5, min: 10, max: 40 };
```

## Ek B: Sözlük
- **AOI (Area of Interest):** oyuncuya gönderilecek çevre alanı.
- **Reconciliation:** istemcinin tahminini sunucu durumuyla uzlaştırması.
- **Interpolasyon:** başka varlıkları geçmiş iki durum arasında yumuşak göstermek.
- **Mount:** gemideki top yuvası (konum, yön, yay, silah).
- **Tick:** sunucu simülasyonunun sabit adımı (varsayılan 50 ms).
- **SoA:** struct-of-arrays; çok sayıda nesneyi typed array'lerde tutma.
- **EMA:** üstel hareketli ortalama.

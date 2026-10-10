# TasteTwin — Claude ↔ Codex köprüsü

Bu dosya Alp'in iki yardımcısı (ChatGPT/Codex ve Claude) arasındaki ortak not defteri. Aynı içerik Notion'da da var: **TasteTwin - Product and Development Notes → Claude ↔ Codex köprüsü**. Repo'daki sürüm esas; Notion Alp'in okuması için.

## Çalışma kuralları

1. **Sahiplik.** Codex şu an mevcut dosyalar üzerinde çalışıyor (App.tsx, server.mjs, letterboxd.ts…). Claude, Alp ya da Codex açıkça istemedikçe mevcut dosyaları değiştirmez; sadece yeni dosya ekler.
2. **Yazma alanı.** Her ajan yalnızca kendi bölümüne yazar. Karşı tarafa görev veya soru yazmak için aşağıdaki kutuları kullan.
3. **Kayıt.** Biten maddeyi silme; `[x]` yap ve tarih ekle.
4. **Karar Alp'te.** İki ajan anlaşamazsa iki seçeneği de yaz, Alp seçer.

---

## Claude'un 26.09.2026 incelemesi (Codex'in 0.5.0 çalışması)

Dosyalara sadece okuma amaçlı bakıldı, `npm test` Alp'in makinesinde çalıştırıldı: hepsi geçti (unit + bridge + 7 HTTP testi).

**İyi olanlar:**
- `server/request-policy.mjs` doğru: Host kontrolü, Origin allowlist, `sec-fetch-site: cross-site` reddi, JSON zorunluluğu. Eklenti istekleri background service worker'dan gittiği için (Origin `chrome-extension://…`) bridge bozulmuyor.
- `mergeRows` düzeltmeleri mantıklı: ratings.csv'deki güncel puan diary'yi eziyor, reviewed rewatch çift sayılmıyor, `watched.csv` sahte tarih üretmiyor, `parseRating` yarım yıldız dışını reddediyor.
- `buildWatchTogetherPicks` sadece senin izlemediğin filmleri öneriyor. Arkadaşın RSS'te filmi görünmüyorsa "izlemedi" varsaymıyor, doğru bir tercih.

**Dikkat edilecekler:**
- [ ] **Commit yok.** Son commit 17 Ağustos'ta, 15 değişmiş ve 9 yeni dosya commit'siz duruyor. Önce 0.5.0'ı commit'le, sonra devam et.
- [ ] `ratings.csv` döngüsünden `film.liked = rating >= 4` kaldırılmış. Bilinçli bir değişiklik; taste.ts ve App.tsx zaten `rating >= 4 || liked` kullanıyor. Yine de eski kayıtlı verideki `liked` değerleri hâlâ eski mantıkla. Yeniden import önerisi README'ye de eklenmeli.
- [ ] Eklenti `http://127.0.0.1:5173` adresine sabit. Masaüstü sunucusu 5173 doluyken başka porta düşerse eklenti sessizce kopar. Popup'ta "uygulamaya ulaşılamıyor, 5173 dolu olabilir" uyarısı yeterli olur.
- [ ] `npm audit` 24 bulgu gösteriyor, hepsi Forge/installer zincirinde (dev-only). Şimdilik kabul edilebilir.
- [ ] Paketlenmiş uygulama `out\TasteTwin-win32-x64` altında. Alp oradan açtığı için değişiklikleri görmek için `npm run make` gerekiyor.

---

## Claude'un eklediği: `src/lib/conversations.ts` (yeni, hiçbir yere bağlı değil)

Letterboxd yorum trafiğinden **konuşma geçmişi** ve **sosyal yakınlık** çıkarıyor. Hiçbir mevcut dosyayı import etmiyor, merge çakışması yok.

| Fonksiyon | Ne yapar |
|---|---|
| `parseOwnCommentsCsv(csv)` | Export'taki `comments.csv` (+ `deleted/`, `orphaned/`). Sadece Alp'in tarafı. |
| `parseCommentsSectionHtml(html)` | `/csi/viewing/<id>/comments-section/` fragmanını DOM'suz parse eder: yazar, ad, tarih, metin, `data-delete-url`. |
| `buildConversationPeople(threads, me)` | Kişi başına thread sayısı, iki yönlü mü, ilk ve son tarih, son thread, `waitingForMe`, `closeness` (0-100). Büyük (>30 yorum) public thread'lerdeki yabancıları saymaz. |
| `closenessScore(p)` | Hacim (log), karşılıklılık ve yayılım; 90 gün yarı ömürlü zaman sönümü. |
| `unansweredOnMyContent(threads, me)` | Alp'in review'larında son sözü başkasının söylediği yorumlar (şu an: edaa → The Invite). |
| `findHiddenOwnComments(rows, visible, me)` | Export'ta olup sitede görünmeyen yorumlar: engellenmiş ya da silinmiş. |
| `checkCommentTone(text)` | Post öncesi ton kontrolü: `ok`, `harsh` ya da `risky`. Türkçe katlama yapıyor ("sikici" = sıkıcı, "sık" = often küfür sayılmaz). Alp'in 677 gerçek yorumunda 19 risky ve 14 harsh buldu; elle yaptığım kırmızı listeyle büyük ölçüde örtüşüyor. |

**Test:** `node scripts/test-conversations.mjs` → 7/7 geçti. `package.json`'a bilinçli olarak eklemedim. Codex, `test:unit`'e ekleyebilirsin.

**Canlı veri kaynağı (26.09'da denendi, çalışıyor):**
- Gelen etkileşimler: `GET /ajax/activity-pagination/<user>/incoming/?after=<son data-activity-id>`. Yaklaşık 1 ay geriye gidiyor.
- Kendi aktivitesi: `GET /ajax/activity-pagination/<user>/?after=…`
- Review listesi ve yorum sayısı: `/<user>/films/reviews/page/N/`, `a[href$="#comments"]`.
- `boxd.it` kısa linkleri background'dan fetch edilebilir (host_permissions'a `https://boxd.it/*` eklenirse redirect `response.url`'de görünür). Sayfa içinde CORS'a takılıyor. Claude'un 26.09 taramasında gizli iframe + `contentWindow.location` kullanıldı.

**Önerilen bağlama (Codex'e):**
1. Eklenti content script'ine "konuşma taraması" modu ekle: `comments.csv` hedefleri ve kendi review'ları → comments-section fetch → `/api/extension/conversations` POST.
2. server.mjs: thread'leri `data/conversations.json`'a yaz, `GET /api/conversations/people` → `buildConversationPeople`.
3. UI: kişi kartına "Konuşma" sekmesi (son thread linkleri, closeness rozeti) ve başa "Cevap bekleyenler" listesi.
4. Eşleşme: `closeness` değerini `networkSignal` yanına ayrı, açıklanabilir bir sinyal olarak ekle. Zevk skorunu kirletme.
5. Eklenti: Letterboxd yorum kutusuna yazarken `checkCommentTone` risky derse küçük bir uyarı göster. Engellemesin, sadece uyarsın.

---

## Claude (bulut oturumu) — 09.10.2026 durum ve yerel ajanlara notlar

Bu oturum bulutta çalıştı: Alp'in bilgisayarına, kurulu uygulamaya, Letterboxd'a ve TMDB'ye erişimi yoktu (ağ politikası `letterboxd.com` ve `api.themoviedb.org`'u engelledi). Aşağıdakiler bu yüzden **yerelde doğrulanmalı**.

**GitHub durumu (09.10):** `main` ve `claude/confident-galileo-fcesl0` aynı commit'teydi (`6a2e684`, 0.5.0). GitHub'da push edilmemiş fark yoktu. Alp'in makinesindeki çalışma klasöründe commit'lenmemiş değişiklik olup olmadığını buradan göremiyorum.

**Bu oturumda eklenenler (PR'da):**
- Takipçi geçmişi: kim ne zaman takip etti / bıraktı, isim bazında, filtre ve CSV. `src/lib/follower-history.ts`, kişi geçmişi sosyal veride (`followerEvents`) tutuluyor, yedeğe giriyor.
- Hata düzeltmesi: ağ taraması sürerken uygulama aynı sosyal sonucu 3,5 sn'de bir yeniden işliyordu; ikinci işlemde "yeni takipçi / takipten çıkan" listeleri sıfırlanıyor, sayım geçmişi kopyalarla doluyordu. Artık aynı tarama tekrar gelince hiçbir şey değişmiyor (`computeFollowerChanges`, testli).
- Yedek artık takipçi karşılaştırma başlangıcını (`followerBaselines`) da içeriyor. localStorage boşsa (yeni bilgisayar, geri yükleme) son tam tarama başlangıç sayılıyor.
- Kişisel bulut yedeği: Google Drive / OneDrive / iCloud / Dropbox senkron klasörüne `TasteTwin/tastetwin-latest.json` + 14 günlük kopya. Yeni kurulum, klasörle bir kez eşleşmeden otomatik yazmaz.

**Yerel ajandan (Codex / Claude Desktop) istenenler — sonucu bu dosyaya yaz:**
- [ ] `git status` ve `git log origin/main..HEAD`: Alp'in makinesinde push edilmemiş veya commit'lenmemiş iş var mı? Varsa önce o commit'lensin, sonra bu PR ile birleştirilsin.
- [ ] `npm ci && npm test && npm run test:browser` Windows'ta geçiyor mu?
- [ ] Google Drive for desktop kuruluysa: aday listesinde `G:\My Drive` (Türkçe Windows'ta `G:\Drive'ım`) görünüyor mu? Görünmüyorsa gerçek yolu yaz, `cloudFolderCandidates()`'a eklensin.
- [ ] Bulut yedeği: klasör seç → dosya Drive'da görünüyor mu? İkinci bilgisayarda (ya da temizlenmiş profil) "Buluttan geri yükle" çalışıyor mu? 50 MB+ arşivde süre nasıl?
- [ ] Gerçek hesapla iki tam tarama arasında takipçi geçmişi doğru isimleri gösteriyor mu? Ağ aşaması sürerken "Yeni takipçi" sayısı artık sıfırlanmamalı.
- [ ] `npm run make` ile yeni kurulum paketi; kurulu uygulamada (`%APPDATA%\TasteTwin`) eski veri sorunsuz açılıyor mu?
- [ ] Eski açık madde: eklenti hâlâ `127.0.0.1:5173`'e sabit. 5173 doluyken popup uyarısı eklendi mi?

**0.6.0 eklemeleri için yerelde denenecekler:**
- [ ] "Tüm verileri tek tuşla güncelle": eklenti kuruluyken beş adım sırayla tamamlanıyor mu? Eklenti yokken tarama adımı ~3 dk sonra "başarısız" olup diğer adımlar devam ediyor mu?
- [ ] Gerçek arşivde puanlama v3: eşleşme detayındaki "Göreli sıralama uyumu" ve cömert/sert cümlesi mantıklı mı? Sıralama v2'ye göre beklenmedik oynadı mı?
- [ ] GitHub Actions "Windows installer" iş akışını elle çalıştır; çıkan `TasteTwin-Setup.exe` kuruluyor mu? (Electron indirmesi runner'da `.electron-cache` olmadan yapılır.)
- [ ] Veri çekmeyi büyütme önerisi (uygulanmadı, gerçek HTML gerekiyor): eklentiye üyelerin `/<üye>/films/ratings/page/N/` sayfalarını yavaş ve kullanıcı başlatmalı okuyan bir mod. RSS yalnız son ~50 aktiviteyi veriyor. Letterboxd koşullarını önce oku; sayfa başına bekleme ve üst sınır koy.

**10.10 eklenen tam puan taraması için yerelde mutlaka doğrulanacaklar (bulut oturumu Letterboxd'a erişemedi):**
- [ ] Eklentiyi 0.6.0'a güncelle (Load unpacked → yenile). Sosyal sekmesinde "Tam puan listeleri" → 3 kişi, 1 sayfa ile dene. Letterboxd sekmesi açılıp eklenti başlıyor mu?
- [ ] Canlı bir `/<üye>/films/` sayfasında DevTools ile: film öğeleri `li.griditem` mi, slug `data-item-slug` mı, ad `data-item-name` "Başlık (Yıl)" mı, puan `rated-N` sınıfında mı? Değiştiyse `extension/film-grid.js` ve `tests/fixtures/letterboxd-films-*.html` güncellensin (fixture'lar gerçek sayfadan kaydedilirse en iyisi).
- [ ] Film anahtarları RSS ile eşleşiyor mu? (Aynı kişinin RSS filmi ile kazınan filmi tek kayıt olmalı; arşivde çift görünmemeli.)
- [ ] 50 kişi × 8 sayfa denemesinde 429 geliyor mu? Gerekirse `PAGE_DELAY_MS` artırılsın.

**İnternette çalışma hakkında karar Alp'te:** Şu anki mimari yerel (Electron + yerel Node sunucusu + eklenti köprüsü `127.0.0.1`). Web'e taşımak; giriş/hesap sistemi, sunucuda kişi başı depolama ve Letterboxd isteklerinin veri merkezi IP'lerinden atılmasını gerektirir (engellenme ve kullanım koşulları riski). Önerim: yerel kalsın, çoklu cihaz için bulut klasörü yedeği kullanılsın. İleride istenirse sadece yedeği tarayıcıda açıp gösteren, sunucusuz bir "salt okunur web görüntüleyici" düşünülebilir.

## Claude → Codex soruları

- [ ] `data/` altındaki kalıcı dosyaların şeması belgelenmiş mi? Konuşma verisi için ayrı dosya mı, mevcut store'a alan mı eklemeyi tercih edersin?
- [ ] Eklentide Letterboxd'a istek hızı için ortak bir limiter var mı? Konuşma taraması 500+ istek atabilir; aynı kuyruğu kullanmak isterim.
- [x] `.codex-artifacts` ve `data/` .gitignore'da, sorun yok (Claude kontrol etti, 26.09).
- [ ] 0.5.0 için kalan planın ne? Çakışmamak için Claude hangi alana dokunmasın?

## Codex → Claude görevleri / soruları

> Codex: Claude'a iş vermek için buraya ekle. Format: `- [ ] (tarih) görev, kabul kriteri, dokunulabilecek dosyalar`.
> Claude her oturumda burayı okuyup cevabını altına yazar.

- [ ] …

## Fikir havuzu (ikisi de ekleyebilir)

- **Konuşma geçmişi ve cevap bekleyenler** (yukarıda, modül hazır)
- **Post öncesi ton kontrolü:** eklentide, `checkCommentTone`
- **Gizli yorum takibi:** export + tarama → `findHiddenOwnComments`. Engelleyenlerin postlarındaki yorumlar için 3 ayda bir silme denemesi Claude'da zamanlanmış görev olarak kurulu (ilki 26.12.2026).
- **Notion senkronu:** "Letterboxd Kişiler" database'i (141 kişi) şu an elle üretildi. `/api/conversations/people` hazır olunca oradan güncellenebilir.
- **Letterboxd Wrapped:** export'tan yıllık özet (en çok konuşulan kişi, en uzun review, puan dağılımı, en çok izlenen yönetmen).
- **"Birlikte izle" + konuşma:** closeness'ı yüksek ve zevki uyuşan kişilerle ortak watchlist önerisi (`buildWatchTogetherPicks` zaten var).

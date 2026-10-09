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

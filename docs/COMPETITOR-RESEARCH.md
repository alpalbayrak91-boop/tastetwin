# Benzer araclar arastirmasi (9 Ekim 2026)

Amac: TasteTwin'in nerede one gectigini ve neyi baskalarindan ogrenebilecegini gormek.
Kaynaklar web aramasindan; magaza sayilari ve surumler o gunun goruntusudur.

| Arac | Ne yapiyor | TasteTwin icin ders |
|---|---|---|
| [Criticker](https://en.everybodywiki.com/Criticker) (TCI) | Iki kisinin ortak filmlerini ham puanla degil, her kisinin kendi puan dagilimindaki **yuzdelik** yeriyle karsilastirir. En az 3 ortak film ister. | **Uygulandi:** puanlama v3'e "goreli siralama uyumu" eklendi. Sert ve comert puan verenler adil karsilastiriliyor. |
| [Blend](https://hunted.space/dashboard/blend-10) (Chrome) | Iki profili birlestirip ikisinin de watchlistinde olan, izlenmemis filmleri onerir; tur, yil, IMDb filtreleri var. | TasteTwin'de "Birlikte izleyin" zaten var; tur/yil filtresi oraya da eklenebilir. |
| [Letterboxd Unfollower Toolkit / Follower Checker / Unfollower Finder](https://extensionauditor.com/scan/letterboxd-follower-checker-mgjfheebhkfijlgoeofalcbmhcehkhbj) | Seni geri takip etmeyenleri bulur. Kucuk kullanici sayilari (~100). Zaman icinde gecmis tutmuyorlar. | **TasteTwin farki:** isim bazinda takipci gecmisi, zaman araligi ve CSV. |
| Friends Average for Letterboxd | Film sayfasinda arkadaslarinin ortalama puanini gosterir. | **Uygulandi:** film arsivinde "Ag ortalamasi" sutunu, siralama ve filtre. |
| [WrappedBoxd](https://addons.mozilla.org/addon/wrappedboxd/) | Export + TMDB ile yerel istatistik: saat, ulke, yonetmen, tema, on yil, puan dagilimi. Veriyi tarayicida tutar. | Ayni yerel yaklasim. Eksik olan: yila gore "Wrapped" ozeti. Arsivde "izledigim yil" filtresi ilk adim olarak eklendi. |
| [letterboxd-stats](https://pypi.org/project/letterboxd-stats/0.1.0) ve Streamlit uygulamalari | Profil kaziyip PRO benzeri istatistik. | Sunucudan kazima Letterboxd tarafindan engellenebiliyor; TasteTwin eklentiyle kullanicinin kendi tarayicisinda calisiyor. |
| [Sam Learner letterboxd_recommendations](https://baselight.app/u/kaggle/dataset/samlearner_letterboxd_movie_ratings_data) | En aktif 4000 kullanicinin puanlariyla oneri modeli. | Buyuk veri kumesi gerektirir; TasteTwin kendi agindaki kisilerle aciklanabilir oneri yapiyor. |
| [Lekkerboxd](https://chromewebstore.google.com/detail/kilfhpgnabhobfinmljmgojmbndcpeph) | Izlenen/puanlanan filmlerden TMDB, Reddit, Taste.io sinyalleriyle oneri. | TMDB onerileri zaten kullaniliyor. |

## Siradaki fikirler (oncelik sirasiyla)

1. **Uye puan sayfalarini eklentiyle okumak** (`/<uye>/films/ratings/`): RSS yalniz son ~50 aktiviteyi veriyor; tam puan listesi eslesme dogrulugunu ciddi artirir. Letterboxd kosullari otomatik toplamayi kisitliyor; yavas, kullanici baslatmali ve sinirli olmali. Yerelde gercek HTML ile gelistirilmeli.
2. Yila gore ozet ("Wrapped"): en cok izlenen yonetmen, en uzun seri, en cok konusulan kisi.
3. "Birlikte izleyin" listesine tur/yil/TMDB puani filtresi (Blend'deki gibi).
4. Ilginc ayrisma modu: zevki benzeyip belirli filmlerde tam ters dusen kisiler.

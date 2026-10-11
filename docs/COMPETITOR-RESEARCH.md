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

## Letterboxd veri cekme: digerleri nasil yapiyor? (10 Ekim 2026)

| Kaynak | Yontem | Not |
|---|---|---|
| [letterboxdpy](https://github.com/nmcassa/letterboxdpy) | Python, profil/film sayfalarini HTML olarak ayristirir. | `user_films.py`: `/<uye>/films`, puan filtresi `/films/rated/<puan>/by/date`; ogeler `li.griditem` (React), `li.poster-container` (eski), `li.posteritem`; puan `rated-X` sinifi / 2; sayfa basina 72 film. `movies_extractor.py`: slug `data-item-slug` veya `data-film-slug`, ad `data-item-name` veya `img alt`, kimlik `data-postered-identifier` JSON `uid` veya `data-film-id`. `movie_members.py`: `/film/<slug>/members`; fans/likes/reviews sayfalari "TODO". **TasteTwin ayristiricisi bu secicilerle yazildi.** |
| [Apify crawlerbros](https://apify.com/crawlerbros/letterboxd-scraper) | Sunucudan Chrome TLS taklidiyle istek. | Letterboxd'un React arayuzu Cloudflare arkasinda; duz HTTP istemcileri engellenebiliyor. TasteTwin bu yuzden kullanicinin kendi tarayicisinda (eklenti) okuyor. |
| [Apify haketa](https://apify.com/haketa/letterboxd-scraper) | Uye son izleme/puan gecmisi. | Son ~100 aktiviteyle sinirli; tam liste icin film sayfalari gerekir. |
| Apify scrapers_lat / solidcode | Film, puan, yorum alanlari. | Resmi Letterboxd API'si davetle; herkese acik sayfalari okumak yaygin yol. |
| [Sam Learner veri kumesi](https://baselight.app/u/kaggle/dataset/samlearner_letterboxd_movie_ratings_data) | En aktif 4000 uyenin puanlarini tarayip oneri modeli kurdu. | Puanlar yarim yildiz 1-10 olarak tutuluyor; TasteTwin de ayni `rated-N` olcegini kullaniyor. |
| [Film fans sayfasi](https://letterboxd.com/film/python/fans/) | Filmi dort favorisinden biri yapan uyeler. | Dogrulanmis URL. "Bu filmi cok sevenler" icin ileride eklentiyle okunabilir. |

Yasal/kullanim notu: Letterboxd kosullari otomatik veri toplamayi kisitliyor. TasteTwin yalniz kullanicinin baslattigi, secili kisilerle sinirli, yavas (1,4 sn) ve 429'da geri cekilen bir okuma yapiyor; veriyi disari gondermiyor.

## Siradaki fikirler (oncelik sirasiyla)

1. ~~Uye puan sayfalarini eklentiyle okumak~~ **Uygulandi (10 Ekim)**; canli sayfada secicilerin dogrulanmasi bekliyor.
1b. Secilen film icin `/film/<slug>/fans/` sayfasindan "bu filmi favorisi yapanlari" okuyup kesif adayi yapmak (filmden kisi bul'un Letterboxd geneline acilmasi).
2. Yila gore ozet ("Wrapped"): en cok izlenen yonetmen, en uzun seri, en cok konusulan kisi.
3. "Birlikte izleyin" listesine tur/yil/TMDB puani filtresi (Blend'deki gibi).
4. Ilginc ayrisma modu: zevki benzeyip belirli filmlerde tam ters dusen kisiler.

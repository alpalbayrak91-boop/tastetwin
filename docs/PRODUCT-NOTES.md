# TasteTwin urun ve teknik notlari

Son guncelleme: 24 Temmuz 2026

## Calisan kisimlar

- Letterboxd export ZIP/CSV icindeki puanli arsiv ve watchlist yerel olarak tutuluyor.
- Chrome eklentisi takip, takipci ve iki halkali ag taramasini yerel TasteTwin'e gonderiyor.
- Yeni/takipten cikan hesaplar iki eksiksiz tarama arasinda bulunuyor ve zaman araligi gosteriliyor.
- Kesif adaylari takip durumu, skor, kanit, ortak sevilen, ayrismalar ve ortak ag baglantisina gore filtreleniyor.
- Aday kartinda profil resmi; detayinda ortak puanlar, film etkileri ve adaya baglayan hesaplar gorunuyor.
- Uygulama tek kopya calisiyor. Ikinci kez acilinca mevcut pencere one geliyor.
- Eklenti tek dugmeyle once takip/takipci listesini kaydediyor, sonra ikinci halka ag taramasina devam ediyor.
- Ag taramasinda takip edilenler ve takipciler tohum olarak kullaniliyor; dogrudan iliski listesindeki hesaplar kesif adayi sayilmiyor.
- Eslesmeler sayfali; filtreler sayi girisiyle calisiyor ve varsayilan durumda tum adaylari gosteriyor.
- Onerilen, zevk, nislik, baglanti kalitesi, aktiflik, ortak film ve gecerlilige gore siralama var.
- RSS'deki son gorulen film etkinliginden 30/90 gunluk aktiflik ve son etkinlik zamani hesaplanir. Bu login zamani degildir.

## Puanlama v2

Yalnizca iki kisinin de puan verdigi filmler hesaba girer. Watchlist ve puansiz izlemeler ortak film degildir.

- 0 puan fark: guclu arti.
- 0.5 ve 1 fark: arti.
- 1.5 fark: notr.
- 2 ve uzeri fark: giderek artan eksi.
- Iki kisi de 4+ verdiyse ek pozitif sinyal vardir.
- Iki kisi de 2.5 ve alti verdiyse daha kucuk pozitif sinyal vardir.
- 2/4 gibi sevme-sevmeme ayrimi, 0.5/2.5 gibi iki dusuk puandan daha agir cezalandirilir.
- 3/5 ayrimi da eksidir fakat 2/4 kadar sert degildir.
- Ayrisma orani yuksekse film basina etkiden sonra ek toplu ceza uygulanir.
- Yerel agda az gorulen veya puanlari cok bolen filmler en fazla 1.5 kat agirlik alir.
- Gosterilen skor, kanit azsa ham skoru 50'ye yaklastirir.

Nislik puani, kisinin puanlarinin ayni filmlerdeki yerel ortalamadan ne kadar saptigini olcer. Bu Letterboxd genel ortalamasi degil, yuklenen TasteTwin adaylarina dayali yerel tahmindir.

## Birlikte izleyin

Oncelik sirasi:

1. Film iki kisinin de watchlistindeyse onu oner.
2. Film senin watchlistindeyse ve aday 4+ verdiyse onu oner.
3. Metadata varsa ortak sevilen filmlerle yonetmen, tur ve ulke benzerligi en yuksek watchlist filmini oner.

Ucuncu adim su an export/RSS metadata kalitesine baglidir. Daha iyi sonuc icin TMDB entegrasyonu planlanmistir. En uygun deterministik model:

- ortak sevilen filmleri tohum olarak kullan;
- TMDB onerileri ve anahtar kelimelerini ana sinyal yap;
- yonetmen ortakligini yuksek, turu daha dusuk agirliklandir;
- oyuncu, ulke ve donemi destek sinyali olarak kullan;
- yalnizca kullanicinin Letterboxd watchlistindeki filmleri aday havuzu yap;
- sonucu nedenleriyle acikla.

TMDB entegrasyonu artik uygulamada calisan bir yerel ayar olarak bulunur. Kullanici TMDB API Read Access Token'ini girip dogrular; TasteTwin ortak sevilen ve watchlist filmlerine yonetmen, anahtar kelime, ulke, poster ve TMDB onerilerini ekler. Metadata yerel onbellekte tutulur. Token Letterboxd'a veya baska kullanicilara gonderilmez.

Bu is icin yapay zeka zorunlu degildir. AI sonucun aciklamasini yazabilir; asil siralama tekrar uretilebilir kurallarla yapilmalidir.

TMDB gelistirici API'si ticari olmayan kullanimda atifla ucretsizdir. Uygulamaya TMDB logosu ve zorunlu atif metni eklenmelidir. Kullanici kendi TMDB API Read Access Token'ini yerel ayarlara girecektir.

- https://developer.themoviedb.org/docs/getting-started
- https://developer.themoviedb.org/docs/faq
- https://developer.themoviedb.org/reference/movie-recommendations
- https://developer.themoviedb.org/reference/movie-keywords

## Sosyal ag dogruluk siniri

TasteTwin'in su an guvenilir bicimde gosterdigi ortak baglanti, "senin takip ettigin ve kesif adayina da baglanan hesap"tir. Adayin tum takipci ve takip edilen listesini ayrica taramadan tam ortak takipci/takip edilen sayisi denemez. Arayuz bu veriyi "ortak baglanti" diye adlandirir.

Baglanti kalitesi, baglayici hesabin taranan following listesinin genisligine gore agirliklanir. Daha secici bir baglayici daha guclu sinyal sayilir. Bu hesap takipci sayisi veya sosyal statu tahmini degildir.

## Bilinen eksikler ve sonraki adimlar

- Paylasim karti su an metin kopyalar; PNG indirme ve boyut secenekleri eklenmeli.
- Yerel nislik puani, yeterli film basina kullanici sayisi yoksa dusuk guvenli sayilmali.
- 10.000 kisilik ag taramasi Letterboxd hiz sinirlarina baglidir; sosyal asama ve tamamlanan ag sonucu kayitlidir fakat kaldigi yerden devam henuz yoktur.
- Halka acilmadan once uzanti izin aciklamalari, gizlilik metni, TMDB atfi ve farkli Windows kullanicisi testi tamamlanmali.

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
- Ag taramasinda yalniz takip edilenlerden gunluk rastgele bir ornek tohum olarak kullaniliyor; takipciler sosyal listede kalir fakat kesfi baslatmaz.
- Eslesmeler sayfali; filtreler sayi girisiyle calisiyor ve varsayilan durumda tum adaylari gosteriyor.
- Onerilen, zevk, nislik, baglanti kalitesi, aktiflik, ortak film ve gecerlilige gore siralama var.
- RSS'deki son gorulen film etkinliginden 30/90 gunluk aktiflik ve son etkinlik zamani hesaplanir. Bu login zamani degildir.
- Sosyal ag ekrani tek bir baglanti yonetim dizinidir. Takip edilen, takipci, karsilikli, hayran, takipten cikan ve ikinci halka kesif hesaplari film verisi olmasa da eksiksiz listelenir.
- Sosyal dizin arama, iki bagimsiz takip filtresi, kaynak ve aktiflik filtresi, aktif/pasif/baglanti/isim siralamasi ve 50/100/250 kisilik gercek sayfalama sunar.
- Eslesme ve sosyal kisi kartlarinda gercek Letterboxd profiline dogrudan gecis vardir.
- Sosyal dizin zevk, aktiflik ve ortak baglanti icin ayri minimum/maksimum filtreleri birlikte uygular.
- Takip/takipten cik kurallari pasif gun, aktiflik, zevk ve takip yonlerine gore aday kuyrugu uretir; hesabi otomatik degistirmez.
- Film paneli izleme suresi, izleme yogunlugu, puan ortalamasi ve en cok izlenen tur, yonetmen, oyuncu ve dili gosterir.
- Siradaki film araci izlenmemis watchlistten zevk uyumu, kisa sure veya rastgele moda gore secim yapar.

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

TMDB entegrasyonu artik uygulamada calisan bir yerel ayar olarak bulunur. Kullanici TMDB API Read Access Token'ini girip dogrular; TasteTwin tum izlenmis ve watchlist filmlerine sure, oyuncu, yonetmen, dil, ozet, anahtar kelime, ulke, poster ve TMDB onerilerini ekler. Metadata yerel onbellekte tutulur. Token Letterboxd'a veya baska kullanicilara gonderilmez.

Bu is icin yapay zeka zorunlu degildir. AI sonucun aciklamasini yazabilir; asil siralama tekrar uretilebilir kurallarla yapilmalidir.

TMDB gelistirici API'si ticari olmayan kullanimda atifla ucretsizdir. Uygulamaya TMDB logosu ve zorunlu atif metni eklenmelidir. Kullanici kendi TMDB API Read Access Token'ini yerel ayarlara girecektir.

Mevcut gelir getirmeyen kisisel test icin basvuruda Personal use secilebilir. Halka acik veya gelir getiren bir surumde herkesin kendi kisisel anahtarini girmesi, uygulamanin lisans durumunu kendiliginden cozmez; yayin oncesinde TMDB kosullari ve gerekirse TMDB onayi yeniden kontrol edilmelidir.

- https://developer.themoviedb.org/docs/getting-started
- https://developer.themoviedb.org/docs/faq
- https://developer.themoviedb.org/reference/movie-recommendations
- https://developer.themoviedb.org/reference/movie-keywords

## Sosyal ag dogruluk siniri

TasteTwin'in su an guvenilir bicimde gosterdigi ortak baglanti, "senin takip ettigin ve kesif adayina da baglanan hesap"tir. Adayin tum takipci ve takip edilen listesini ayrica taramadan tam ortak takipci/takip edilen sayisi denemez. Arayuz bu veriyi "ortak baglanti" diye adlandirir.

Baglanti kalitesi, baglayici hesabin taranan following listesinin genisligine gore agirliklanir. Daha secici bir baglayici daha guclu sinyal sayilir. Bu hesap takipci sayisi veya sosyal statu tahmini degildir.

Letterboxd Aralik 2025 kullanim kosullari otomatik veri toplama araclarini ve karsilikli takip toplamak icin asiri sayida hesabi takip etmeyi kisitlar. Bu nedenle TasteTwin kurallari otomatik tiklama yapmaz; aday, neden ve profil baglantisi gostererek son islemi kullaniciya birakir. Resmi yetkili API erisimi ve acik izin olmadan toplu takip otomasyonu yayinlanmamalidir.

## Bilinen eksikler ve sonraki adimlar

- Paylasim karti 0.2.0 arayuzunden kaldirildi; sosyal kisi dizini urunun tek ana calisma alani.
- Yerel nislik puani, yeterli film basina kullanici sayisi yoksa dusuk guvenli sayilmali.
- 10.000 kisilik ag taramasi Letterboxd hiz sinirlarina baglidir; sosyal asama ve tamamlanan ag sonucu kayitlidir fakat kaldigi yerden devam henuz yoktur.
- Binlerce kisinin RSS aktifligini tek seferde taramak uzun surebilir. Sosyal dizinde aktiflik verisi olmayanlar kaybolmaz; "taranmadi" olarak kalir.
- Halka acilmadan once uzanti izin aciklamalari, gizlilik metni, TMDB atfi ve farkli Windows kullanicisi testi tamamlanmali.
# 0.2.0 - Birlesik sosyal alan

- Masaustu uygulamasindaki tek tus Letterboxd profilini acar ve 0.2.0 eklentisinden otomatik tam tarama ister.
- Sosyal listeler ilk asamada kaydedilir; ikinci halka ag taramasi devam eder ve tamamlaninca ayri kayit olusur.
- Ag kesfi yalniz kullanicinin takip ettiklerini baglayici olarak kullanir. Gunluk kararli rastgele siralama ve baglayici basina 220 hesap siniri, tek bir buyuk hesabin sonucu ele gecirmesini engeller.
- Film paneli ve Sosyal disindaki ayri Zevk eslesmeleri/Paylasim karti menuleri kaldirildi. Zevk, aktiflik ve ortak baglanti verileri sosyal kisi dizinine tasindi.
- Takip, takipci, karsilikli, geri takip etmeyen, takip edilmeyen, yeni, cikan ve ag kesfi sayilari tiklanabilir filtrelerdir; tum sonuclar sayfalanir.
- RSS aktiflik taramasi eksik verisi olan butun dizini partiler halinde tarar ve her partiyi kalici olarak kaydeder.
- TMDB token dogrulama, ilerleme, zenginlestirilen film sayisi, hata ve son calisma zamani arayuzde gorunur.

# 0.3.0 - Film zekasi ve sosyal kural kuyrugu

- TMDB ayrintilari artik tam izlenmis/watchlist arsivine sure, oyuncu, yonetmen, dil, ozet ve benzer film verisi ekler.
- Film gecmisi paneli toplam sureyi tekrar izlemelerle hesaplar; veri kapsamini acikca yazar.
- En cok izlenen tur, yonetmen, oyuncu ve dil ile aylik/haftalik izleme yogunlugu gosterilir.
- Siradaki film araci sadece izlenmemis watchlist girdilerinden zevk uyumlu, kisa veya rastgele secim yapar.
- Sosyal dizinde zevk, aktiflik ve ortak baglanti icin minimum/maksimum filtreleri vardir.
- Takip et/takipten cik aday kuyrugu ayrintili kurallarla olusur; otomatik hesap islemi yapmaz.

# 0.3.1 - Duzenli film paneli ve kolay sosyal inceleme

- Film paneli Genel bakis, Istatistikler, Izleme gecmisi ve Ne izlesem olarak dort tiklanabilir bolume ayrildi.
- Veri kapsami satiri izlenmis film, tarihli diary kaydi, TMDB metadata ve sure sayilarini eksiksiz adetlerle gosterir.
- Eksik metadata, film panelinden tek dugmeyle TMDB zenginlestirmesine gonderilir.
- Sosyal takip islemleri ayri bir kural formu kullanmaz; normal sosyal arama ve tum ayrintili filtrelerin sonucunu kullanir.
- Son aktiflik icin son 30/90 gunde aktif ve 90/180/365+ gun pasif secenekleri eklendi.
- Kolay yonetim kuyrugu siradaki profili acar, atlananlari yerel oturumda isaretler ve ilk 100 adayi gosterir.
- Chrome eklentisi 0.2.1 secilen Letterboxd profilinde takip dugmesini bulur, ekrana getirir ve vurgular; son tiklamayi kullanici yapar.

# 0.3.2 - Kalici yonetim listeleri ve canli yerel kopru

- Normal sosyal filtre sonucundaki uygun hesaplar tek tusla secilebilir; tek tek secim kutulari da vardir.
- Secilen hesaplar kalici Takip edilecekler veya Takipten cikilacaklar listesine eklenir.
- Yonetim listeleri uygulama yeniden acildiginda korunur ve performans icin sayfa basina 120 yogun satir gosterir.
- Son tiklama yine kullanicidadir. TasteTwin'in vurguladigi Letterboxd dugmesine basildiginda eklenti islemi yerel uygulamaya bildirir ve sosyal sayilar yaklasik iki saniyede guncellenir.
- Canli kopru yalniz TasteTwin uzerinden acilan/vurgulanan islemleri bilir; disarida yapilan degisiklikler sonraki tam taramada bulunur.
- Film paneli kesin toplam dakikayi, son 12 aylik akisi, takvim aylarina gore toplami ve yillik dagilimi gosterir.
- Sure ve aylik dagilim export diary tarihleri ile TMDB sure kapsamina baglidir; eksik filmler veri kapsami satirinda acikca sayilir.

## Benzer urunlerden alinan dersler

- Letterboxd Pro istatistikleri saat, ulke/dil, donem, oyuncu ve yonetmen kapsaminda guclu bir referanstir.
- Toolboxd rastgele watchlist secimi, oneriler, benzer film/kullanici ve iki kisi karsilastirmasini tek arac kutusunda sunar.
- TasteTwin'in ayirt edici alani tam sosyal dizin, takip gecmisi, aktiflik ve zevk sinyallerini ayni filtrelenebilir yonetim ekraninda birlestirmektir.

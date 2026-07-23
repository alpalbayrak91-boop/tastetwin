# Chrome Web Store alanlari

## Ayrintili aciklama

TasteTwin Letterboxd Scanner, kendi Letterboxd profilinizde gorunen takip ve takipci agini kullanici istegiyle tarar ve ayni bilgisayarda calisan TasteTwin masaustu uygulamasina aktarir. Karsilikli takipleri, sizi takip etmeyenleri ve istege bagli iki halkali sosyal agi analiz etmeye yardim eder. Son basarili taramanin tarihini ve hesap sayilarini gosterir. Letterboxd sifresini veya kimlik dogrulama cerezlerini toplamaz.

## Tek amac

Kullanicinin acikca baslattigi Letterboxd takip ve takipci taramasini gerceklestirmek ve sonucu ayni bilgisayarda calisan yerel TasteTwin uygulamasina aktarmak.

## activeTab gerekcesi

Kullanici tarama dugmesine bastiginda yalnizca o anda acik olan Letterboxd profil sekmesine sosyal ag tarama komutu gondermek icin kullanilir.

## Ana makine izni gerekcesi

`https://letterboxd.com/*` izni, kullanicinin baslattigi takip ve takipci sayfalarini okumak icin kullanilir. `http://127.0.0.1:5173/*` izni, tamamlanan sonucu yalnizca ayni bilgisayarda calisan TasteTwin uygulamasina aktarmak icin kullanilir.

## storage gerekcesi

Son basarili taramanin kullanici adi, tarihi, takip/takipci sayilari ve devam eden taramanin ilerlemesi yerel olarak saklanir; popup kapanip yeniden acildiginda durum kaybolmaz.

## Uzak kod kullanimi

Uzaktan kod calistirilmaz. Tum JavaScript dosyalari uzanti paketinin icindedir. Ag istekleri yalnizca Letterboxd sayfalarini okumak ve JSON sonucunu yerel TasteTwin uygulamasina aktarmak icindir.

## Veri kullanimi

- Kimligi belirleyebilecek bilgiler: Evet; Letterboxd kullanici adlari ve halka acik gorunen adlar.
- Web sitesi icerigi: Evet; takip/takipci listeleri ve halka acik profil alanlari.
- Web gecmisi: Hayir.
- Kimlik dogrulama bilgileri: Hayir.
- Konum, finans, saglik, iletisim veya reklam verisi: Hayir.
- Veriler satilmaz, reklam icin kullanilmaz ve ucuncu taraflarla paylasilmaz.

## Form secimleri

- Dil: Turkce
- Kategori: Social & Communication
- Gizlilik politikasi: https://github.com/alpalbayrak91-boop/tastetwin/blob/main/PRIVACY.md
- Ana sayfa: https://github.com/alpalbayrak91-boop/tastetwin
- Destek: https://github.com/alpalbayrak91-boop/tastetwin/issues
- Sinirli Kullanim sertifikasi: Isaretle
- Dagitim: Herkese acik, ucretsiz, tum bolgeler

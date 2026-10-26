# İade-İptal Takip

Entegra sipariş XML'inden "İade İptal" durumundaki siparişleri otomatik çeker. Her ürünü ayrı bir satır olarak tabloya ekler. Ekip, GitHub hesabıyla giriş yaptığı web sayfasından İptal/İade, Kaynak, Neden ve Not alanlarını doldurur. Kayıtlar Excel Tarihine göre günlük ve aylık olarak raporlanır.

## Nasıl çalışır?

```
Entegra XML ──(GitHub Actions, 2 saatte bir)──▶ Supabase veritabanı ◀──(GitHub ile giriş)── Web sayfası (GitHub Pages)
```

- **Otomatik çekim** (`scripts/sync.mjs`): XML'deki siparişlerden, durumu Ayarlar'da işaretli olanları (varsayılan "İade İptal") okur. Her ürün satırı **ilk görüldüğü gün** Excel Tarihiyle eklenir. Aynı satır bir daha eklenmez. Ekibin girdiği veya düzelttiği alanlara çekim hiç dokunmaz.
- **Ekip girişi:** Sadece `izinli_kullanicilar` tablosundaki GitHub kullanıcıları verileri görebilir ve değiştirebilir.
- **Kaldırılan satırlar** gerçekte silinmez, gizlenir. Böylece bir sonraki çekimde geri gelmez.
- **İpucu:** Türü seçilmemiş satırlarda, siparişin kaç gün sonra İade İptal'e düştüğü ve buna göre "İptal olabilir" ya da "İade olabilir" bilgisi görünür. Gün sınırını Ayarlar'dan değiştirebilirsiniz.

## Kurulum (bir kez, yaklaşık 30 dakika)

### 1. Supabase projesi
1. supabase.com'da **GitHub ile** hesap açın, ardından **New project** deyin. Bölge olarak `Central EU (Frankfurt)` seçin ve bir veritabanı şifresi belirleyin.
2. Sol menüden **SQL Editor > New query** açın. `supabase/schema.sql` dosyasının tamamını yapıştırıp **Run** deyin.
3. Aynı ekranda ekip üyelerini ekleyin. GitHub kullanıcı adlarını küçük harfle yazın:
   ```sql
   insert into public.izinli_kullanicilar (github_kullanici, ad) values
     ('kullanici1', 'Ad Soyad'),
     ('kullanici2', 'Ad Soyad');
   ```
4. **Project Settings > API** sayfasından üç bilgiyi not alın: `Project URL`, `anon public` anahtarı ve `service_role` anahtarı. Service_role anahtarını kimseyle paylaşmayın.

### 2. GitHub deposu
1. GitHub'da yeni bir depo açın, örneğin `iade-iptal-takip`, ve bu klasördeki dosyaları yükleyin.
   - Depo **public** olabilir. Kodda gizli bilgi yoktur, XML linki ve anahtarlar Secrets'ta durur, veriler girişle korunur.
   - Depoyu **private** yaparsanız, GitHub Pages için ücretli bir GitHub planı gerekir. Alternatif olarak `web/` klasörünü Netlify veya Cloudflare Pages'e ücretsiz yükleyebilirsiniz.
2. **Settings > Secrets and variables > Actions** sayfasında:
   - **Secrets** sekmesine şunları ekleyin: `XML_URL` (Entegra sipariş XML linki), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - **Variables** sekmesine şunları ekleyin: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
3. **Settings > Pages** sayfasında Source olarak **GitHub Actions** seçin.
4. **Actions** sekmesinde iki işi de bir kez elle çalıştırın (**Run workflow**):
   - "Uygulamayı yayınla" işi sayfa adresini verir, örneğin `https://kullanici.github.io/iade-iptal-takip/`
   - "Entegra XML senkron" işi ilk çekimi yapar

### 3. GitHub ile giriş
1. GitHub'da **Settings > Developer settings > OAuth Apps > New OAuth App** sayfasını açın:
   - Homepage URL: sayfa adresiniz
   - Authorization callback URL: `https://<proje-kodu>.supabase.co/auth/v1/callback`
2. Oluşan **Client ID** ile yeni bir **Client Secret** alın.
3. Supabase'de **Authentication > Sign In / Providers > GitHub** sayfasında GitHub'ı açın ve iki bilgiyi yapıştırın.
4. Supabase'de **Authentication > URL Configuration** sayfasında Site URL'e ve Redirect URLs listesine sayfa adresinizi yazın.

Bu kadar. Sayfayı açıp **GitHub ile giriş yap** deyin.

## Kullanıcı ekleme (e-posta + şifre)
1. Supabase: **Authentication > Users > Add user > Create new user**. E-posta ve şifre yazın, **Auto Confirm User** işaretli olsun.
2. SQL Editor'da izin verin (e-posta küçük harfle):
   ```sql
   insert into public.izinli_epostalar (eposta, ad) values ('ornek@firma.com', 'Ad Soyad');
   ```
3. Kullanıcı sayfada e-posta ve şifresiyle girer. Şifresini **Ayarlar > Şifremi değiştir** bölümünden değiştirebilir. Unutursa yeni şifreyi Supabase'de **Users** listesinden siz verirsiniz.

Kullanıcının erişimini kaldırmak için: `delete from public.izinli_epostalar where eposta = 'ornek@firma.com';`

## Günlük kullanım
- **Günlük:** Seçilen günün (Excel Tarihi) kayıtları. Sarı alanlar seçilmesi gereken bilgileri gösterir.
- **Aylık:** İptal ve İade ayrı ayrı. Günlere, pazar yerine, nedene ve kaynağa göre dağılım. Bir güne tıklayınca o günün listesi açılır.
- **Manuel satır ekle:** XML'e düşmeyen değişim, eksik, yeniden gönderim gibi kayıtlar için.
- **Excel'e aktar:** Ekrandaki listeyi eski Excel sütun düzeninizle indirir.
- **Ayarlar:** Hangi XML durumlarının alınacağı, ipucu gün sınırı, son çekimler ve açılır listeler.

## Çekim sıklığı
`.github/workflows/sync.yml` dosyasındaki işler Türkiye saatiyle 08:00–22:00 arasında 2 saatte bir çalışır. Saatleri değiştirmek için `cron` satırını düzenleyin. Cron saatleri UTC'dir, yani Türkiye saatinden 3 saat geridir.

## Yerelde deneme
```bash
npm install
XML_FILE=test/ornek.xml npm run sync:dry     # veritabanına yazmadan sonucu gösterir
```
`web/index.html` dosyası Supabase bilgisi olmadan açılırsa örnek verilerle demo modunda çalışır.

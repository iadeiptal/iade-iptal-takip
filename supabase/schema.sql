-- =====================================================================
-- İade-İptal Takip — Supabase şeması
-- Supabase panelinde: SQL Editor > New query > bu dosyanın tamamını
-- yapıştırıp "Run" deyin. Tekrar çalıştırmak güvenlidir.
-- =====================================================================

-- ---------- İzinli kullanıcılar (GitHub kullanıcı adı) ----------
create table if not exists public.izinli_kullanicilar (
  github_kullanici text primary key,          -- küçük harfle, örn: 'temelkitap'
  ad text,
  eklenme timestamptz not null default now()
);

-- Giriş yapan kişinin GitHub kullanıcı adı.
-- auth.identities GitHub'dan gelir, kullanıcı tarafından değiştirilemez.
create or replace function public.github_kullanici()
returns text language sql stable security definer set search_path = public, auth as $$
  select lower(i.identity_data->>'user_name')
  from auth.identities i
  where i.user_id = auth.uid() and i.provider = 'github'
  limit 1
$$;

create or replace function public.izinli()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.izinli_kullanicilar k
    where k.github_kullanici = public.github_kullanici()
  )
$$;

-- ---------- Kayıtlar: her satır = bir siparişin bir ürünü ----------
create table if not exists public.kayitlar (
  id              bigint generated always as identity primary key,
  satir_anahtari  text not null unique,      -- XML: siparisNo|urunKodu|sira  · manuel: manuel-<uuid>
  kaynak_tipi     text not null default 'otomatik' check (kaynak_tipi in ('otomatik','manuel')),

  -- XML'den gelen alanlar (ekip de düzeltebilir; senkron bir daha üzerine yazmaz)
  siparis_no      text not null default '',
  pazar_yeri      text,
  urun_kodu       text,
  barkod          text,
  urun_adi        text,
  adet            numeric,
  birim_fiyat     numeric,
  siparis_tarihi  date,
  xml_durum       text,
  excel_tarihi    date not null default (now() at time zone 'Europe/Istanbul')::date,

  -- Ekibin seçtiği alanlar
  tur             text,   -- İptal / İade / Değişim / Eksik / ...
  kaynak          text,
  neden           text,
  not_secim       text,
  not_metin       text,
  kargo_tutari    numeric,

  silindi         boolean not null default false,
  olusturma       timestamptz not null default now(),
  guncelleme      timestamptz not null default now(),
  guncelleyen     text
);
alter table public.kayitlar add column if not exists kargo_tutari numeric;  -- sonradan eklenen alan
create index if not exists kayitlar_excel_tarihi_idx on public.kayitlar (excel_tarihi);
create index if not exists kayitlar_siparis_no_idx on public.kayitlar (siparis_no);

create or replace function public.kayit_guncelleme_damgasi()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  new.guncelleme := now();
  new.guncelleyen := coalesce(public.github_kullanici(), 'senkron');
  return new;
end $$;
drop trigger if exists kayitlar_damga on public.kayitlar;
create trigger kayitlar_damga before insert or update on public.kayitlar
  for each row execute function public.kayit_guncelleme_damgasi();

-- ---------- Açılır listeler ----------
create table if not exists public.listeler (
  alan  text not null check (alan in ('pazar','tur','kaynak','neden','not')),
  deger text not null,
  sira  int  not null default 0,
  primary key (alan, deger)
);

-- ---------- Ayarlar ----------
create table if not exists public.ayarlar (
  anahtar text primary key,
  deger   jsonb not null
);

-- ---------- XML'de görülen durumlar ve senkron geçmişi ----------
create table if not exists public.xml_durumlar (
  durum        text primary key,
  son_adet     int not null default 0,
  son_gorulme  timestamptz not null default now()
);

create table if not exists public.senkron_log (
  id          bigint generated always as identity primary key,
  zaman       timestamptz not null default now(),
  basarili    boolean not null,
  siparis     int,
  eslesen     int,
  yeni_satir  int,
  mesaj       text
);

-- ---------- Satır düzeyi güvenlik ----------
alter table public.izinli_kullanicilar enable row level security;
alter table public.kayitlar            enable row level security;
alter table public.listeler            enable row level security;
alter table public.ayarlar             enable row level security;
alter table public.xml_durumlar        enable row level security;
alter table public.senkron_log         enable row level security;

drop policy if exists izinli_oku on public.izinli_kullanicilar;
create policy izinli_oku on public.izinli_kullanicilar for select to authenticated using (public.izinli());

drop policy if exists kayit_oku on public.kayitlar;
drop policy if exists kayit_ekle on public.kayitlar;
drop policy if exists kayit_guncelle on public.kayitlar;
create policy kayit_oku      on public.kayitlar for select to authenticated using (public.izinli());
create policy kayit_ekle     on public.kayitlar for insert to authenticated with check (public.izinli() and kaynak_tipi = 'manuel');
create policy kayit_guncelle on public.kayitlar for update to authenticated using (public.izinli()) with check (public.izinli());
-- Silme yok: arayüz "silindi = true" yapar, böylece senkron aynı satırı tekrar eklemez.

drop policy if exists liste_hepsi on public.listeler;
create policy liste_hepsi on public.listeler for all to authenticated using (public.izinli()) with check (public.izinli());

drop policy if exists ayar_oku on public.ayarlar;
drop policy if exists ayar_yaz on public.ayarlar;
create policy ayar_oku on public.ayarlar for select to authenticated using (public.izinli());
create policy ayar_yaz on public.ayarlar for all    to authenticated using (public.izinli()) with check (public.izinli());

drop policy if exists durum_oku on public.xml_durumlar;
create policy durum_oku on public.xml_durumlar for select to authenticated using (public.izinli());

drop policy if exists log_oku on public.senkron_log;
create policy log_oku on public.senkron_log for select to authenticated using (public.izinli());

grant execute on function public.izinli() to authenticated;
grant execute on function public.github_kullanici() to authenticated;

-- Canlı güncelleme (başka biri değiştirince ekranınız yenilenir)
do $$ begin
  alter publication supabase_realtime add table public.kayitlar;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ---------- Başlangıç verileri (Excel'inizdeki listeler) ----------
insert into public.listeler (alan, deger, sira) values
 ('pazar','Hepsiburada',1),('pazar','Trendyol',2),('pazar','N11',3),('pazar','Çiçeksepeti',4),
 ('pazar','İdefix',5),('pazar','Ptt Avm',6),('pazar','Koçtaş',7),('pazar','Pazarama',8),
 ('pazar','Temel Site',9),('pazar','Amazon',10),('pazar','Passo',11),
 ('tur','İptal',1),('tur','İade',2),('tur','Değişim',3),('tur','Eksik',4),('tur','Yeniden Gönderim',5),
 ('tur','Tazmin',6),('tur','Fazla Gönderim',7),('tur','Red Verildi',8),('tur','Parçalı İade',9),
 ('kaynak','Depo Personel',1),('kaynak','Entegrasyon',2),('kaynak','Kargo',3),('kaynak','Üretici Firma',4),
 ('kaynak','Müşteri',5),('kaynak','Tedarik',6),('kaynak','Muhasebe',7),('kaynak','MasaBaşı Personel',8),
 ('neden','Müşteri Vazgeçmiş',1),('neden','Stokta Olup Tedarik Edilemeyen Ürün',2),('neden','Eksik Ürün Gönderimi',3),
 ('neden','Kusurlu Ürün Gönderimi',4),('neden','Kargoda Hasar Alan Ürün',5),('neden','Üretici Firma Hatası',6),
 ('neden','Sistemsel Hatadan Dolayı Tedarik',7),('neden','Yanlış Ürün Gönderimi',8),('neden','Teslim Edilemeyen Ürün',9),
 ('neden','Personel Yanlış Fiyatlandırma ve Eşleştirme',10),('neden','Fazla Gönderim',11),('neden','Muhasebe Hatası',12),
 ('not','Entegrası Yapıldı',1),('not','Entegrası Yapılmadı Ürünü Var',2)
on conflict do nothing;

insert into public.ayarlar (anahtar, deger) values
 ('iade_durumlari', '["İade İptal"]'::jsonb),
 ('ipucu_gun', '3'::jsonb),
 ('pazaryeri_kodlari', '{"trendyol":"Trendyol","hb":"Hepsiburada","hepsiburada":"Hepsiburada","n11":"N11","ciceksepeti":"Çiçeksepeti","idefix":"İdefix","eptt":"Ptt Avm","pttavm":"Ptt Avm","koctas":"Koçtaş","pazarama":"Pazarama","amazon":"Amazon","passo":"Passo"}'::jsonb)
on conflict (anahtar) do nothing;

-- ---------- Ekip üyelerini ekleyin (GitHub kullanıcı adları, küçük harf) ----------
-- insert into public.izinli_kullanicilar (github_kullanici, ad) values
--   ('github-kullanici-adi', 'Ad Soyad');

-- =====================================================================
-- E-posta + şifre ile giriş (26.10.2026 eklendi)
-- Kurulu sistemde: sadece bu bölümü SQL Editor'da çalıştırmanız yeterli.
-- =====================================================================
create table if not exists public.izinli_epostalar (
  eposta  text primary key check (eposta = lower(eposta)),   -- küçük harfle
  ad      text,
  eklenme timestamptz not null default now()
);

-- Giriş yapan kişinin doğrulanmış e-postası (Supabase panelinden "Auto Confirm" ile açılan kullanıcılar doğrulanmış sayılır)
create or replace function public.dogrulanmis_eposta()
returns text language sql stable security definer set search_path = public, auth as $$
  select lower(u.email) from auth.users u
  where u.id = auth.uid() and u.email is not null and u.email_confirmed_at is not null
$$;

create or replace function public.izinli()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from public.izinli_kullanicilar k where k.github_kullanici = public.github_kullanici())
      or exists (select 1 from public.izinli_epostalar e where e.eposta = public.dogrulanmis_eposta())
$$;

-- Ekranda ve "son değiştiren" alanında görünen ad: GitHub kullanıcı adı ya da e-posta
create or replace function public.kullanici_etiketi()
returns text language sql stable security definer set search_path = public, auth as $$
  select coalesce(public.github_kullanici(), public.dogrulanmis_eposta(),
                  (select lower(email) from auth.users where id = auth.uid()))
$$;

create or replace function public.kayit_guncelleme_damgasi()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  new.guncelleme := now();
  new.guncelleyen := coalesce(public.kullanici_etiketi(), 'senkron');
  return new;
end $$;

alter table public.izinli_epostalar enable row level security;
drop policy if exists eposta_oku on public.izinli_epostalar;
create policy eposta_oku on public.izinli_epostalar for select to authenticated using (public.izinli());

grant execute on function public.dogrulanmis_eposta() to authenticated;
grant execute on function public.kullanici_etiketi() to authenticated;

-- ---------- E-postayla girecek kullanıcıları ekleyin (küçük harf) ----------
-- 1) Supabase: Authentication > Users > Add user > Create new user (Auto Confirm User işaretli)
-- 2) Burada izin verin:
-- insert into public.izinli_epostalar (eposta, ad) values ('ornek@firma.com', 'Ad Soyad');

-- =====================================================================
-- Entegra Excel yükleme (26.10.2026 eklendi)
-- Kurulu sistemde: sadece bu bölümü SQL Editor'da çalıştırmanız yeterli.
-- =====================================================================
alter table public.kayitlar drop constraint if exists kayitlar_kaynak_tipi_check;
alter table public.kayitlar add constraint kayitlar_kaynak_tipi_check check (kaynak_tipi in ('otomatik','manuel','excel'));
drop policy if exists kayit_ekle on public.kayitlar;
create policy kayit_ekle on public.kayitlar for insert to authenticated
  with check (public.izinli() and kaynak_tipi in ('manuel','excel'));

-- Sipariş başına tek satır: satır tutarı ayrı saklanır (27.10.2026)
alter table public.kayitlar add column if not exists tutar numeric;

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

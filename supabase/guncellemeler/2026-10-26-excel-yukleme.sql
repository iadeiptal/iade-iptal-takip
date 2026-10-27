-- =====================================================================
-- Entegra Excel yükleme (26.10.2026 eklendi)
-- Kurulu sistemde: sadece bu bölümü SQL Editor'da çalıştırmanız yeterli.
-- =====================================================================
alter table public.kayitlar drop constraint if exists kayitlar_kaynak_tipi_check;
alter table public.kayitlar add constraint kayitlar_kaynak_tipi_check check (kaynak_tipi in ('otomatik','manuel','excel'));
drop policy if exists kayit_ekle on public.kayitlar;
create policy kayit_ekle on public.kayitlar for insert to authenticated
  with check (public.izinli() and kaynak_tipi in ('manuel','excel'));

-- =====================================================================
-- Sipariş başına tek satır + doğru fiyat (27.10.2026)
-- SQL Editor'da bir kez çalıştırın, ARDINDAN "Entegra senkron" görevini çalıştırın.
-- =====================================================================

-- 1) Sipariş tutarı için yeni alan
alter table public.kayitlar add column if not exists tutar numeric;

-- 2) Otomatik gelmiş ve ekibin HİÇ bilgi girmediği satırları sil.
--    (Yanlış fiyatlı ve ürün başına ayrı satırlı eski kayıtlar.)
--    Ekibin tür, kaynak, neden, not ya da kargo girdiği satırlar ve elle eklenen satırlar KORUNUR.
--    Silinen siparişler bir sonraki çekimde tek satır ve doğru fiyatla yeniden gelir.
delete from public.kayitlar
where kaynak_tipi = 'otomatik'
  and silindi = false
  and tur is null and kaynak is null and neden is null
  and not_secim is null and coalesce(not_metin, '') = ''
  and kargo_tutari is null;

-- 3) Kontrol: kalan otomatik satır sayısı (ekibin bilgi girdiği satırlar)
select count(*) as korunan_otomatik_satir from public.kayitlar where kaynak_tipi = 'otomatik';

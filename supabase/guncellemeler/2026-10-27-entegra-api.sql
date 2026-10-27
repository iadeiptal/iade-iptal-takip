-- =====================================================================
-- Entegra API'ye geçiş (27.10.2026)
-- SQL Editor'da bir kez çalıştırın.
-- =====================================================================

-- Entegra durum kodları -> ekranda görünen ad
insert into public.ayarlar (anahtar, deger) values
  ('api_durum_kodlari', '{"9":"İade İptal","16":"Değişim Yapıldı","17":"Kısmi İade Yapıldı"}'::jsonb)
on conflict (anahtar) do update set deger = excluded.deger;

-- Tabloya alınacak durumlar (Ayarlar ekranından da değiştirilebilir)
insert into public.ayarlar (anahtar, deger) values
  ('iade_durumlari', '["İade İptal","Değişim Yapıldı","Kısmi İade Yapıldı"]'::jsonb)
on conflict (anahtar) do update set deger = excluded.deger;

-- Kaç günlük siparişlerin taranacağı (sipariş tarihine göre)
insert into public.ayarlar (anahtar, deger) values ('api_gun', '90'::jsonb)
on conflict (anahtar) do update set deger = excluded.deger;

-- Bu tarihten ÖNCE iade/iptal olmuş siparişler alınmaz (geçmişi doldurmamak için).
-- Daha eskileri de istiyorsanız tarihi değiştirin, hiç sınır istemiyorsanız bu satırı silin.
insert into public.ayarlar (anahtar, deger) values ('api_baslangic', '"2026-10-01"'::jsonb)
on conflict (anahtar) do update set deger = excluded.deger;

-- XML'den kalan eski durum listesini temizle (Ayarlar ekranı API'deki durumları gösterecek)
delete from public.xml_durumlar;

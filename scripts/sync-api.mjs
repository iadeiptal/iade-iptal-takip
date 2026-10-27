// Entegra REST API'den iade / iptal / değişim / kısmi iade siparişlerini çeker ve Supabase'e ekler.
// - Sadece seçili durum kodlarındaki siparişler istenir (API'nin status filtresi), bu yüzden hızlıdır.
// - Son API_GUN gün (varsayılan 90) içinde VERİLMİŞ siparişler taranır; geç gelen iadeler de yakalanır.
// - Sistemde zaten bulunan bir sipariş (XML, Excel ya da elle girilmiş) tekrar eklenmez.
// - Ekibin girdiği alanlara hiç dokunulmaz.
//
// Ortam: ENTEGRA_EMAIL, ENTEGRA_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, (isteğe bağlı) DRY_RUN=1

import { createClient } from "@supabase/supabase-js";
import { girisYap, tumSiparisler, istanbulGun } from "./entegra-api.mjs";

const DRY = process.env.DRY_RUN === "1";

// Entegra sipariş durum kodu -> ekranda görünen ad (Ayarlar'dan değiştirilebilir: ayarlar.api_durum_kodlari)
const VARSAYILAN_KODLAR = { "9": "İade İptal", "16": "Değişim Yapıldı", "17": "Kısmi İade Yapıldı" };
const VARSAYILAN_DURUMLAR = ["İade İptal", "Değişim Yapıldı", "Kısmi İade Yapıldı"];
const VARSAYILAN_PAZAR = {
  trendyol: "Trendyol", hb: "Hepsiburada", hepsiburada: "Hepsiburada", n11: "N11",
  ciceksepeti: "Çiçeksepeti", "çiçeksepeti": "Çiçeksepeti", idefix: "İdefix", eptt: "Ptt Avm", pttavm: "Ptt Avm",
  koctas: "Koçtaş", "koçtaş": "Koçtaş", mirakl_koctas: "Koçtaş", pazarama: "Pazarama", amazon: "Amazon", passo: "Passo",
  entegraeticaret: "Temel Site",
};

const norm = (s) => String(s ?? "").toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
const metin = (v) => (v == null ? "" : String(v).trim());
const sayi = (v) => { const s = metin(v).replace(",", "."); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };

// "2026-10-27 08:45:49" | "27/10/2026 8:45:49 AM" | "27.10.2026" -> "2026-10-27"
export function gun(v) {
  const s = metin(v); let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/))) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

export function satirlariUret(siparisler, { kodlar, pazarKodlari, bugun }) {
  const out = [];
  for (const s of siparisler) {
    const sno = metin(s.order_number) || metin(s.platform_reference_no) || metin(s.supplier_id);
    if (!sno) continue;
    const kod = metin(s.status);
    const pazarKod = norm(s.supplier);
    const pazar = pazarKodlari[pazarKod] || metin(s.supplier);
    const siparisTarihi = gun(s.datetime);
    // Excel Tarihi: siparişin son değiştiği gün (iade/iptal durumuna geçtiği gün). Yoksa bugün.
    let excelTarihi = gun(s.date_change) || bugun;
    if (siparisTarihi && excelTarihi < siparisTarihi) excelTarihi = siparisTarihi;
    if (excelTarihi > bugun) excelTarihi = bugun;
    const kalemler = Array.isArray(s.order_product) ? s.order_product : [];
    const sira = new Map();
    const ortak = {
      kaynak_tipi: "otomatik", siparis_no: sno, pazar_yeri: pazar, siparis_tarihi: siparisTarihi,
      xml_durum: kodlar[kod] || `Durum ${kod}`, excel_tarihi: excelTarihi,
      _alternatif: [metin(s.platform_reference_no), metin(s.supplier_id)].filter((x) => x && x !== sno),
    };
    for (const k of kalemler) {
      const urunKodu = metin(k.store_stock_code) || metin(k.model) || metin(k.barcode) || metin(k.product_id) || "urun";
      const n = (sira.get(urunKodu) || 0) + 1; sira.set(urunKodu, n);
      const adet = sayi(k.quantity) || 1;
      const toplam = sayi(k.total), fiyat = sayi(k.price);
      const birim = toplam && toplam > 0 ? Math.round((toplam / adet) * 100) / 100 : fiyat;
      out.push({
        ...ortak,
        satir_anahtari: `${sno}|${urunKodu}|${n}`,
        urun_kodu: urunKodu,
        barkod: metin(k.barcode) || null,
        urun_adi: metin(k.name) || metin(k.store_stock_name) || metin(k.invoice_name),
        adet, birim_fiyat: birim,
      });
    }
    if (!kalemler.length) out.push({ ...ortak, satir_anahtari: `${sno}|siparis|1`, urun_adi: "", adet: 1, birim_fiyat: sayi(s.grand_total) });
  }
  return out;
}

async function ayarOku(db, anahtar, varsayilan) {
  const { data, error } = await db.from("ayarlar").select("deger").eq("anahtar", anahtar).maybeSingle();
  if (error) throw error;
  return data?.deger ?? varsayilan;
}

async function main() {
  const bugun = istanbulGun(0);
  const db = DRY ? null : createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  let taranan = 0;
  try {
    const kodlar = db ? await ayarOku(db, "api_durum_kodlari", VARSAYILAN_KODLAR) : VARSAYILAN_KODLAR;
    const secili = new Set((db ? await ayarOku(db, "iade_durumlari", VARSAYILAN_DURUMLAR) : VARSAYILAN_DURUMLAR).map(norm));
    const gunSayisi = Number(db ? await ayarOku(db, "api_gun", 90) : 90) || 90;
    const pazarKodlari = { ...VARSAYILAN_PAZAR, ...(db ? await ayarOku(db, "pazaryeri_kodlari", {}) : {}) };
    const baslangic = istanbulGun(-gunSayisi);
    // Bu tarihten önce iade/iptal olmuş siparişler alınmaz (geçmişi doldurmamak için)
    const enErken = db ? await ayarOku(db, "api_baslangic", null) : null;

    const token = await girisYap();
    const siparisler = [];
    const sayim = [];
    for (const [kod, ad] of Object.entries(kodlar)) {
      if (!secili.has(norm(ad))) { sayim.push([ad, null]); continue; }
      const { siparisler: s } = await tumSiparisler(token, { baslangic, bitis: bugun, ekParametre: { status: kod } }, { maxSayfa: 200 });
      const dogru = s.filter((x) => metin(x.status) === kod); // filtre çalışmazsa bile yanlış durum alınmasın
      siparisler.push(...dogru);
      sayim.push([ad, dogru.length]);
    }
    taranan = siparisler.length;
    const satirlar = satirlariUret(siparisler, { kodlar, pazarKodlari, bugun })
      .filter((r) => !enErken || r.excel_tarihi >= enErken);
    console.log(`API: ${baslangic} – ${bugun} · ${sayim.map(([a, n]) => `${a}=${n ?? "seçili değil"}`).join(", ")}`);
    console.log(`Toplam ${taranan} sipariş, ${satirlar.length} ürün satırı`);

    if (DRY) { console.log(JSON.stringify(satirlar.slice(0, 5), null, 2)); return; }

    // Ayarlar ekranındaki durum listesi için
    const durumKayit = sayim.map(([durum, n]) => ({ durum, son_adet: n ?? 0, son_gorulme: new Date().toISOString() }));
    await db.from("xml_durumlar").upsert(durumKayit, { onConflict: "durum" });

    // Sistemde zaten olan siparişleri bul (sipariş no ya da pazaryeri referans no ile)
    const aranan = [...new Set(satirlar.flatMap((r) => [r.siparis_no, ...r._alternatif]))];
    const mevcut = new Set();
    for (let i = 0; i < aranan.length; i += 150) {
      const { data, error } = await db.from("kayitlar").select("siparis_no").in("siparis_no", aranan.slice(i, i + 150));
      if (error) throw error;
      data.forEach((d) => mevcut.add(d.siparis_no));
    }
    const yeni = satirlar
      .filter((r) => !mevcut.has(r.siparis_no) && !r._alternatif.some((a) => mevcut.has(a)))
      .map(({ _alternatif, ...r }) => r);
    for (let i = 0; i < yeni.length; i += 500) {
      const { error } = await db.from("kayitlar").upsert(yeni.slice(i, i + 500), { onConflict: "satir_anahtari", ignoreDuplicates: true });
      if (error) throw error;
    }
    console.log(`Yeni eklenen satır: ${yeni.length} (${new Set(yeni.map((r) => r.siparis_no)).size} sipariş)`);
    await db.from("senkron_log").insert({ basarili: true, siparis: taranan, eslesen: taranan, yeni_satir: yeni.length, mesaj: "API" });
  } catch (e) {
    console.error("Senkron hatası:", e?.message || e);
    if (db) await db.from("senkron_log").insert({ basarili: false, siparis: taranan, mesaj: ("API: " + String(e?.message || e)).slice(0, 500) });
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();

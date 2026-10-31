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

// Bir ürün satırının KDV DAHİL tutarı (adet dahil).
// Entegra API: priceIncludedTax = KDV dahil birim fiyat; price/total = KDV HARİÇ (kullanılmaz).
export function satirTutari(k, adet) {
  const kdvDahil = sayi(k.priceIncludedTax);
  if (kdvDahil != null && kdvDahil > 0) return kdvDahil * adet;
  const fiyat = sayi(k.price), kdv = sayi(k.tax);
  if (fiyat != null) return (fiyat * adet) + (kdv || 0);
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
    const ortak = {
      kaynak_tipi: "otomatik", siparis_no: sno, pazar_yeri: pazar, siparis_tarihi: siparisTarihi,
      xml_durum: kodlar[kod] || `Durum ${kod}`, excel_tarihi: excelTarihi,
      musteri_adi: [metin(s.firstname), metin(s.lastname)].filter(Boolean).join(" ") || metin(s.invoice_fullname) || metin(s.ship_fullname) || null,
      _alternatif: [metin(s.platform_reference_no), metin(s.supplier_id)].filter((x) => x && x !== sno),
    };
    const kalemler = Array.isArray(s.order_product) ? s.order_product : [];
    // Bir sipariş = bir satır. Çok ürünlü siparişlerde ürünler tek satırda birleştirilir.
    let toplamAdet = 0, toplamTutar = 0, tutarVar = false;
    const adlar = [], kodlar2 = [];
    for (const k of kalemler) {
      const adet = sayi(k.quantity) || 1;
      const ad = metin(k.name) || metin(k.store_stock_name) || metin(k.invoice_name) || "Ürün";
      adlar.push(adet > 1 ? `${ad} ×${adet}` : ad);
      const kod = metin(k.store_stock_code) || metin(k.model) || metin(k.barcode);
      if (kod) kodlar2.push(kod);
      toplamAdet += adet;
      const t = satirTutari(k, adet);
      if (t != null) { toplamTutar += t; tutarVar = true; }
    }
    const tek = kalemler.length === 1;
    // Sipariş tutarı: Entegra'daki sipariş toplamı (grand_total, KDV dahil). Yoksa ürünlerin toplamı.
    const gt = sayi(s.grand_total);
    const tutar = gt != null && gt > 0 ? gt : (tutarVar ? Math.round(toplamTutar * 100) / 100 : null);
    // Durum kuralları: Değişim -> fiyat yok; Kısmi İade -> ürün/adet/fiyat ekip tarafından girilir
    const durumAd = norm(ortak.xml_durum);
    if (durumAd.includes("kısmi")) {
      out.push({ ...ortak, satir_anahtari: `${sno}|siparis`, urun_kodu: null, barkod: null, urun_adi: "", adet: null, birim_fiyat: null, tutar: null });
      continue;
    }
    const fiyatsiz = durumAd.includes("değişim");
    out.push({
      ...ortak,
      satir_anahtari: `${sno}|siparis`,
      urun_kodu: kodlar2.join(", ") || null,
      barkod: tek ? metin(kalemler[0].barcode) || null : null,
      urun_adi: adlar.join(" + "),
      adet: toplamAdet || 1,
      birim_fiyat: fiyatsiz || !tek ? null : (sayi(kalemler[0].priceIncludedTax) ?? (tutar != null ? Math.round((tutar / (toplamAdet || 1)) * 100) / 100 : null)),
      tutar: fiyatsiz ? null : tutar,
    });
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
    // Bu tarihten önce VERİLMİŞ siparişler hiç alınmaz (ayarlar.api_baslangic, örn. "2026-10-01")
    const enErken = db ? await ayarOku(db, "api_baslangic", null) : null;
    let baslangic = istanbulGun(-gunSayisi);
    if (enErken && enErken > baslangic) baslangic = enErken;

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
      .filter((r) => !enErken || !r.siparis_tarihi || r.siparis_tarihi >= enErken);
    console.log(`API: ${baslangic} – ${bugun} · ${sayim.map(([a, n]) => `${a}=${n ?? "seçili değil"}`).join(", ")}`);
    console.log(`Toplam ${taranan} sipariş, ${satirlar.length} satır (sipariş başına bir satır)`);

    if (DRY) { console.log(JSON.stringify(satirlar.slice(0, 5), null, 2)); return; }

    // Ayarlar ekranındaki durum listesi için
    const durumKayit = sayim.map(([durum, n]) => ({ durum, son_adet: n ?? 0, son_gorulme: new Date().toISOString() }));
    await db.from("xml_durumlar").upsert(durumKayit, { onConflict: "durum" });

    // Sistemde zaten olan siparişleri bul (sipariş no ya da pazaryeri referans no ile)
    const aranan = [...new Set(satirlar.flatMap((r) => [r.siparis_no, ...r._alternatif]))];
    const mevcut = new Set(), musterisiz = new Set();
    for (let i = 0; i < aranan.length; i += 150) {
      const { data, error } = await db.from("kayitlar").select("siparis_no, musteri_adi").in("siparis_no", aranan.slice(i, i + 150));
      if (error) throw error;
      data.forEach((d) => { mevcut.add(d.siparis_no); if (!d.musteri_adi) musterisiz.add(d.siparis_no); });
    }
    const yeni = satirlar
      .filter((r) => !mevcut.has(r.siparis_no) && !r._alternatif.some((a) => mevcut.has(a)))
      .map(({ _alternatif, ...r }) => r);
    for (let i = 0; i < yeni.length; i += 500) {
      const { error } = await db.from("kayitlar").upsert(yeni.slice(i, i + 500), { onConflict: "satir_anahtari", ignoreDuplicates: true });
      if (error) throw error;
    }
    console.log(`Yeni eklenen satır: ${yeni.length} (${new Set(yeni.map((r) => r.siparis_no)).size} sipariş)`);

    // Tabloda zaten olan ama müşteri adı boş siparişlere SADECE müşteri adını yaz (başka alana dokunulmaz)
    let tamamlanan = 0;
    for (const r of satirlar) {
      if (!r.musteri_adi) continue;
      for (const no of [r.siparis_no, ...r._alternatif]) {
        if (!musterisiz.has(no)) continue;
        const { error } = await db.from("kayitlar").update({ musteri_adi: r.musteri_adi }).eq("siparis_no", no).is("musteri_adi", null);
        if (error) throw error;
        musterisiz.delete(no); tamamlanan++;
      }
    }
    if (tamamlanan) console.log(`Müşteri adı tamamlanan sipariş: ${tamamlanan}`);
    await db.from("senkron_log").insert({ basarili: true, siparis: taranan, eslesen: taranan, yeni_satir: yeni.length, mesaj: "API" });
  } catch (e) {
    console.error("Senkron hatası:", e?.message || e);
    if (db) await db.from("senkron_log").insert({ basarili: false, siparis: taranan, mesaj: ("API: " + String(e?.message || e)).slice(0, 500) });
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();

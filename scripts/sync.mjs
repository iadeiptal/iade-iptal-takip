// Entegra sipariş XML'ini okur, iade/iptal durumundaki ürün satırlarını Supabase'e ekler.
// Daha önce eklenmiş satırlara dokunmaz; ekibin girdiği alanlar korunur.
//
// Ortam değişkenleri:
//   XML_URL                   Entegra sipariş XML linki (GitHub Secret)
//   SUPABASE_URL              https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY Supabase service_role anahtarı (GitHub Secret)
//   XML_FILE                  (isteğe bağlı) URL yerine yerel dosya
//   DRY_RUN=1                 (isteğe bağlı) Veritabanına yazmadan sonucu yazdır

import { readFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";
import { createClient } from "@supabase/supabase-js";

const DRY = process.env.DRY_RUN === "1";
const VARSAYILAN_DURUMLAR = ["İade İptal"];
const VARSAYILAN_PAZAR = {
  trendyol: "Trendyol", hb: "Hepsiburada", hepsiburada: "Hepsiburada", n11: "N11",
  ciceksepeti: "Çiçeksepeti", idefix: "İdefix", eptt: "Ptt Avm", pttavm: "Ptt Avm",
  koctas: "Koçtaş", pazarama: "Pazarama", amazon: "Amazon", passo: "Passo",
};

const norm = (s) => String(s ?? "").toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
const ilk = (v) => (Array.isArray(v) ? v[0] : v);
const dizi = (v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : [v]);
const metin = (v) => { v = ilk(v); return v == null ? "" : String(v).trim(); };
const sayi = (v) => {
  const s = metin(v).replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const tarih = (v) => {
  const s = metin(v);
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/))) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
};
const bugunIstanbul = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function xmlMetni() {
  let buf;
  if (process.env.XML_FILE) {
    buf = await readFile(process.env.XML_FILE);
  } else {
    if (!process.env.XML_URL) throw new Error("XML_URL tanımlı değil");
    const res = await fetch(process.env.XML_URL, { headers: { "User-Agent": "iade-iptal-takip/1.0" } });
    if (!res.ok) throw new Error(`XML indirilemedi: HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  const bas = buf.subarray(0, 200).toString("latin1");
  const enc = (bas.match(/encoding=["']([\w-]+)["']/i)?.[1] || "utf-8").toLowerCase();
  try { return new TextDecoder(enc === "iso-8859-9" ? "windows-1254" : enc).decode(buf); }
  catch { return new TextDecoder("utf-8").decode(buf); }
}

export function siparisleriCoz(xml) {
  const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
  const doc = parser.parse(xml);
  const kok = doc.SIPARISLER ?? doc.siparisler ?? doc;
  return dizi(kok.SIPARIS ?? kok.siparis);
}

export function satirlariUret(siparisler, { durumlar, pazarKodlari, bugun }) {
  const hedef = new Set(durumlar.map(norm));
  const durumSayim = new Map();
  const satirlar = [];
  let eslesen = 0;
  for (const s of siparisler) {
    const durum = metin(s.SIPDURUM_Adi);
    durumSayim.set(durum, (durumSayim.get(durum) || 0) + 1);
    if (!hedef.has(norm(durum))) continue;
    const sno = metin(s.SIPARIS_NO);
    if (!sno) continue;
    eslesen++;
    const kod = norm(metin(s.CariHesapOzelKodu));
    const pazar = pazarKodlari[kod] || metin(s.odeme_adi) || metin(s.CariHesapOzelKodu);
    const kalemler = dizi(s.SATIRLAR?.SATIR);
    const sira = new Map();
    for (const k of kalemler) {
      const urunKodu = metin(k.URUNKODU) || metin(k.KOD) || metin(k.BARCODE) || "urun";
      const n = (sira.get(urunKodu) || 0) + 1;
      sira.set(urunKodu, n);
      satirlar.push({
        satir_anahtari: `${sno}|${urunKodu}|${n}`,
        kaynak_tipi: "otomatik",
        siparis_no: sno,
        pazar_yeri: pazar,
        urun_kodu: urunKodu,
        barkod: metin(k.BARCODE) || null,
        urun_adi: metin(k.URUNADI) || metin(k.MAGAZA_URUNADI) || metin(k.FATURA_ADI),
        adet: sayi(k.MIKTAR),
        birim_fiyat: sayi(k.FIYAT),
        siparis_tarihi: tarih(s.TARIH),
        xml_durum: durum,
        excel_tarihi: bugun,
      });
    }
    if (!kalemler.length) {
      satirlar.push({
        satir_anahtari: `${sno}|siparis|1`, kaynak_tipi: "otomatik", siparis_no: sno, pazar_yeri: pazar,
        urun_adi: "", adet: 1, birim_fiyat: sayi(s.NET_TOPLAM), siparis_tarihi: tarih(s.TARIH),
        xml_durum: durum, excel_tarihi: bugun,
      });
    }
  }
  return { satirlar, eslesen, durumSayim };
}

async function ayarOku(db, anahtar, varsayilan) {
  const { data, error } = await db.from("ayarlar").select("deger").eq("anahtar", anahtar).maybeSingle();
  if (error) throw error;
  return data?.deger ?? varsayilan;
}

async function main() {
  const bugun = bugunIstanbul();
  const db = DRY ? null : createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  let siparisSayisi = 0;
  try {
    const durumlar = db ? await ayarOku(db, "iade_durumlari", VARSAYILAN_DURUMLAR) : VARSAYILAN_DURUMLAR;
    const pazarKodlari = { ...VARSAYILAN_PAZAR, ...(db ? await ayarOku(db, "pazaryeri_kodlari", {}) : {}) };

    const siparisler = siparisleriCoz(await xmlMetni());
    siparisSayisi = siparisler.length;
    const { satirlar, eslesen, durumSayim } = satirlariUret(siparisler, { durumlar, pazarKodlari, bugun });

    console.log(`XML: ${siparisSayisi} sipariş · durumlar: ${[...durumSayim].map(([d, n]) => `${d}=${n}`).join(", ")}`);
    console.log(`Eşleşen (${durumlar.join(" / ")}): ${eslesen} sipariş, ${satirlar.length} ürün satırı`);

    if (DRY) { console.log(JSON.stringify(satirlar, null, 2)); return; }

    // Görülen durumları kaydet (Ayarlar ekranında seçilebilsin)
    const durumKayit = [...durumSayim].filter(([d]) => d).map(([durum, son_adet]) => ({ durum, son_adet, son_gorulme: new Date().toISOString() }));
    if (durumKayit.length) {
      const { error } = await db.from("xml_durumlar").upsert(durumKayit, { onConflict: "durum" });
      if (error) throw error;
    }

    // Var olan anahtarları bul, sadece yenileri ekle
    const mevcut = new Set();
    const anahtarlar = satirlar.map((r) => r.satir_anahtari);
    for (let i = 0; i < anahtarlar.length; i += 200) {
      const { data, error } = await db.from("kayitlar").select("satir_anahtari").in("satir_anahtari", anahtarlar.slice(i, i + 200));
      if (error) throw error;
      data.forEach((d) => mevcut.add(d.satir_anahtari));
    }
    const yeni = satirlar.filter((r) => !mevcut.has(r.satir_anahtari));
    for (let i = 0; i < yeni.length; i += 500) {
      const { error } = await db.from("kayitlar").upsert(yeni.slice(i, i + 500), { onConflict: "satir_anahtari", ignoreDuplicates: true });
      if (error) throw error;
    }
    console.log(`Yeni eklenen satır: ${yeni.length}`);
    await db.from("senkron_log").insert({ basarili: true, siparis: siparisSayisi, eslesen, yeni_satir: yeni.length, mesaj: null });
  } catch (e) {
    console.error("Senkron hatası:", e?.message || e);
    if (db) await db.from("senkron_log").insert({ basarili: false, siparis: siparisSayisi, mesaj: String(e?.message || e).slice(0, 500) });
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();

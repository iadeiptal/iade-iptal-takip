// Entegra API keşif (2. tur): durum kodlarını ve durum filtresinin çalışıp çalışmadığını raporlar.
// Kişisel veri (ad, adres, telefon, e-posta, TC, vergi no) YAZDIRILMAZ; depo herkese açık
// olduğu için log'lar da herkese açıktır. Sadece nadir durumlu (≤ 5) siparişlerin sipariş
// numarası ve pazaryeri yazdırılır ki hangi kodun hangi durum olduğu panelden doğrulanabilsin.
//
// Ortam: ENTEGRA_EMAIL, ENTEGRA_PASSWORD, GUN (varsayılan 60)

import { girisYap, siparisSayfasi, siparisDizisi, tumSiparisler, istanbulGun } from "./entegra-api.mjs";

const ADAY_KODLAR = ["9", "16", "17", "4", "7"];

function toplamAlani(y) {
  if (!y || typeof y !== "object" || Array.isArray(y)) return null;
  for (const [k, v] of Object.entries(y)) if (typeof v === "number") return { ad: k, deger: v };
  return null;
}

function capraz(siparisler) {
  // durum kodu -> { adet, pazaryeriDurumu: Map, urunDurumu: Map, ornekler: [] }
  const m = new Map();
  for (const s of siparisler) {
    const kod = String(s.status ?? "");
    const k = m.get(kod) || { adet: 0, pz: new Map(), ud: new Map(), tarih: [], ornek: [] };
    k.adet++;
    const pzd = s.store_order_status_name || "(boş)";
    k.pz.set(pzd, (k.pz.get(pzd) || 0) + 1);
    for (const u of s.order_product || []) { const d = String(u.status ?? ""); k.ud.set(d, (k.ud.get(d) || 0) + 1); }
    if (s.datetime) k.tarih.push(String(s.datetime).slice(0, 10));
    k.ornek.push({ no: s.order_number, pazar: s.supplier, tarih: String(s.datetime || "").slice(0, 10), urun: (s.order_product || []).length });
    m.set(kod, k);
  }
  return m;
}

function yazdir(m) {
  for (const [kod, k] of [...m].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const t = k.tarih.sort();
    console.log(`\n  status = ${kod}  ·  ${k.adet} sipariş  ·  sipariş tarihi ${t[0] || "?"} – ${t[t.length - 1] || "?"}`);
    console.log(`    pazaryerindeki durum: ${[...k.pz].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v} (${n})`).join(" | ")}`);
    console.log(`    ürün satırı durumları: ${[...k.ud].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v} (${n})`).join(" | ")}`);
    if (k.adet <= 5) for (const o of k.ornek) console.log(`    → sipariş no: ${o.no} · ${o.pazar} · ${o.tarih} · ${o.urun} ürün`);
  }
}

async function main() {
  const gun = Number(process.env.GUN || 60);
  const baslangic = istanbulGun(-gun), bitis = istanbulGun(0);
  console.log(`Entegra API keşif (2. tur) · ${baslangic} – ${bitis}`);
  const token = await girisYap();
  console.log("Giriş: başarılı");

  // 1) Durum filtresi deneniyor: ?status=KOD
  console.log("\n== 1) Durum filtresi testi ==");
  let filtreCalisiyor = true;
  for (const kod of ADAY_KODLAR) {
    const y = await siparisSayfasi(token, 1, { baslangic, bitis, ekParametre: { status: kod } });
    const dizi = siparisDizisi(y), top = toplamAlani(y);
    const gelen = new Map(); dizi.forEach((s) => { const d = String(s.status ?? ""); gelen.set(d, (gelen.get(d) || 0) + 1); });
    const tutarli = dizi.length > 0 && gelen.size === 1 && gelen.has(kod);
    if (dizi.length && !tutarli) filtreCalisiyor = false;
    console.log(`  status=${kod}: ${top ? top.ad + " = " + top.deger + ", " : ""}1. sayfada ${dizi.length} sipariş · gelen kodlar: ${[...gelen].map(([d, n]) => `${d} (${n})`).join(" | ") || "-"}${tutarli ? "  ✓" : ""}`);
  }
  console.log(filtreCalisiyor ? "  SONUÇ: durum filtresi çalışıyor." : "  SONUÇ: durum filtresi ÇALIŞMIYOR, tam tarama gerekecek.");

  // 2) Kod başına ayrıntı
  console.log("\n== 2) Durum kodlarının ayrıntısı ==");
  if (filtreCalisiyor) {
    const hepsi = [];
    for (const kod of ADAY_KODLAR) {
      const t0 = Date.now();
      const { siparisler } = await tumSiparisler(token, { baslangic, bitis, ekParametre: { status: kod } }, { maxSayfa: 100 });
      console.log(`  status=${kod}: ${siparisler.length} sipariş · ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
      hepsi.push(...siparisler);
    }
    yazdir(capraz(hepsi));
  } else {
    const { siparisler } = await tumSiparisler(token, { baslangic, bitis }, { maxSayfa: 400 });
    yazdir(capraz(siparisler));
  }
  console.log("\nKeşif bitti. Bu çıktıyı kopyalayıp gönderin.");
}

main().catch((e) => { console.error("Keşif hatası:", e.message); process.exitCode = 1; });

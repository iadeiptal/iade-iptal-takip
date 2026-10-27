// Entegra API keşif raporu: sipariş yanıtının YAPISINI ve durum değerlerini yazdırır.
// Kişisel veri (ad, adres, telefon, e-posta, TC, vergi no) YAZDIRILMAZ; depo herkese açık
// olduğu için log'lar da herkese açıktır.
//
// Ortam: ENTEGRA_EMAIL, ENTEGRA_PASSWORD, GUN (varsayılan 60)

import { girisYap, tumSiparisler, istanbulGun } from "./entegra-api.mjs";

const GIZLI = /(name|ad[i_]?$|adi|soyad|full|alici|address|adres|phone|tel|gsm|mobile|mail|posta|tc|tckn|identity|vergi|tax|iban|note|not$|aciklama|comment|postcode|zip|street|sokak|mahalle|neighborhood)/i;
const GUVENLI_DEGER = /(status|durum|state|supplier|marketplace|pazar|platform|store|magaza|channel|kanal|cargo_company|kargo_firma|payment_type|odeme|date|tarih|time|created|updated|modified|currency|quantity|miktar|adet|count)/i;

const tip = (v) => (v === null ? "null" : Array.isArray(v) ? "dizi" : typeof v);

function alanlariTopla(nesneler, onEk, hedef) {
  for (const o of nesneler) {
    if (!o || typeof o !== "object") continue;
    for (const [k, v] of Object.entries(o)) {
      const yol = onEk + k;
      const kayit = hedef.get(yol) || { tipler: new Set(), ornek: new Map() };
      kayit.tipler.add(tip(v));
      const durumGibi = /status|durum|state/i.test(k);
      if (v !== null && typeof v !== "object" && (durumGibi || (GUVENLI_DEGER.test(k) && !GIZLI.test(k)))) {
        const s = String(v).slice(0, 60);
        kayit.ornek.set(s, (kayit.ornek.get(s) || 0) + 1);
      }
      hedef.set(yol, kayit);
      if (Array.isArray(v) && v.length && typeof v[0] === "object") alanlariTopla(v, yol + "[].", hedef);
      else if (v && typeof v === "object" && !Array.isArray(v)) alanlariTopla([v], yol + ".", hedef);
    }
  }
}

async function main() {
  const gun = Number(process.env.GUN || 60);
  const baslangic = istanbulGun(-gun), bitis = istanbulGun(0);
  console.log(`Entegra API keşif · ${baslangic} – ${bitis} (${gun} gün)`);
  const token = await girisYap();
  console.log("Giriş: başarılı");

  const t0 = Date.now();
  const { siparisler, ilkYanit } = await tumSiparisler(token, { baslangic, bitis }, {
    maxSayfa: 400,
    sayfaBasi: (s, n) => { if (s === 1 || s % 10 === 0) console.log(`  sayfa ${s}: ${n} sipariş`); },
  });
  console.log(`Toplam: ${siparisler.length} sipariş · ${((Date.now() - t0) / 1000).toFixed(1)} sn`);

  console.log("\n== Yanıtın üst düzey yapısı (1. sayfa) ==");
  if (Array.isArray(ilkYanit)) console.log("Dizi");
  else for (const [k, v] of Object.entries(ilkYanit || {})) console.log(`  ${k}: ${tip(v)}${typeof v === "number" ? " = " + v : ""}`);

  const alanlar = new Map();
  alanlariTopla(siparisler, "", alanlar);
  console.log("\n== Sipariş alanları ==");
  for (const [yol, k] of alanlar) {
    const ornekler = [...k.ornek].sort((a, b) => b[1] - a[1]);
    if (/date|tarih|time|created|updated|modified/i.test(yol) && ornekler.length > 3) {
      const d = ornekler.map(([v]) => v).sort();
      console.log(`  ${yol}  [${[...k.tipler].join("/")}]  → en eski: ${d[0]} · en yeni: ${d[d.length - 1]}`);
      continue;
    }
    const goster = ornekler.length && ornekler.length <= 40
      ? "  → " + ornekler.map(([v, n]) => `${v} (${n})`).join(" | ")
      : ornekler.length ? `  → ${ornekler.length} farklı değer, örn: ${ornekler.slice(0, 3).map(([v]) => v).join(" | ")}` : "";
    console.log(`  ${yol}  [${[...k.tipler].join("/")}]${goster}`);
  }
  console.log("\nKeşif bitti. Bu çıktıyı (Sipariş alanları bölümü dahil) kopyalayıp gönderin.");
}

main().catch((e) => { console.error("Keşif hatası:", e.message); process.exitCode = 1; });

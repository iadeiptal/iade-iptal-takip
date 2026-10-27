// Entegra API keşif (3. tur): fiyat alanlarını gösterir.
// Kod 16 ve 17'deki siparişlerin (panelden kontrol edilebilsin diye) ürün fiyat alanlarını yazdırır.
// Kişisel veri yazdırılmaz.
//
// Ortam: ENTEGRA_EMAIL, ENTEGRA_PASSWORD, GUN (varsayılan 60)

import { girisYap, tumSiparisler, istanbulGun } from "./entegra-api.mjs";

const SIPARIS_ALANLARI = ["total", "grand_total", "discount", "tax", "ship_price", "total_paid_price", "coupon_price"];
const URUN_ALANLARI = ["quantity", "price", "pricex", "priceIncludedTax", "total", "tax", "tax_id", "first_price",
  "sellerdiscount", "malldiscount", "discount_rate", "sellerinvoiceamount", "dueamount", "commission", "buying_price", "packet_price"];

async function main() {
  const gun = Number(process.env.GUN || 60);
  const baslangic = istanbulGun(-gun), bitis = istanbulGun(0);
  console.log(`Entegra API keşif (3. tur: fiyat alanları) · ${baslangic} – ${bitis}`);
  const token = await girisYap();
  console.log("Giriş: başarılı");
  for (const kod of ["16", "17"]) {
    const { siparisler } = await tumSiparisler(token, { baslangic, bitis, ekParametre: { status: kod } }, { maxSayfa: 5 });
    for (const s of siparisler) {
      console.log(`\n== Sipariş no: ${s.order_number} · ${s.supplier} · durum ${s.status} ==`);
      console.log("  sipariş: " + SIPARIS_ALANLARI.map((k) => `${k}=${s[k] ?? "-"}`).join(" · "));
      (s.order_product || []).forEach((u, i) => {
        console.log(`  ürün ${i + 1}: ${String(u.name || "").slice(0, 50)}`);
        console.log("    " + URUN_ALANLARI.map((k) => `${k}=${u[k] ?? "-"}`).join(" · "));
      });
    }
  }
  console.log("\nKeşif bitti. Bu çıktıyı kopyalayıp gönderin.");
}

main().catch((e) => { console.error("Keşif hatası:", e.message); process.exitCode = 1; });

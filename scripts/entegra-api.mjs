// Entegra REST API yardımcıları (https://apiv2.entegrabilisim.com)
// Ortam değişkenleri: ENTEGRA_EMAIL, ENTEGRA_PASSWORD, (isteğe bağlı) ENTEGRA_BASE_URL

const BASE = (process.env.ENTEGRA_BASE_URL || "https://apiv2.entegrabilisim.com").replace(/\/+$/, "");

export function istanbulGun(offsetGun = 0) {
  const d = new Date(Date.now() + offsetGun * 864e5);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

async function istek(yol, { method = "GET", token, body } = {}) {
  const url = BASE + yol;
  for (let deneme = 1; deneme <= 4; deneme++) {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(token ? { Authorization: `JWT ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 || res.status >= 500) {
      if (deneme === 4) throw new Error(`Entegra API ${res.status}: ${yol}`);
      await new Promise((r) => setTimeout(r, deneme * 3000));
      continue;
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* JSON değil */ }
    if (!res.ok) {
      const msg = json ? JSON.stringify(json).slice(0, 300) : text.slice(0, 300);
      throw new Error(`Entegra API ${res.status} (${yol}): ${msg}`);
    }
    return json;
  }
}

export async function girisYap() {
  const email = process.env.ENTEGRA_EMAIL, password = process.env.ENTEGRA_PASSWORD;
  if (!email || !password) throw new Error("ENTEGRA_EMAIL / ENTEGRA_PASSWORD tanımlı değil");
  const r = await istek("/api/user/token/obtain/", { method: "POST", body: { email, password } });
  const token = r?.access || r?.access_token || r?.token || r?.data?.access;
  if (!token) throw new Error("Token alınamadı. Yanıttaki alanlar: " + Object.keys(r || {}).join(", "));
  return token;
}

// Yanıtın içindeki sipariş dizisini bulur (yapı bilinmediği için esnek)
export function siparisDizisi(yanit) {
  if (Array.isArray(yanit)) return yanit;
  if (!yanit || typeof yanit !== "object") return [];
  for (const k of ["results", "orders", "order", "data", "list", "items"]) {
    const v = yanit[k];
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") { const ic = siparisDizisi(v); if (ic.length) return ic; }
  }
  for (const v of Object.values(yanit)) if (Array.isArray(v) && v.length && typeof v[0] === "object") return v;
  return [];
}

export async function siparisSayfasi(token, sayfa, { baslangic, bitis, ekParametre = {} } = {}) {
  const q = new URLSearchParams({ ...(baslangic ? { start_date: baslangic } : {}), ...(bitis ? { end_date: bitis } : {}), ...ekParametre });
  return istek(`/order/page=${sayfa}/?${q}`, { token });
}

// Tüm sayfaları gezer; her sayfadaki siparişleri geri çağırmaya verir
export async function tumSiparisler(token, secenek, { maxSayfa = 300, sayfaBasi } = {}) {
  const hepsi = [];
  let ilkYanit = null;
  for (let s = 1; s <= maxSayfa; s++) {
    let y;
    try { y = await siparisSayfasi(token, s, secenek); }
    catch (e) { if (s > 1 && /\b404\b/.test(e.message)) break; throw e; }
    if (s === 1) ilkYanit = y;
    const dizi = siparisDizisi(y);
    if (!dizi.length) break;
    hepsi.push(...dizi);
    if (sayfaBasi) sayfaBasi(s, dizi.length);
    if (y && typeof y === "object" && !Array.isArray(y) && "next" in y && !y.next) break;
  }
  return { siparisler: hepsi, ilkYanit };
}

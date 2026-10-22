import { update, read } from "../lib/db.js";
import { locate } from "../lib/geo.js";
import { loadProducts, publicProduct } from "../lib/products.js";

// GET ?user=<avain> palauttaa käyttäjän asetukset ja seurannat sekä seurattujen tuotteiden tiedot (products).
// PUT { user, email, location, radiusKm, push, watches } tallentaa ne. Avain syntyy selaimessa, eikä kirjautumista ole.
// Seuranta on { id, product, maxPrice }: tuote ja sen kaupat ovat rekisterissä (lib/products.js).
export default async function handler(req, res) {
  const user = String(req.query.user || req.body?.user || "");
  if (!/^[a-z0-9]{16,40}$/.test(user)) return res.status(400).json({ error: "Virheellinen käyttäjäavain" });

  if (req.method === "GET") {
    const [users, reg] = await Promise.all([read("users", {}), loadProducts()]);
    const u = users[user] || { email: "", watches: [] };
    const products = Object.fromEntries(u.watches.filter((w) => reg[w.product]).map((w) => [w.product, publicProduct(reg[w.product])]));
    return res.json({ ...u, products });
  }

  if (req.method === "PUT") {
    const { email = "", watches = [], push = [], location = "", radiusKm = null, savedAt = Date.now() } = req.body || {};
    const seen = new Set();
    const entry = {
      email: String(email).slice(0, 120),
      savedAt: Number(savedAt) || Date.now(),
      location: String(location).slice(0, 60),
      coords: locate(location),
      radiusKm: Number(radiusKm) > 0 ? Math.min(Number(radiusKm), 2000) : null,
      push: (Array.isArray(push) ? push : []).filter((p) => /^https:\/\//.test(p?.endpoint) && p.keys?.p256dh && p.keys?.auth)
        .slice(-5).map((p) => ({ endpoint: p.endpoint, keys: { p256dh: p.keys.p256dh, auth: p.keys.auth } })),
      watches: (Array.isArray(watches) ? watches : [])
        .filter((w) => /^[a-z0-9-]{1,80}$/.test(w?.product || "") && !seen.has(w.product) && seen.add(w.product))
        .slice(0, 20).map((w) => ({ id: String(w.id).slice(0, 20), product: w.product, maxPrice: Number(w.maxPrice) || null })),
    };
    // Käyttäjä ilman seurantoja ja ilmoituskanavia poistetaan. Muiden samanaikaiset tallennukset säilyvät (ETag-ehto).
    await update("users", {}, (users) => {
      const before = JSON.stringify(users[user]);
      if (!entry.watches.length && !entry.email && !entry.push.length) delete users[user];
      else users[user] = entry;
      return JSON.stringify(users[user]) !== before;
    });
    return res.json(entry);
  }
  res.status(405).end();
}

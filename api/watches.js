import { read, write } from "../lib/db.js";
import { locate } from "../lib/geo.js";
import { bySlug } from "../lib/catalog.js";

// GET ?user=<avain> palauttaa käyttäjän asetukset ja seurannat.
// PUT { user, email, location, radiusKm, push, watches } tallentaa ne. Avain syntyy selaimessa, eikä kirjautumista ole.
export default async function handler(req, res) {
  const user = String(req.query.user || req.body?.user || "");
  if (!/^[a-z0-9]{16,40}$/.test(user)) return res.status(400).json({ error: "Virheellinen käyttäjäavain" });

  const users = await read("users", {});
  if (req.method === "GET") {
    const u = users[user] || { email: "", watches: [] };
    for (const w of u.watches) if (w.product && bySlug(w.product)) w.offers = bySlug(w.product).offers.map((o) => ({ ...o, name: w.offers.find((x) => x.store === o.store && x.id === o.id)?.name || w.name }));
    return res.json(u);
  }

  if (req.method === "PUT") {
    const { email = "", watches = [], push = [], location = "", radiusKm = null, savedAt = Date.now() } = req.body || {};
    users[user] = {
      email: String(email).slice(0, 120),
      savedAt: Number(savedAt) || Date.now(),
      location: String(location).slice(0, 60),
      coords: locate(location),
      radiusKm: Number(radiusKm) > 0 ? Math.min(Number(radiusKm), 2000) : null,
      push: (Array.isArray(push) ? push : []).filter((p) => /^https:\/\//.test(p?.endpoint) && p.keys?.p256dh && p.keys?.auth)
        .slice(-5).map((p) => ({ endpoint: p.endpoint, keys: { p256dh: p.keys.p256dh, auth: p.keys.auth } })),
      watches: watches.slice(0, 20).map((w) => ({
        id: String(w.id), product: /^[a-z0-9-]{1,40}$/.test(w.product || "") ? w.product : undefined, name: String(w.name).slice(0, 120), maxPrice: Number(w.maxPrice) || null,
        offers: (w.offers || []).slice(0, 10).map((o) => ({ store: o.store, id: String(o.id), name: String(o.name || "").slice(0, 160), url: o.url })),
      })),
    };
    await write("users", users);
    return res.json(users[user]);
  }
  res.status(405).end();
}

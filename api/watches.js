import { read, write } from "../lib/db.js";

// GET ?user=<avain> palauttaa käyttäjän asetukset ja seurannat.
// PUT { user, topic, email, watches } tallentaa ne. Avain syntyy selaimessa, eikä kirjautumista ole.
export default async function handler(req, res) {
  const user = String(req.query.user || req.body?.user || "");
  if (!/^[a-z0-9]{16,40}$/.test(user)) return res.status(400).json({ error: "Virheellinen käyttäjäavain" });

  const users = await read("users", {});
  if (req.method === "GET") return res.json(users[user] || { topic: "", email: "", watches: [] });

  if (req.method === "PUT") {
    const { topic = "", email = "", watches = [], savedAt = Date.now() } = req.body || {};
    users[user] = {
      topic: String(topic).replace(/[^\w-]/g, "").slice(0, 64),
      email: String(email).slice(0, 120),
      savedAt: Number(savedAt) || Date.now(),
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

import { STORES } from "../lib/stores.js";

// Yhden kauppatuotteen saldo ja hinta: /api/check?store=power&id=123
export default async function handler(req, res) {
  const store = STORES[req.query.store];
  const id = String(req.query.id || "").match(/^(\d{3,12}|[a-z0-9-]{3,80}~\d{3,12})$/)?.[0];
  if (!store || !id) return res.status(400).json({ error: "Virheellinen kauppa tai tuotenumero" });
  try {
    res.setHeader("Cache-Control", "s-maxage=60");
    res.json({ ...(await store.check(id)), checkedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

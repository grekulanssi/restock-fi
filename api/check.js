import { STORES } from "../lib/stores.js";
import { hitsFor, locate } from "../lib/geo.js";

// Yhden kauppatuotteen saldo ja hinta: /api/check?store=power&id=123[&loc=90100&r=300]
// loc ja r: palautetaan near = saatavuus verkossa ja säteen sisällä olevissa myymälöissä.
export default async function handler(req, res) {
  const store = STORES[req.query.store];
  const id = String(req.query.id || "").match(/^(\d{3,12}|[a-z0-9-]{3,80}~\d{3,12})$/)?.[0];
  if (!store || !id) return res.status(400).json({ error: "Virheellinen kauppa tai tuotenumero" });
  try {
    res.setHeader("Cache-Control", "s-maxage=60");
    const { shops, ...c } = await store.check(id);
    const coords = locate(req.query.loc);
    const near = hitsFor({ ...c, shops }, { coords, radiusKm: Number(req.query.r) || null }).map((h) => h.label);
    res.json({ ...c, near, checkedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

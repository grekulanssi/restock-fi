import { STORES } from "../lib/stores.js";
import { hitsFor, outletHitsFor, locate } from "../lib/geo.js";

// Yhden kauppatuotteen saldo ja hinta: /api/check?store=power&id=123[&loc=90100&r=300]
// loc ja r: palautetaan near = saatavuus verkossa ja säteen sisällä olevissa myymälöissä, outletNear samoin outlet-kappaleille.
export default async function handler(req, res) {
  const store = STORES[req.query.store];
  const id = String(req.query.id || "").match(/^[A-Za-z0-9-]{3,80}(~[A-Za-z0-9/]{3,20})?$/)?.[0];
  if (!store || !id) return res.status(400).json({ error: "Virheellinen kauppa tai tuotenumero" });
  try {
    res.setHeader("Cache-Control", "s-maxage=60");
    const { shops, ...c } = await store.check(id);
    const coords = locate(req.query.loc);
    const user = { coords, radiusKm: Number(req.query.r) || null };
    const near = hitsFor({ ...c, shops }, user).map((h) => h.label);
    // outletNear = outlet-kappaleet verkossa tai säteellä, hinta mukana, jotta selain voi verrata maksimihintaan.
    const outletNear = outletHitsFor(c, user).map(({ label, price }) => ({ label, price }));
    res.json({ ...c, storeName: store.name, near, outletNear, checkedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

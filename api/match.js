import { STORES } from "../lib/stores.js";
import { matchAll } from "../lib/match.js";

// Etsii saman tuotteen kaikista kaupoista: /api/match?store=power&id=4157161
export default async function handler(req, res) {
  const store = String(req.query.store || "");
  const id = String(req.query.id || "").match(/^[A-Za-z0-9-]{3,80}(~[A-Za-z0-9/]{3,20})?$/)?.[0];
  if (!STORES[store] || !id) return res.status(400).json({ error: "Virheellinen kauppa tai tuotenumero" });
  try {
    const offers = (await matchAll(store, id)).map((o) => ({
      store: o.store, storeName: STORES[o.store].name, id: o.id, name: o.name, url: o.url, price: o.price, available: o.available,
    }));
    res.setHeader("Cache-Control", "s-maxage=3600");
    res.json({ offers });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

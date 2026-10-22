import { STORES } from "../lib/stores.js";
import { matchAll, matchModel, modelName } from "../lib/match.js";

// Etsii saman tuotteen kaikista kaupoista: /api/match?store=power&id=4157161
// anyColor=1: saman mallin kaikki värit (sama tallennustila), ja model = nimi ilman väriä.
export default async function handler(req, res) {
  const store = String(req.query.store || "");
  const id = String(req.query.id || "").match(/^[A-Za-z0-9-]{3,80}(~[A-Za-z0-9/]{3,20})?$/)?.[0];
  if (!STORES[store] || !id) return res.status(400).json({ error: "Virheellinen kauppa tai tuotenumero" });
  try {
    const found = req.query.anyColor ? await matchModel(store, id) : await matchAll(store, id);
    const offers = found.map((o) => ({
      store: o.store, storeName: STORES[o.store].name, id: o.id, name: o.name, url: o.url, price: o.price, available: o.available, color: req.query.anyColor ? o.color : undefined,
    }));
    res.setHeader("Cache-Control", "s-maxage=3600");
    res.json({ offers, model: modelName(found[0]?.name) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

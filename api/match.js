import { STORES } from "../lib/stores.js";
import { matchAll, matchModel } from "../lib/match.js";
import { resolveProduct, publicProduct } from "../lib/products.js";

// Seurannan aloitus: POST { store, id, anyColor } etsii saman tuotteen kaikista kaupoista (anyColor: saman mallin
// kaikki värit) ja palauttaa rekisterin tuotteen. Tuote luodaan, jos sitä ei vielä ole, ja uudet kaupat lisätään siihen.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const store = String(req.body?.store || "");
  const id = String(req.body?.id || "").match(/^[A-Za-z0-9-]{3,80}(~[A-Za-z0-9/]{3,20})?$/)?.[0];
  if (!STORES[store] || !id) return res.status(400).json({ error: "Virheellinen kauppa tai tuotenumero" });
  const anyColor = !!req.body.anyColor;
  try {
    const found = await (anyColor ? matchModel : matchAll)(store, id);
    res.json(publicProduct(await resolveProduct(found, anyColor)));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

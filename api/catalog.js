import { CATALOG } from "../lib/catalog.js";
import { loadAll, summarize } from "../lib/summary.js";

// Etusivun tuotelista.
export default async function handler(req, res) {
  const data = await loadAll();
  const products = await Promise.all(CATALOG.map((p) => summarize(p, data)));
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  res.json(products.map(({ history, offers, ...p }) => ({ ...p, stores: offers.map((o) => o.storeName) })));
}

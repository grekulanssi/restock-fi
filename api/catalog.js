import { loadAll, summarize } from "../lib/summary.js";
import { MIN_WATCHERS } from "../lib/products.js";

// Etusivun tuotelista seuraajamäärän mukaan: katalogin tuotteet aina, käyttäjien luomat, kun seuraajia on vähintään MIN_WATCHERS.
export default async function handler(req, res) {
  const data = await loadAll();
  const shown = Object.values(data.products).filter((p) => p.seed || (data.watchers[p.slug] || 0) >= MIN_WATCHERS);
  const products = await Promise.all(shown.map((p) => summarize(p, data)));
  products.sort((a, b) => b.watchers - a.watchers || !!b.seed - !!a.seed);
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  res.json(products.map(({ history, offers, seed, ...p }) => ({ ...p, stores: [...new Set(offers.map((o) => o.storeName))] })));
}

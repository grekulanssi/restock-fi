import { STORES } from "./stores.js";
import { read } from "./db.js";
import { loadProducts, watcherCounts } from "./products.js";

// Kokoaa rekisterin tuotteen tiedot: kauppakohtainen tila, täydennyshistoria ja seuraajamäärä.
// Tila ja historia ovat tarjouskohtaisia (store:id), joten ne kertyvät jokaiselle tuotteelle.
export async function loadAll() {
  const [state, events, users, products] = await Promise.all([read("state", {}), read("events", []), read("users", {}), loadProducts()]);
  return { state, events, products, watchers: watcherCounts(users) };
}

export async function summarize(p, { state, events, watchers }, { live = false } = {}) {
  const offers = await Promise.all(p.offers.map(async (o) => {
    const key = `${o.store}:${o.id}`;
    let s = state.offers?.[key];
    if (!s && live) { try { s = await STORES[o.store].check(o.id); } catch {} }
    const evs = events.filter((e) => e.key === key);
    return { store: o.store, id: o.id, color: o.color, url: o.url, key, storeName: STORES[o.store].name, ...(s || {}), lastRestock: evs.at(-1) || null };
  }));
  const keys = new Set(offers.map((o) => o.key));
  const history = events.filter((e) => keys.has(e.key)).map((e) => ({ ...e, storeName: STORES[e.key.split(":")[0]].name }));
  const since30 = Date.now() - 30 * 864e5;
  const prices = offers.filter((o) => o.price).map((o) => o.price);
  return {
    slug: p.slug, name: p.name, category: p.category, anyColor: p.anyColor, seed: p.seed,
    image: offers.find((o) => o.image)?.image || p.image || null,
    offers,
    available: offers.some((o) => o.available),
    minPrice: prices.length ? Math.min(...prices) : null,
    history,
    restocks30: history.filter((e) => Date.parse(e.start) > since30).length,
    lastRestock: history.at(-1) || null,
    watchers: watchers[p.slug] || 0,
  };
}

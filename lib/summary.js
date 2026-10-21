import { STORES } from "./stores.js";
import { read } from "./db.js";

// Kokoaa katalogituotteen tiedot: kauppakohtainen tila, täydennyshistoria ja seuraajamäärä.
export async function loadAll() {
  const [state, events, users] = await Promise.all([read("state", {}), read("events", []), read("users", {})]);
  return { state, events, users };
}

export async function summarize(p, { state, events, users }, { live = false } = {}) {
  const offers = await Promise.all(p.offers.map(async (o) => {
    const key = `${o.store}:${o.id}`;
    let s = state.offers?.[key];
    if (!s && live) { try { s = await STORES[o.store].check(o.id); } catch {} }
    const evs = events.filter((e) => e.key === key);
    return { ...o, key, storeName: STORES[o.store].name, ...(s || {}), lastRestock: evs.at(-1) || null };
  }));
  const keys = new Set(offers.map((o) => o.key));
  const history = events.filter((e) => keys.has(e.key)).map((e) => ({ ...e, storeName: STORES[e.key.split(":")[0]].name }));
  const since30 = Date.now() - 30 * 864e5;
  const prices = offers.filter((o) => o.price).map((o) => o.price);
  return {
    ...p,
    image: offers.find((o) => o.image)?.image || null,
    offers,
    available: offers.some((o) => o.available),
    minPrice: prices.length ? Math.min(...prices) : null,
    history,
    restocks30: history.filter((e) => Date.parse(e.start) > since30).length,
    lastRestock: history.at(-1) || null,
    watchers: Object.values(users).filter((u) => u.watches.some((w) => w.product === p.slug)).length,
  };
}

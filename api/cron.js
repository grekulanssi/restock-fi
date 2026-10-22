import { STORES } from "../lib/stores.js";
import { read, write } from "../lib/db.js";
import { loadProducts, watcherCounts } from "../lib/products.js";
import { notify, hasChannel } from "../lib/notify.js";
import { hitsFor } from "../lib/geo.js";
import { colorOf } from "../lib/match.js";

// GitHub Actions kutsuu tätä ajastetusti. Tarkistaa katalogin ja seurattujen tuotteiden tarjoukset rekisteristä,
// kirjaa täydennykset historiaan ja lähettää ilmoitukset (Web Push ja halutessa sähköposti).
export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).end();

  const [users, state, events, products] = await Promise.all([read("users", {}), read("state", {}), read("events", []), loadProducts()]);
  const before = JSON.stringify(state);
  const counts = watcherCounts(users);
  const offers = new Map();
  for (const p of Object.values(products)) if (p.seed || counts[p.slug]) for (const o of p.offers) offers.set(`${o.store}:${o.id}`, o);

  const checked = {};
  await Promise.all([...offers].map(async ([key, o]) => {
    try { checked[key] = await STORES[o.store].check(o.id); } catch (e) { checked[key] = { error: e.message }; }
  }));

  // Ilmoitustila on käyttäjäkohtainen (avain, tarjous, maksimihinta ja säde). Se kootaan joka ajolla uudelleen,
  // jolloin poistettujen seurantojen rivit putoavat pois. Virheen sattuessa edellinen tila säilyy.
  const sent = [], hitsNow = {};
  for (const [uk, u] of Object.entries(users)) {
    for (const w of u.watches) {
      const p = products[w.product];
      if (!p) continue;
      const fresh = [];
      for (const o of p.offers) {
        const key = `${o.store}:${o.id}`, now = checked[key];
        const hitKey = `${uk}:${key}:${w.maxPrice || ""}:${u.coords || ""}:${u.radiusKm || ""}`;
        if (!now || now.error) { if (state.hits?.[hitKey]) hitsNow[hitKey] = true; continue; }
        // Saatavilla käyttäjälle = verkossa tai säteen sisällä olevassa myymälässä, ja hinta rajan alla.
        const hits = hitsFor(now, u);
        const hit = hits.length > 0 && (!w.maxPrice || now.price <= w.maxPrice);
        if (hit && !state.hits?.[hitKey] && hasChannel(u)) fresh.push({ o, now, hits, hitKey });
        if (hit) hitsNow[hitKey] = true;
      }
      // Mikä tahansa väri: yksi ilmoitus seurantaa kohden, otsikossa väri ja kauppa ("iPhone Duo 256 Gt yötaivas, Telia").
      const where = (f) => [f.o.color || colorOf(f.now), STORES[f.o.store].name].filter(Boolean).join(", ");
      for (const [f, ...rest] of p.anyColor ? (fresh.length ? [fresh] : []) : fresh.map((x) => [x])) {
        const places = f.hits.slice(0, 3).map((h) => h.label).join(" · ");
        const also = rest.length ? ` · myös ${rest.slice(0, 3).map(where).join("; ")}${rest.length > 3 ? " …" : ""}` : "";
        if (p.anyColor) await notify(u, `${p.name} ${where(f)}`, `Saatavilla ${f.now.price} € · ${places}${also}`, f.now.url);
        else await notify(u, `${f.now.name} saatavilla: ${STORES[f.o.store].name}`, `${f.now.price} € · ${places}`, f.now.url);
        sent.push(`${p.slug} ${f.o.store}:${f.o.id}`, ...rest.map((x) => `${p.slug} ${x.o.store}:${x.o.id}`));
      }
    }
  }
  state.hits = hitsNow;

  // Täydennyshistoria: loppu -> saatavilla avaa tapahtuman, saatavilla -> loppu sulkee sen.
  const at = new Date().toISOString();
  let eventsChanged = false;
  for (const [key, now] of Object.entries(checked)) {
    const old = state.offers?.[key];
    if (now.error || !old) continue;
    if (now.available && !old.available) {
      events.push({ key, start: at, end: null, price: now.price });
      eventsChanged = true;
    } else if (!now.available && old.available) {
      const open = events.findLast((e) => e.key === key && !e.end);
      if (open) { open.end = at; eventsChanged = true; }
    }
  }
  const cutoff = Date.now() - 90 * 864e5;
  const keptEvents = events.filter((e) => Date.parse(e.start) > cutoff).slice(-1000);

  // Blobin ilmaiskiintiössä kirjoituksia on vähän, joten tila tallennetaan vain, kun saatavuus, hinta tai ilmoitustila muuttuu.
  // (before otetaan heti luvun jälkeen, jotta myös lähetetyt ilmoitukset tallentuvat eikä niitä lähetetä uudelleen.)
  for (const [k, v] of Object.entries(checked)) {
    if (v.error) continue;
    const old = state.offers?.[k];
    if (!old || old.available !== v.available || old.price !== v.price || old.image !== v.image) {
      (state.offers ||= {})[k] = { name: v.name, url: v.url, image: v.image, available: v.available, price: v.price, detail: v.detail, changedAt: at };
    }
  }
  const changed = JSON.stringify(state) !== before;
  await Promise.all([changed && write("state", state), eventsChanged && write("events", keptEvents)]);
  res.json({ checked: offers.size, sent, changed, eventsChanged, errors: Object.entries(checked).filter(([, v]) => v.error) });
}

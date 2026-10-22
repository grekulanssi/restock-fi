import { STORES } from "../lib/stores.js";
import { CATALOG, bySlug } from "../lib/catalog.js";
import { read, write } from "../lib/db.js";
import { notify, hasChannel } from "../lib/notify.js";
import { hitsFor } from "../lib/geo.js";

// GitHub Actions kutsuu tätä ajastetusti. Tarkistaa katalogin ja käyttäjien seuraamat tuotteet,
// kirjaa täydennykset historiaan ja lähettää ilmoitukset (Web Push ja halutessa sähköposti).
export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).end();

  const [users, state, events] = await Promise.all([read("users", {}), read("state", {}), read("events", [])]);
  const before = JSON.stringify(state);
  const offers = new Map();
  for (const p of CATALOG) for (const o of p.offers) offers.set(`${o.store}:${o.id}`, o);
  // Katalogituotteen seuranta käyttää aina katalogin nykyistä kauppalistaa, jotta uudet kaupat tulevat mukaan.
  for (const u of Object.values(users)) for (const w of u.watches) if (w.product && bySlug(w.product)) w.offers = bySlug(w.product).offers;
  for (const u of Object.values(users)) for (const w of u.watches) for (const o of w.offers) offers.set(`${o.store}:${o.id}`, o);

  const checked = {};
  await Promise.all([...offers].map(async ([key, o]) => {
    try { checked[key] = await STORES[o.store].check(o.id); } catch (e) { checked[key] = { error: e.message }; }
  }));

  const sent = [];
  for (const u of Object.values(users)) {
    for (const w of u.watches) {
      for (const o of w.offers) {
        const key = `${o.store}:${o.id}`, now = checked[key];
        if (!now || now.error) continue;
        // Saatavilla käyttäjälle = verkossa tai säteen sisällä olevassa myymälässä, ja hinta rajan alla.
        const hits = hitsFor(now, u);
        const hit = hits.length > 0 && (!w.maxPrice || now.price <= w.maxPrice);
        const hitKey = `${key}:${w.maxPrice || ""}:${u.coords || ""}:${u.radiusKm || ""}`;
        if (hit && !state.hits?.[hitKey] && hasChannel(u)) {
          await notify(u, `${now.name} saatavilla: ${STORES[o.store].name}`, `${now.price} € · ${hits.slice(0, 3).map((h) => h.label).join(" · ")}`, now.url);
          sent.push(hitKey);
        }
        (state.hits ||= {})[hitKey] = hit;
      }
    }
  }

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

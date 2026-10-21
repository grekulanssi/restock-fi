import { STORES } from "../lib/stores.js";
import { read, write } from "../lib/db.js";

// GitHub Actions kutsuu tätä 5 min välein. Tarkistaa kaikkien käyttäjien seuratut tuotteet
// ja lähettää ntfy-ilmoituksen (ja halutessa sähköpostin), kun tuote tulee saataville rajahinnan alle.
export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).end();

  const users = await read("users", {});
  const state = await read("state", {});
  const offers = new Map();
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
        const hit = now.available && (!w.maxPrice || now.price <= w.maxPrice);
        const hitKey = `${key}:${w.maxPrice || ""}`;
        if (hit && !state.hits?.[hitKey] && u.topic) {
          await notify(u, `${now.name} saatavilla: ${STORES[o.store].name}`, `${now.price} € · ${now.detail}`, now.url);
          sent.push(hitKey);
        }
        (state.hits ||= {})[hitKey] = hit;
      }
    }
  }

  // Blobin ilmaiskiintiössä kirjoituksia on vähän, joten tallennetaan vain muutokset.
  const before = JSON.stringify(state);
  for (const [k, v] of Object.entries(checked)) {
    if (v.error) continue;
    const old = state.offers?.[k];
    if (!old || old.available !== v.available || old.price !== v.price || old.detail !== v.detail) {
      (state.offers ||= {})[k] = { available: v.available, price: v.price, detail: v.detail, changedAt: new Date().toISOString() };
    }
  }
  const changed = JSON.stringify(state) !== before;
  if (changed) await write("state", state);
  res.json({ checked: offers.size, sent, changed, errors: Object.entries(checked).filter(([, v]) => v.error) });
}

function notify(user, title, message, click) {
  return fetch("https://ntfy.sh/", {
    method: "POST",
    body: JSON.stringify({ topic: user.topic, title, message, click, tags: ["shopping_cart"], ...(user.email && { email: user.email }) }),
  }).catch(() => {});
}

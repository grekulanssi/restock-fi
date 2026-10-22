import { read, write } from "../lib/db.js";
import { matchAll, matchModel, maxOffers } from "../lib/match.js";

// Kerran yössä (.github/workflows/rematch.yml): omat seurannat (ei katalogituotteet) haetaan uudelleen kaikista kaupoista,
// ja kaupat, joihin tuote on tullut myyntiin, lisätään seurantaan. "Mikä tahansa väri" -seurannoille haetaan kaikki värit.
export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).end();
  const deadline = Date.now() + 240e3;
  const users = await read("users", {});

  // Sama lähdetuote haetaan vain kerran, vaikka sitä seuraisi moni. Järjestys arvotaan, jotta aikarajan ylittyessä
  // eri seurannat jäävät väliin eri öinä.
  const jobKey = (w) => !w.product && w.offers?.[0] && `${w.anyColor ? "model" : "exact"}:${w.offers[0].store}:${w.offers[0].id}`;
  const jobs = new Map();
  for (const u of Object.values(users)) for (const w of u.watches || []) if (jobKey(w)) jobs.set(jobKey(w), { w, offers: null });
  const queue = [...jobs.values()].sort(() => Math.random() - 0.5);
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let job; Date.now() < deadline && (job = queue.shift()); ) {
      const { store, id } = job.w.offers[0];
      job.offers = await (job.w.anyColor ? matchModel : matchAll)(store, id).catch(() => null);
    }
  }));

  // Selain voi tallentaa users.jsonin samaan aikaan, joten uudet kaupat lisätään juuri luettuun versioon eikä mitään poisteta.
  // savedAt päivittyy, jotta selain (public/user.js) ottaa tämän version oman kopionsa sijaan. Kirjoitus vain, jos jotain lisättiin.
  const fresh = await read("users", {});
  const added = [];
  for (const u of Object.values(fresh)) {
    const before = added.length;
    for (const w of u.watches || []) {
      for (const o of (jobKey(w) && jobs.get(jobKey(w))?.offers) || []) {
        if (w.offers.length >= maxOffers(w)) break;
        if (w.offers.some((x) => x.store === o.store && (!w.anyColor || x.id === o.id))) continue;
        w.offers.push({ store: o.store, id: o.id, name: String(o.name || "").slice(0, 160), url: o.url, color: w.anyColor ? o.color : undefined });
        added.push(`${o.store}:${o.id}`);
      }
    }
    if (added.length > before) u.savedAt = Date.now();
  }
  if (added.length) await write("users", fresh);
  res.json({ sources: jobs.size, done: [...jobs.values()].filter((j) => j.offers).length, added });
}

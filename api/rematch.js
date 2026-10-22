import { read, update } from "../lib/db.js";
import { matchAll, matchModel } from "../lib/match.js";
import { loadProducts, withSeeds, watcherCounts, addOffers } from "../lib/products.js";

// Kerran yössä (.github/workflows/rematch.yml): rekisterin tuotteet (katalogi ja seuratut) haetaan uudelleen kaikista
// kaupoista, ja kaupat, joihin tuote on tullut myyntiin, lisätään tuotteelle. Mitään ei poisteta.
export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).end();
  const deadline = Date.now() + 240e3;
  const [reg, users] = await Promise.all([loadProducts(), read("users", {})]);
  const counts = watcherCounts(users);

  // Järjestys arvotaan, jotta aikarajan ylittyessä eri tuotteet jäävät väliin eri öinä.
  const queue = Object.values(reg).filter((p) => (p.seed || counts[p.slug]) && p.offers[0]).sort(() => Math.random() - 0.5);
  const results = new Map();
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let p; Date.now() < deadline && (p = queue.shift()); ) {
      const { store, id } = p.offers[0];
      const found = await (p.anyColor ? matchModel : matchAll)(store, id).catch(() => null);
      if (found) results.set(p.slug, found);
    }
  }));

  // Lisäys tehdään juuri luettuun versioon (ETag-ehto), joten samanaikaisesti luodut tuotteet säilyvät.
  const added = [];
  await update("products", {}, (raw) => {
    withSeeds(raw);
    added.length = 0;
    let changed = false;
    for (const [slug, found] of results) {
      const p = raw[slug], before = p.offers.length;
      // Tunnistusavaimet ja kuva voivat täydentyä, vaikka kauppoja ei tulisi lisää (esim. katalogituotteen EAN).
      if (addOffers(p, found, p.anyColor)) changed = true;
      added.push(...p.offers.slice(before).map((o) => `${slug} ${o.store}:${o.id}`));
    }
    return changed;
  });
  res.json({ products: results.size, added });
}

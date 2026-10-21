import { STORES, rank, parseLink } from "../lib/stores.js";

// Hakee kaikista kaupoista rinnakkain. Tuotelinkillä palautetaan suoraan se tuote.
export default async function handler(req, res) {
  const q = String(req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "Anna hakusana tai tuotelinkki" });

  const link = parseLink(q);
  if (link) {
    try { return res.json({ results: [await STORES[link.store].check(link.id)], errors: [] }); }
    catch (e) { return res.status(502).json({ error: e.message }); }
  }

  const settled = await Promise.allSettled(Object.values(STORES).map((s) => s.search(q)));
  const results = settled.flatMap((r) => (r.status === "fulfilled" ? rank(r.value, q) : []));
  const errors = settled.flatMap((r, i) => (r.status === "rejected" ? [`${Object.values(STORES)[i].name}: ${r.reason.message}`] : []));
  res.setHeader("Cache-Control", "s-maxage=300");
  res.json({ results, errors });
}

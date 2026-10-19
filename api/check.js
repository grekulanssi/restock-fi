// Hakee Verkkokauppa.comin tuotesivun ja palauttaa hinnan sekä varastosaldot.
const STORES = { js: "Helsinki", oul: "Oulu", pir: "Pirkkala", rai: "Raisio", pak: "Vantaa (Pakkala)" };

function extractObject(html, key) {
  const start = html.indexOf(`"${key}":{`);
  if (start < 0) return null;
  let i = start + key.length + 3, depth = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === "{") depth++;
    else if (html[j] === "}" && --depth === 0) return JSON.parse(html.slice(i, j + 1));
  }
  return null;
}

export default async function handler(req, res) {
  const pid = String(req.query.pid || "").match(/\d{4,8}/)?.[0];
  if (!pid) return res.status(400).json({ error: "Anna tuotelinkki tai tuotenumero" });

  const r = await fetch(`https://www.verkkokauppa.com/fi/product/${pid}`, {
    headers: { "User-Agent": "Mozilla/5.0 (restock-fi MVP)" },
  });
  if (!r.ok) return res.status(502).json({ error: `Kauppa vastasi ${r.status}` });
  const html = await r.text();

  const stocks = extractObject(html, "stocks");
  const ld = [...html.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1]))
    .flatMap((d) => d["@graph"] || [d])
    .find((d) => d["@type"] === "Product");
  if (!stocks || !ld) return res.status(502).json({ error: "Tuotetietoja ei löytynyt" });

  const stores = Object.entries(stocks.pickup || {})
    .filter(([code]) => STORES[code])
    .map(([code, s]) => ({ name: STORES[code], stock: s.stock, available: s.isAvailable }));

  res.setHeader("Cache-Control", "s-maxage=60");
  res.json({
    pid,
    name: ld.name,
    url: ld.url,
    image: [].concat(ld.image)[0],
    price: Number([].concat(ld.offers)[0]?.price),
    online: { stock: stocks.shipment?.stock ?? 0, available: !!stocks.shipment?.isAvailable },
    stores,
    inStock: !!stocks.shipment?.isAvailable || stores.some((s) => s.available),
    checkedAt: new Date().toISOString(),
  });
}

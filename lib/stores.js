// Kauppakohtaiset haut ja saldotarkistukset. Jokainen kauppa palauttaa saman muodon:
// search(q) -> [{ store, id, name, price, image, url, ean? }]
// check(id) -> { store, id, name, price, image, url, available, detail }

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const get = async (url, as = "json") => {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: as === "json" ? "application/json" : "text/html" } });
  if (!r.ok) throw new Error(`${new URL(url).hostname} vastasi ${r.status}`);
  return as === "json" ? r.json() : r.text();
};

function jsonLdProduct(html) {
  return [...html.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
    .flatMap((d) => d?.["@graph"] || [d])
    .find((d) => d?.["@type"] === "Product");
}

function extractObject(html, key) {
  const start = html.indexOf(`"${key}":{`);
  if (start < 0) return null;
  const i = start + key.length + 3;
  let depth = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === "{") depth++;
    else if (html[j] === "}" && --depth === 0) return JSON.parse(html.slice(i, j + 1));
  }
  return null;
}

const VK_STORES = { js: "Helsinki", oul: "Oulu", pir: "Pirkkala", rai: "Raisio", pak: "Vantaa" };

const verkkokauppa = {
  name: "Verkkokauppa.com",
  async search(q) {
    const u = `https://search.service.verkkokauppa.com/fi/api/v1/product-search?page%5Bnumber%5D=1&page%5Bsize%5D=24&sort=-score&filter%5Bq%5D=${encodeURIComponent(q)}&sessionId=${crypto.randomUUID()}`;
    const d = await get(u);
    return (d.data || []).map(({ id, attributes: a }) => ({
      store: "verkkokauppa", id: String(id), name: a.name, price: a.price?.current,
      image: a.images?.[0]?.orig, url: "https://www.verkkokauppa.com" + a.href, ean: a.articles?.[0]?.eans?.[0],
    }));
  },
  async check(id) {
    const html = await get(`https://www.verkkokauppa.com/fi/product/${id}`, "html");
    const ld = jsonLdProduct(html);
    const stocks = extractObject(html, "stocks");
    if (!ld || !stocks) throw new Error("Verkkokauppa.com: tuotetietoja ei löytynyt");
    const web = stocks.shipment?.stock ?? 0;
    const shops = Object.entries(stocks.pickup || {}).filter(([c, s]) => VK_STORES[c] && s.isAvailable);
    return {
      store: "verkkokauppa", id, name: ld.name, url: ld.url, image: [].concat(ld.image)[0],
      price: Number([].concat(ld.offers)[0]?.price),
      available: !!stocks.shipment?.isAvailable || shops.length > 0,
      detail: [`verkossa ${web} kpl`, ...shops.map(([c, s]) => `${VK_STORES[c]} ${s.stock}`)].join(", "),
    };
  },
};

function powerImage(img) {
  const v = img?.variants?.find((x) => x.width === 300 && !x.isTransparent) || img?.variants?.[0];
  return v ? `https://media.power-cdn.net${img.basePath}/${v.filename}` : null;
}

const powerItem = (p) => ({
  store: "power", id: String(p.productId), name: p.title, price: p.price,
  image: powerImage(p.productImage),
  url: "https://www.power.fi" + p.url,
});

const power = {
  name: "Power",
  async search(q) {
    const d = await get(`https://www.power.fi/api/v2/productlists?q=${encodeURIComponent(q)}&size=8`);
    return (d.products || []).map(powerItem);
  },
  async check(id) {
    const [p] = await get(`https://www.power.fi/api/v2/products?ids=${id}`);
    if (!p) throw new Error("Power: tuotetta ei löytynyt");
    return {
      ...powerItem(p),
      available: p.stockCount > 0 || p.storesStockCount > 0,
      detail: `verkossa ${p.stockCount} kpl, ${p.storesStockCount} myymälässä`,
    };
  },
};

const prisma = {
  name: "Prisma",
  async search(q) {
    const d = await get(`https://storefront-api.prisma.fi/search/quick-search-constructor?searchTerm=${encodeURIComponent(q)}`);
    return (d.products || []).slice(0, 8).map((p) => ({
      store: "prisma", id: p.sokId, name: p.productName, price: p.finalPrice / 100,
      image: p.mainImage, url: `https://www.prisma.fi/tuotteet/${p.sokId}/${p.slug}`,
    }));
  },
  async check(id) {
    const html = await get(`https://www.prisma.fi/tuotteet/${id}`, "html");
    const ld = jsonLdProduct(html);
    if (!ld) throw new Error("Prisma: tuotetietoja ei löytynyt");
    const offer = [].concat(ld.offers)[0] || {};
    const available = /InStock|LimitedAvailability/.test(offer.availability || "");
    return {
      store: "prisma", id, name: ld.name, image: [].concat(ld.image)[0],
      url: `https://www.prisma.fi/tuotteet/${id}`, price: Number(offer.price), ean: ld.gtin13,
      available, detail: available ? "verkossa saatavilla" : "verkossa loppu",
    };
  },
};

// Telialla ei ole avointa hakua, joten sitä käytetään vain katalogin kautta.
// id = "<slug>~<varianttiId>", esim. "apple-iphone-duo~9149131". Data on Next.js-sivun RSC-payloadissa.
const telia = {
  name: "Telia",
  async search() { return []; },
  async check(id) {
    const [slug, vid] = id.split("~");
    const html = (await get(`https://www.telia.fi/kauppa/tuote/${slug}`, "html")).replace(/\\"/g, '"');
    const av = html.match(new RegExp(`"availability":\\[\\{"id":"${vid}"[^}]*\\}`))?.[0];
    const at = html.indexOf(`{"id":"${vid}","sku"`);
    if (!av || at < 0) throw new Error("Telia: varianttia ei löytynyt");
    const variant = html.slice(at, at + 5000);
    const state = av.match(/"state":"(\w+)"/)?.[1];
    const future = av.match(/"futureAvailabilityDate":"\$D([\d-]+)/)?.[1];
    const web = state === "AVAILABLE";
    const shops = av.match(/"storeAvailabilityState":"(\w+)"/)?.[1] === "AVAILABLE";
    const available = web || shops;
    return {
      store: "telia", id,
      name: html.match(new RegExp(`"${vid}","highlights":\\[[^\\]]*\\],"pageTitle":"([^"]+)"`))?.[1] || slug,
      price: Number(variant.match(/"price":\{"withVat":([\d.]+)/)?.[1]) || null,
      image: html.match(/<meta property="og:image" content="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&") || null,
      url: `https://www.telia.fi/kauppa/tuote/${slug}`,
      available,
      detail: available ? [web && "verkossa saatavilla", shops && "myymälöissä saatavilla"].filter(Boolean).join(", ")
        : future ? `loppu, arvio ${new Date(future).toLocaleDateString("fi-FI")}` : "loppu",
    };
  },
};

export const STORES = { verkkokauppa, power, prisma, telia };

// Kauppojen oma järjestys on välillä outo, joten järjestetään osumat hakusanojen mukaan.
export function rank(items, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const score = (n) => words.filter((w) => n.toLowerCase().includes(w)).length;
  return items.map((it, i) => ({ it, s: score(it.name) * 100 - i })).sort((a, b) => b.s - a.s).slice(0, 6).map((x) => x.it);
}

// Tunnistaa kaupan ja tuotenumeron liitetystä tuotelinkistä.
export function parseLink(url) {
  const m =
    url.match(/verkkokauppa\.com\/fi\/product\/(\d+)/) && ["verkkokauppa", RegExp.$1] ||
    url.match(/power\.fi\/.*p-(\d+)/) && ["power", RegExp.$1] ||
    url.match(/prisma\.fi\/tuotteet\/(\d+)/) && ["prisma", RegExp.$1];
  return m ? { store: m[0], id: m[1] } : null;
}

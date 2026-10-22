// Kauppakohtaiset haut ja saldotarkistukset. Jokainen kauppa palauttaa saman muodon:
// search(q) -> [{ store, id, name, price, image, url, ean? }]
// check(id) -> { store, id, name, price, image, url, available, detail }

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
// Aikaraja ja yksi uudelleenyritys, ettei yksi hidas kauppa kaada koko tarkistusta.
async function get(url, as = "json", tries = 2) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: as === "json" ? "application/json" : "text/html" }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`${new URL(url).hostname} vastasi ${r.status}`);
    return as === "json" ? await r.json() : await r.text();
  } catch (e) {
    if (tries > 1) return get(url, as, tries - 1);
    throw e;
  }
}

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

// Yhteinen muoto: web = verkkokaupan tilanne, shops = myymälät (nimi, paikkakunta, saldo).
// available = saatavilla jossain, detail = lyhyt yhteenveto. Säderajaus tehdään lib/geo.js:ssä.
function withShops(base, web, shops) {
  const open = (shops || []).filter((x) => x.available);
  const parts = [web && (!web.available ? "verkossa loppu" : web.stock != null ? `verkossa ${web.stock} kpl` : "verkossa saatavilla")];
  if (shops) parts.push(open.length ? `${open.length} myymälässä` : "myymälöissä loppu");
  return { ...base, web, shops, available: !!web?.available || open.length > 0, detail: parts.filter(Boolean).join(", ") };
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
    const shops = Object.entries(stocks.pickup || {}).filter(([c]) => VK_STORES[c])
      .map(([c, x]) => ({ name: `Verkkokauppa.com ${VK_STORES[c]}`, city: VK_STORES[c], stock: x.stock, available: !!x.isAvailable }));
    return withShops({
      store: "verkkokauppa", id, name: ld.name, url: ld.url, image: [].concat(ld.image)[0],
      price: Number([].concat(ld.offers)[0]?.price),
    }, { available: !!stocks.shipment?.isAvailable, stock: stocks.shipment?.stock ?? 0 }, shops);
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
    // Myymäläkohtaiset saldot (sama data kuin tuotesivun "Katso myymäläsaatavuus").
    const list = await get(`https://www.power.fi/api/v2/products/${id}/stores?postalCode=00100`).catch(() => null);
    const shops = Array.isArray(list)
      ? list.map((x) => ({ name: x.name.replace(/^POWER/, "Power"), city: x.city, zip: x.postalCode, stock: x.storeStockCount, available: x.storeStockCount > 0 }))
      : null;
    return withShops(powerItem(p), { available: p.stockCount > 0, stock: p.stockCount }, shops);
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
    // Kaikkien S-ryhmän myymälöiden hyllysaldot (sama data kuin "Tarkista myymäläsaatavuus").
    const av = await get(`https://storefront-api.prisma.fi/products/${id}/availability?skip=0&limit=1000`).catch(() => null);
    const shops = av?.storeQuantities?.map((x) => ({
      name: x.displayName, city: x.address?.city?.trim(), zip: x.address?.zipCode,
      stock: Math.max(x.rawShelfQuantity || 0, x.clickAndCollectQuantity || 0),
      available: (x.rawShelfQuantity || 0) > 0 || (x.clickAndCollectQuantity || 0) > 0,
    })) || null;
    return withShops({
      store: "prisma", id, name: ld.name, image: [].concat(ld.image)[0],
      url: `https://www.prisma.fi/tuotteet/${id}`, price: Number(offer.price), ean: ld.gtin13,
    }, { available: av ? av.ecomQuantity > 0 : /InStock|LimitedAvailability/.test(offer.availability || ""), stock: av?.ecomQuantity }, shops);
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

// Elisa: vain katalogin kautta. id = "<slug>~<laitenumero>", esim. "apple-iphone-duo-256-gt-5g~36341" (uid HANDSET-36341, yksi väri).
// Saatavuus tulee sijaintitunnuksittain, ja myymälöiden nimet ja koordinaatit toimitustapojen listasta.
const elisa = {
  name: "Elisa",
  async search() { return []; },
  async check(ref) {
    const [slug, num] = ref.split("~"), id = `HANDSET-${num}`;
    const base = "https://elisa.fi/kauppa/rest";
    const [[p], avail, delivery] = await Promise.all([
      get(`${base}/products?uid=${id}`), get(`${base}/devices/availability/${id}`), get(`${base}/deliverytypes/forDevice/${id}`).catch(() => []),
    ]);
    if (!p) throw new Error("Elisa: tuotetta ei löytynyt");
    const shopsById = new Map(delivery.flatMap((d) => d.availableShops || []).map((x) => [String(x.id), x]));
    const inStock = (label) => /AVAILABLE/.test(label || "") && !/NOT_AVAILABLE/.test(label);
    const webLabel = avail.find((a) => a.location === "CENTRAL_WAREHOUSE")?.label;
    const shops = avail.filter((a) => a.location !== "CENTRAL_WAREHOUSE").map((a) => {
      const x = shopsById.get(String(a.location));
      return { name: x?.name?.replace("Elisan myymälä", "Elisa") || `Elisa myymälä ${a.location}`, zip: x?.address?.postalcode, city: x?.address?.city, stock: null, available: inStock(a.label) };
    });
    return withShops({
      store: "elisa", id: ref, name: p.fullName, price: p.lowestPrice?.price ?? null,
      image: p.defaultImage ? "https:" + String(p.defaultImage).replace(/^https?:/, "") : null,
      url: `https://elisa.fi/kauppa/tuote/${slug}`,
    }, { available: inStock(webLabel) }, shops);
  },
};

// DNA: vain katalogin kautta. id = "<slug>~<Applen tuotekoodi>", esim. "apple-iphone-18-pro-5g-256-gt-viininpunainen~MJRR4QN/A".
// Myymäläsaldot tulevat DNA:n GraphQL-rajapinnasta (persisted query, sama kuin "Varaa ja nouda myymälästä").
const DNA_CC_HASH = "e8b0f99707ef2308897a9f6d59bd5951e7b4f6bb3fd7a93bf0a00e426c2d9f63";
const dna = {
  name: "DNA",
  async search() { return []; },
  async check(id) {
    const [slug, sku] = id.split("~");
    const url = `https://kauppa.dna.fi/tuote/p/${slug}`;
    const q = new URLSearchParams({
      operationName: "GetClickAndCollectDetails", variables: JSON.stringify({ backendSystemCode: sku }),
      extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: DNA_CC_HASH } }),
    });
    const [html, cc] = await Promise.all([
      get(url, "html"),
      fetch(`https://kauppa.dna.fi/graphql?${q}`, { headers: { "User-Agent": UA, "x-apollo-operation-name": "GetClickAndCollectDetails", "content-type": "application/json" }, signal: AbortSignal.timeout(20000) })
        .then((r) => r.json()).catch(() => null),
    ]);
    const ld = jsonLdProduct(html);
    if (!ld) throw new Error("DNA: tuotetietoja ei löytynyt");
    const offer = [].concat(ld.offers)[0] || {};
    const cities = cc?.data?.getClickAndCollectDetails;
    const shops = cities ? cities.flatMap((c) => c.stores.map((x) => ({
      name: `DNA ${x.storeName}${x.storeName.includes(x.city) ? "" : " " + x.city}`, city: x.city, stock: null,
      available: /IN_STOCK|LOW_STOCK/.test(x.storeStatusFlag || ""),
    }))) : null;
    return withShops({
      store: "dna", id, name: ld.name, url, price: Number(offer.price) || null,
      image: html.match(/og:image" content="([^"]+)/)?.[1] || null,
    }, { available: /InStock|LimitedAvailability/.test(offer.availability || "") }, shops);
  },
};

export const STORES = { verkkokauppa, power, prisma, telia, elisa, dna };

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

// Kauppakohtaiset haut ja saldotarkistukset. Jokainen kauppa palauttaa saman muodon:
// search(q) -> [{ store, id, name, price, image, url, ean? }]
// check(id) -> { store, id, name, price, image, url, available, detail, color? }

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

// marker = tekstiä objektin edessä, oletuksena JSON-avain ("stocks":), sivun skriptissä esim. "clickAndCollectData: ".
function extractObject(html, key, marker = `"${key}":`) {
  const start = html.indexOf(`${marker}{`);
  if (start < 0) return null;
  const i = start + marker.length;
  let depth = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === "{") depth++;
    else if (html[j] === "}" && --depth === 0) return JSON.parse(html.slice(i, j + 1));
  }
  return null;
}

// Tuotekoodit kauppojen väliseen yhdistämiseen: ean = EAN/GTIN ilman etunollia, mpn = valmistajan koodi (esim. MK2D4QN/A).
const normEan = (e) => String(e || "").replace(/\D/g, "").replace(/^0+/, "");
export const codes = (ean, mpn) => ({
  ean: [...new Set([].concat(ean || []).map(normEan).filter((e) => e.length >= 8))],
  mpn: [...new Set([].concat(mpn || []).map((m) => String(m).trim().toUpperCase()).filter((m) => m.length >= 4))],
});

// Yhteinen muoto: web = verkkokaupan tilanne, shops = myymälät (nimi, paikkakunta, saldo).
// available = saatavilla jossain, detail = lyhyt yhteenveto. Säderajaus tehdään lib/geo.js:ssä.
function withShops(base, web, shops) {
  const open = (shops || []).filter((x) => x.available);
  const parts = [web && (!web.available ? "verkossa loppu" : web.stock != null ? `verkossa ${web.stock} kpl` : "verkossa saatavilla")];
  // Yksi tai kaksi myymälää nimetään, jotta tuotesivulta näkee suoraan, missä tuote on (esim. "myymälässä Somero").
  const where = open.length <= 2 && open.every((x) => x.city) ? `myymälässä ${open.map((x) => x.city).join(", ")}` : `${open.length} myymälässä`;
  if (shops) parts.push(open.length ? where : "myymälöissä loppu");
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
      price: Number([].concat(ld.offers)[0]?.price), codes: codes(ld.gtin13 || ld.gtin, ld.mpn),
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
  async search(q, n = 8) {
    const d = await get(`https://www.power.fi/api/v2/productlists?q=${encodeURIComponent(q)}&size=${n}`);
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
    return withShops({ ...powerItem(p), codes: codes(null, p.productManufactorIdentity) }, { available: p.stockCount > 0, stock: p.stockCount }, shops);
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
      url: `https://www.prisma.fi/tuotteet/${id}`, price: Number(offer.price), codes: codes(ld.gtin13, ld.name?.match(/\b[A-Z0-9]{5}[A-Z]{2}\/A\b/)?.[0]),
    }, { available: av ? av.ecomQuantity > 0 : /InStock|LimitedAvailability/.test(offer.availability || ""), stock: av?.ecomQuantity }, shops);
  },
};

// Telialla ei ole avointa hakua, joten sitä käytetään vain katalogin kautta.
// id = "<slug>~<varianttiId>", esim. "apple-iphone-duo~9149131". Data on Next.js-sivun RSC-payloadissa.
// Mallin kaikki värit ja koot ovat samalla sivulla, joten sivu muistetaan hetken (cron tarkistaa variantit kerralla).
const teliaPages = new Map();
function teliaPage(slug) {
  const hit = teliaPages.get(slug);
  if (hit && Date.now() - hit.at < 30000) return hit.page;
  const page = get(`https://www.telia.fi/kauppa/tuote/${slug}`, "html").then((h) => h.replace(/\\"/g, '"'));
  teliaPages.set(slug, { at: Date.now(), page });
  page.catch(() => teliaPages.delete(slug));
  return page;
}
const telia = {
  name: "Telia",
  async search() { return []; },
  async check(id) {
    const [slug, vid] = id.split("~");
    const html = await teliaPage(slug);
    const av = html.match(new RegExp(`"availability":\\[\\{"id":"${vid}"[^}]*\\}`))?.[0];
    const at = html.indexOf(`{"id":"${vid}","sku"`);
    if (!av || at < 0) throw new Error("Telia: varianttia ei löytynyt");
    const variant = html.slice(at, at + 5000);
    const state = av.match(/"state":"(\w+)"/)?.[1];
    const future = av.match(/"futureAvailabilityDate":"\$D([\d-]+)/)?.[1];
    const web = state === "AVAILABLE";
    const shops = av.match(/"storeAvailabilityState":"(\w+)"/)?.[1] === "AVAILABLE";
    const available = web || shops;
    // Sivun otsikko on vain oletusvariantilla, muille nimi kootaan mallista, koosta ja väristä ("iPhone Duo 256 Gt Yötaivas").
    const color = variant.match(/"variant1":\{"contentType":"VariantStyleOption"[^}]*"variantName":"([^"]+)"/)?.[1];
    const size = variant.match(/"variant2":\{[^}]*"variantName":"([^"]+)"/)?.[1];
    const model = variant.match(/"pricing":\{"id":"\d+","name":"([^"]+)"/)?.[1]?.replace(/\s*\([^)]*\)/g, "").trim();
    return {
      store: "telia", id, color, codes: codes(html.match(new RegExp(`"sapId":"${vid}","ean":"(\\d+)"`))?.[1], variant.match(/"sku":"([^"]+)"/)?.[1]),
      name: html.match(new RegExp(`"${vid}","highlights":\\[[^\\]]*\\],"pageTitle":"([^"]+)"`))?.[1] || (model ? [model, size, color].filter(Boolean).join(" ") : slug),
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
    // Väri on vain variantin nimessä ("iPhone Duo 256 Gt 5G Tähdenkajo" vs. malli "iPhone Duo 256 Gt 5G").
    const cat = (label) => p.productCategories?.find((c) => c.label === label)?.value || "";
    const color = cat("model") && cat("variant").startsWith(cat("model")) ? cat("variant").slice(cat("model").length).trim() : "";
    return withShops({
      store: "elisa", id: ref, name: [p.fullName, color].filter(Boolean).join(" "), color: color || undefined, price: p.lowestPrice?.price ?? (p.paymentOptions?.length ? Math.round(Math.max(...p.paymentOptions.map((o) => o.totalPrice || 0))) : null),
      image: p.defaultImage ? "https:" + String(p.defaultImage).replace(/^https?:/, "") : null,
      url: `https://elisa.fi/kauppa/tuote/${slug}`, codes: codes(p.ean),
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
    // id = "<slug>" tai "<slug>~<koodi>". Ilman koodia se luetaan sivulta (backendSystemCode).
    const [slug, given] = id.split("~");
    const url = `https://kauppa.dna.fi/tuote/p/${slug}`;
    const html = await get(url, "html");
    const sku = given || html.replace(/\\"/g, '"').match(/"backendSystemCode":"([^"]+)"/)?.[1];
    const q = new URLSearchParams({
      operationName: "GetClickAndCollectDetails", variables: JSON.stringify({ backendSystemCode: sku }),
      extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: DNA_CC_HASH } }),
    });
    const cc = sku ? await fetch(`https://kauppa.dna.fi/graphql?${q}`, { headers: { "User-Agent": UA, "x-apollo-operation-name": "GetClickAndCollectDetails", "content-type": "application/json" }, signal: AbortSignal.timeout(20000) })
      .then((r) => r.json()).catch(() => null) : null;
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
      image: html.match(/og:image" content="([^"]+)/)?.[1] || null, codes: codes(ld.gtin13, sku),
    }, { available: /InStock|LimitedAvailability/.test(offer.availability || "") }, shops);
  },
};

// C&C (Apple Premium Partner): vain katalogin kautta. id = tuotteen slug shop.cec.fi:ssä, esim. "iphone-duo-256gb-star-white".
// Tuotesivun taulukossa on tila per myymälä ("Heti Saatavilla" / "Tilattavissa"). Keskusvarasto = verkkokauppa.
const cec = {
  name: "C&C",
  async search() { return []; },
  async check(id) {
    const url = `https://shop.cec.fi/${id}/`;
    const html = await get(url, "html");
    const ld = jsonLdProduct(html);
    if (!ld) throw new Error("C&C: tuotetietoja ei löytynyt");
    const offer = [].concat(ld.offers)[0] || {};
    const unesc = (t) => t.replace(/&amp;/g, "&").trim();
    const rows = [...html.matchAll(/partner-name">([^<]*)<\/td>\s*<td class="partner-status">\s*<div class="([^"]*)">\s*([^<]*)</g)]
      .map(([, n, cls, txt]) => ({ name: unesc(n), available: /saatavilla|varastossa/i.test(txt) && !/alert/.test(cls) }));
    const web = rows.find((r) => r.name === "Keskusvarasto");
    const shops = rows.filter((r) => r !== web).map((r) => ({ ...r, city: r.name.match(/Tampere|Turku|Oulu|Espoo|Vantaa/)?.[0] || "Helsinki", stock: null }));
    const image = [].concat(ld.image)[0];
    return withShops({
      store: "cec", id, url, name: ld.name, price: Number(offer.price) || null,
      image: image ? new URL(image, url).href : null, codes: codes(ld.gtin13, ld.sku),
    }, { available: web ? web.available : /InStock/.test(offer.availability || "") }, rows.length ? shops : null);
  },
};

// Kärkkäinen: vain katalogin kautta. id = "<slug>~<partNumber>", esim. "nintendo-switch-2-pelikonsoli~103697797".
// HCL Commerce -alustan REST: verkkokaupan ja kaikkien myymälöiden saldot yhdellä kutsulla.
const K_API = "https://www.karkkainen.com/wcs/resources/store/10151";
const karkkainen = {
  name: "Kärkkäinen",
  async search() { return []; },
  async check(id) {
    const [slug, part] = id.split("~");
    const url = `https://www.karkkainen.com/verkkokauppa/${slug}`;
    const locator = await get(`${K_API}/storelocator/byLocation?siteLevelStoreSearch=true&type=COUNTRY&country=Suomi`);
    const stores = locator.dataList.flatMap((x) => x.PhysicalStore || []);
    const names = stores.map((x) => x.storeName).join(",");
    const [inv, html] = await Promise.all([
      get(`${K_API}/inventoryavailability/byPartNumber/${part}?onlineStoreId=10151&physicalStoreName=${names}`),
      get(url, "html"),
    ]);
    const ld = jsonLdProduct(html);
    if (!ld) throw new Error("Kärkkäinen: tuotetietoja ei löytynyt");
    const rows = inv.InventoryAvailability || [];
    const qty = (r) => Math.floor(Number(r?.availableQuantity) || 0);
    const web = rows.find((r) => r.onlineStoreId);
    const shops = stores.map((x) => {
      const r = rows.find((y) => y.physicalStoreName === x.storeName);
      return { name: `Kärkkäinen ${x.city}`, city: x.city, zip: x.postalCode?.trim(), stock: qty(r), available: qty(r) > 0 };
    });
    const offer = [].concat(ld.offers)[0] || {};
    return withShops({
      store: "karkkainen", id, url, name: ld.name, price: Number(offer.price) || null, image: [].concat(ld.image)[0] || null, codes: codes(ld.gtin13),
    }, { available: qty(web) > 0, stock: qty(web) }, shops);
  },
};

// Veikon Kone: Klevu-haku (sama kuin sivuston haku). id = EAN, esim. "195951406022".
// Myymäläkohtaiset saldot luetaan tuotesivun clickAndCollectData-kentästä. Klevun myymälöiden yhteistila on vain varalla,
// koska se ei kerro myymälää ja päivittyy hakuindeksin mukana viiveellä.
const KLEVU = "https://eucs27.ksearchnet.com/cloud-search/n-search/search?ticket=klevu-163410346929414343&paginationStartsFrom=0&responseType=json";
const vkInStock = (x) => /in_stock|low_stock/.test(x || "");
// Tuotenimessä ei ole väriä, joten se lisätään Klevun värikentästä (tech_vari).
const veikonItem = (p) => ({
  store: "veikonkone", id: p.sku.split(";").pop(), name: [p.name, p.tech_vari].filter(Boolean).join(", "), color: p.tech_vari || undefined,
  price: Number(p.salePrice) || null, image: p.imageUrl || p.image || null, url: p.url,
});
const veikonkone = {
  name: "Veikon Kone",
  async search(q, n = 8) {
    const d = await get(`${KLEVU}&noOfResults=${n}&term=${encodeURIComponent(q)}`);
    return (d.result || []).filter((p) => /^\d{8,14}$/.test(p.sku.split(";").pop())).map(veikonItem);
  },
  async check(id) {
    const d = await get(`${KLEVU}&noOfResults=10&term=${encodeURIComponent(id)}`);
    const p = (d.result || []).find((x) => x.sku.split(";").pop() === id);
    if (!p) throw new Error("Veikon Kone: tuotetta ei löytynyt");
    // Klevun "low_stock" voi tarkoittaa myös ennakkomyyntiä, joten verkkosaatavuus luetaan tuotesivun
    // stockStatusData-kentästä (in_stock / order_product = tilaustuote / out_of_stock / only_ship_from_store).
    const child = String(p.id).split("-").pop();
    const html = await get(p.url, "html");
    const data = html.match(/stockStatusData: (\{.*?\}\}),\n/)?.[1];
    const status = data ? JSON.parse(data)[child]?.stock_status : null;
    const webAvailable = status ? /^(in_stock|only_ship_from_store)$/.test(status) : p.webStock === "in_stock";
    const sources = extractObject(html, "clickAndCollectData", "clickAndCollectData: ")?.[child]?.sources;
    const shops = sources
      ? Object.values(sources).map((x) => ({ name: x.label, city: x.city, zip: x.postcode, stock: Number(x.qty) || 0, available: Number(x.qty) > 0 }))
      : [{ name: "Veikon Kone myymälät", city: null, stock: null, available: vkInStock(p.storeStock) }];
    const mpn = /^[A-Z0-9][A-Z0-9/-]{4,}$/.test(p.tech_tyyppi_uusi || "") ? p.tech_tyyppi_uusi : null;
    const item = withShops({ ...veikonItem(p), codes: codes(id, mpn) }, { available: webAvailable }, shops);
    if (status === "order_product") item.detail = "tilaustuote, " + item.detail.replace("verkossa loppu, ", "");
    return item;
  },
};

// Multitronic: vain katalogin kautta. id = tuotenumero, esim. "4630035". Myymäläsaldot ovat tuotesivun tekstissä
// muodossa "Multitronic Vaasa: 0 kpl", verkkosaatavuus schema.org-datassa.
const multitronic = {
  name: "Multitronic",
  async search() { return []; },
  async check(id) {
    const url = `https://www.multitronic.fi/fi/products/${id}`;
    const html = await get(url, "html");
    const ld = jsonLdProduct(html);
    if (!ld) throw new Error("Multitronic: tuotetietoja ei löytynyt");
    const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
      .replace(/&([aoAO])uml;/g, (_, c) => ({ a: "ä", o: "ö", A: "Ä", O: "Ö" })[c]).replace(/&aring;/g, "å").replace(/&Aring;/g, "Å");
    const seen = new Map();
    for (const [, city, n] of text.matchAll(/Multitronic ([A-ZÅÄÖ][a-zåäö]+(?: [A-ZÅÄÖ][a-zåäö]+)?): (\d+) kpl/g)) seen.set(city, Number(n));
    const shops = [...seen].map(([city, n]) => ({ name: `Multitronic ${city}`, city, stock: n, available: n > 0 }));
    const offer = [].concat(ld.offers)[0] || {};
    return withShops({
      store: "multitronic", id, url, name: ld.name, price: Number(offer.price) || null, image: [].concat(ld.image)[0] || null,
      codes: codes(ld.gtin13, ld.mpn || html.match(/ID: ([A-Z0-9]{4,}\/[A-Z])/)?.[1]),
    }, { available: /InStock|LimitedAvailability/.test(offer.availability || "") }, shops.length ? shops : null);
  },
};

export const STORES = { verkkokauppa, power, prisma, telia, elisa, dna, cec, karkkainen, veikonkone, multitronic };

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

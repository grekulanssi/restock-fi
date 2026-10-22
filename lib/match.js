import { STORES, rank } from "./stores.js";

// Yhdistää saman tuotteen kaikkiin kauppoihin, joissa haku onnistuu tuotekoodilla tai nimellä.
// Jokainen ehdokas varmistetaan kaupan omalla check()-tuloksella: EAN tai valmistajan koodi (mpn) täsmää.
// Telia, Elisa, DNA ja C&C ovat mukana vain katalogin kautta, koska niiden haku ei toimi palvelimelta.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const fetchJson = (url, opts = {}) =>
  fetch(url, { ...opts, headers: { "User-Agent": UA, ...opts.headers }, signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const ean13 = (e) => e.padStart(13, "0");
const nameQuery = (n) => String(n || "")
  .replace(/\b[A-Z0-9]{4,}\/[A-Z]\b/g, " ").replace(/\([^)]*\)|\s-\s.*$|,.*$/g, " ").replace(/-(puhelin|pelikonsoli)/gi, " $1")
  .replace(/\s+/g, " ").trim();

// Valmistajan koodi on varma tunniste vain, jos siinä on sekä kirjaimia että numeroita (esim. MK2D4QN/A).
// Lyhyt numerokoodi (Nintendon "220001" on myös erään SCART-kaapelin koodi) vaatii lisäksi samankaltaisen nimen.
const strongMpn = (m) => /[A-Z]/.test(m) && /\d/.test(m) && m.length >= 6;
const words = (n) => new Set(String(n || "").toLowerCase().split(/[^a-z0-9åäö]+/).filter((w) => (w.length > 1 || /\d/.test(w)) && !["gt", "gb", "tt", "tb", "ja", "the", "apple"].includes(w)));
const nameOverlap = (a, b) => { const A = words(a), B = words(b); return [...A].filter((w) => B.has(w)).length / Math.max(1, Math.min(A.size, B.size)); };
// Kun kummallakaan ei ole vertailukelpoista koodia, hyväksytään lähes sama nimi ja samaa luokkaa oleva hinta.
// Ristiriita lähteen omiin koodeihin (eri vahva valmistajan koodi tai eri EAN) = eri tuote, vaikka nimi täsmäisi
// (esim. AirPods 5 MKFW4DN/A vs. AirPods 5 langattomalla kotelolla MKFT4DN/A).
function same(a, b, src, hit) {
  if (a.ean.some((e) => b.ean.includes(e))) return true;
  const shared = a.mpn.filter((m) => b.mpn.includes(m));
  if (shared.some(strongMpn)) return true;
  const own = src.codes || { ean: [], mpn: [] };
  if (own.mpn.some(strongMpn) && b.mpn.some(strongMpn)) return false;
  if (own.ean.length && b.ean.length && !shared.length) return false;
  const overlap = nameOverlap(src.name, hit.name);
  if (shared.length > 0 && overlap >= 0.6) return true;
  const priceOk = src.price && hit.price && hit.price / src.price > 0.8 && hit.price / src.price < 1.25;
  return overlap >= 0.85 && priceOk;
}

// Ehdokkaiden haku kaupoittain: palauttaa listan tuotetunnuksia, jotka check() varmistaa.
const FINDERS = {
  async power({ ean, mpn }) {
    const ids = [];
    for (const q of [...mpn.map((m) => m.replace(/\/[A-Z]$/, "")), ...ean]) {
      const d = await fetchJson(`https://www.power.fi/api/v2/productlists?q=${encodeURIComponent(q)}&size=3`);
      ids.push(...(d?.products || []).map((p) => String(p.productId)));
      if (ids.length) break;
    }
    return ids;
  },
  async prisma({ ean }) {
    for (const q of ean.flatMap((e) => [ean13(e), e.padStart(12, "0")])) {
      const d = await fetchJson(`https://storefront-api.prisma.fi/search/quick-search-constructor?searchTerm=${q}`);
      if (d?.products?.length) return d.products.slice(0, 3).map((p) => p.sokId);
    }
    return [];
  },
  async veikonkone({ ean }) {
    if (!ean[0]) return [];
    const hits = await STORES.veikonkone.search(ean[0]).catch(() => []);
    return hits.filter((h) => h.id.replace(/^0+/, "") === ean[0]).map((h) => h.id).slice(0, 1);
  },
  async multitronic({ ean, mpn }) {
    const q = ean[0] ? ean13(ean[0]) : mpn[0];
    if (!q) return [];
    const r = await fetch("https://www.multitronic.fi/fi/search/getfiltersanddata/id/null", {
      method: "POST", body: new URLSearchParams({ lang: "fi", c: "search", keywords: q }),
      headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
      signal: AbortSignal.timeout(15000),
    }).then((x) => x.text()).catch(() => "");
    return [...new Set([...r.matchAll(/\/fi\/products\/(\d+)\//g)].map((m) => m[1]))].slice(0, 2);
  },
  async verkkokauppa({ ean }, names) {
    let hits = [];
    for (const n of names) {
      hits = rank(await STORES.verkkokauppa.search(nameQuery(n)).catch(() => []), nameQuery(n));
      if (hits.some((h) => ean.includes(String(h.ean || "").replace(/^0+/, "")))) break;
    }
    const byEan = hits.filter((h) => ean.includes(String(h.ean || "").replace(/^0+/, "")));
    return (byEan.length ? byEan : hits.slice(0, 3)).map((h) => h.id);
  },
  async karkkainen(_, names) {
    const d = await fetchJson(`https://www.karkkainen.com/search/resources/api/v2/products?storeId=10151&searchTerm=${encodeURIComponent(nameQuery(names[0]))}&langId=-11&limit=4`);
    const ids = await Promise.all((d?.contents || []).map(async (p) => {
      const item = p["relationship.item.id"] || p.id;
      const inv = await fetchJson(`https://www.karkkainen.com/wcs/resources/store/10151/inventoryavailability/${item}?onlineStoreId=10151`);
      const part = inv?.InventoryAvailability?.[0]?.partNumber;
      return part && p.seo?.href ? `${p.seo.href.replace(/^\//, "")}~${part}` : null;
    }));
    return ids.filter(Boolean);
  },
};

// Lähdetuote (kauppa + id) -> sama tuote kaikissa kaupoissa, joista se löytyy. Lähde on listan ensimmäinen.
// Kaksi kierrosta: osumista kerätyillä lisäkoodeilla (esim. EAN, kun lähteellä oli vain valmistajan koodi)
// haetaan uudelleen ne kaupat, joista ei vielä löytynyt mitään.
export async function matchAll(store, id) {
  const source = await STORES[store].check(id);
  const c = { ean: [...(source.codes?.ean || [])], mpn: [...(source.codes?.mpn || [])] };
  const found = new Map([[store, source]]);
  for (let round = 0; round < 2; round++) {
    const todo = Object.entries(FINDERS).filter(([s]) => !found.has(s));
    const hits = await Promise.all(todo.map(async ([s, find]) => {
      const names = [source.name, ...[...found.values()].map((f) => f.name)];
      let ids = await find(c, names).catch(() => []);
      // Koodihaku ei tuottanut mitään: kokeillaan kaupan omaa nimihakua (varmistus estää väärät osumat).
      if (!ids.length && STORES[s].search && s !== "verkkokauppa") {
        ids = rank(await STORES[s].search(nameQuery(names[0])).catch(() => []), nameQuery(names[0])).slice(0, 3).map((h) => h.id);
      }
      for (const cid of ids) {
        const hit = await STORES[s].check(cid).catch(() => null);
        if (hit?.codes && same(c, hit.codes, source, hit)) return [s, hit];
      }
      return null;
    }));
    const before = found.size;
    for (const h of hits.filter(Boolean)) {
      found.set(h[0], h[1]);
      for (const e of h[1].codes.ean) if (!c.ean.includes(e)) c.ean.push(e);
    }
    if (found.size === before) break;
  }
  return [...found.values()];
}

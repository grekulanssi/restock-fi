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

// Operaattoreilla ei ole palvelimelta toimivaa hakua, joten tuotesivun osoite päätellään nimestä
// (Telia: "apple-iphone-duo", "playstation-5-pro"), haetaan sivukartasta (Elisa) tai kategoriasivuilta (DNA).
const slugify = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\([^)]*\)/g, " ").replace(/(\d)(gb|gt|tb|tt)\b/g, "$1 $2").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const COLORS = /^(musta|valkoinen|hopea|kulta|sininen|punainen|vihrea|harmaa|tahdenkajo|yotaivas|viininpunainen|jaatikko|mustansininen|tahtivalkea|white|black|silver)$/;
const slugWords = (n) => slugify(nameQuery(n)).split("-").filter((w) => w && !COLORS.test(w));
// Pisteet: kuinka suuri osa osoitteen sanoista selittyy tuotenimellä (vähintään 2 yhteistä sanaa). Lopullinen varmistus tehdään EAN:lla.
const overlap = (slug, n) => {
  const S = slug.split("-").filter((w) => !COLORS.test(w)), W = new Set(slugWords(n));
  const hit = S.filter((w) => W.has(w)).length;
  return hit >= 2 ? hit / S.length : 0;
};
const pageOk = (url) => fetch(url, { method: "HEAD", headers: { "User-Agent": UA }, redirect: "manual", signal: AbortSignal.timeout(8000) }).then((r) => r.status === 200).catch(() => false);
const fetchText = (url) => fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
const cache = {};
const once = (key, fn) => (cache[key] ||= fn().catch(() => []));
const elisaSlugs = () => once("elisa", async () => [...(await fetchText("https://elisa.fi/kauppa/sitemap.xml")).matchAll(/kauppa\/tuote\/([a-z0-9-]+)</g)].map((m) => m[1]));
const DNA_CATS = ["puhelimet-ja-lisalaitteet/puhelimet", "pelaaminen/pelikonsolit", "pelaaminen", "aanentoisto/kuulokkeet", "tabletit-ja-lisalaitteet/tabletit"];
const dnaSlugs = () => once("dna", async () => [...new Set((await Promise.all(DNA_CATS.map((c) => fetchText(`https://kauppa.dna.fi/laitteet/${c}`))))
  .flatMap((h) => [...h.matchAll(/\/tuote\/p\/([a-z0-9-]+)/g)].map((m) => m[1])))]);
const best = (slugs, names, n = 3) => slugs.map((sl) => [sl, Math.max(...names.map((nm) => overlap(sl, nm)))])
  .filter(([, sc]) => sc >= 0.5).sort((a, b) => b[1] - a[1]).slice(0, n).map(([sl]) => sl);

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
  async telia(c, names) {
    // Mallin sivu: nimen alkuosa, esim. "apple-iphone-duo" tai "playstation-5-pro". Väri ja koko valitaan sivun varianteista.
    const guesses = [...new Set(names.flatMap((n) => {
      const w = slugify(nameQuery(n)).split("-").filter((x) => x && !COLORS.test(x) && !/^\d+$|^(gt|tt|gb|tb|5g)$/.test(x) || /^\d$/.test(x));
      return [3, 4, 2].map((k) => w.slice(0, k).join("-")).concat([3, 4].map((k) => w.slice(1, k + 1).join("-")));
    }))].filter((g) => g.split("-").length >= 2);
    for (const g of guesses) {
      if (!(await pageOk(`https://www.telia.fi/kauppa/tuote/${g}`))) continue;
      const html = (await fetchText(`https://www.telia.fi/kauppa/tuote/${g}`)).replace(/\\"/g, '"');
      const vids = [...html.matchAll(/"sapId":"(\d+)","ean":"(\d+)"/g)].filter(([, , e]) => c.ean.includes(e.replace(/^0+/, ""))).map((m) => m[1]);
      const bySku = [...html.matchAll(/\{"id":"(\d+)","sku":"([^"]+)"/g)].filter(([, , sku]) => c.mpn.includes(sku.toUpperCase())).map((m) => m[1]);
      const ids = [...new Set([...vids, ...bySku])].map((v) => `${g}~${v}`);
      if (ids.length) return ids;
    }
    return [];
  },
  async elisa(c, names) {
    for (const slug of best(await elisaSlugs(), names, 3)) {
      const html = await fetchText(`https://elisa.fi/kauppa/tuote/${slug}`);
      const n = Number(html.match(/"sku":"HANDSET-(\d+)"/)?.[1]);
      if (!n) continue;
      // Värivariantit ovat lähekkäisillä tunnuksilla: haetaan ympäristö kerralla ja valitaan oikea EAN.
      const uids = Array.from({ length: 31 }, (_, i) => `uid=HANDSET-${n - 15 + i}`).join("&");
      const list = (await fetchJson(`https://elisa.fi/kauppa/rest/products?${uids}`)) || [];
      const hit = list.find((p) => c.ean.includes(String(p.ean || "").replace(/^0+/, "")));
      if (hit) return [`${slug}~${hit.uid.split("-")[1]}`];
    }
    return [];
  },
  async dna(c, names) {
    // Applen puhelimilla osoitteen voi muodostaa (apple-iphone-duo-5g-256-gt-yotaivas), muuten kategoriasivuilta.
    const guesses = names.flatMap((n) => {
      const m = slugify(n).match(/^(?:apple-)?iphone-([a-z0-9-]+?)-(\d+)-(gt|gb|tt|tb)(?:-5g)?-(.+)$/);
      return m ? [`apple-iphone-${m[1]}-5g-${m[2]}-${m[3] === "gb" ? "gt" : m[3]}-${m[4].replace(/-?5g-?/, "")}`] : [];
    });
    const ok = [];
    for (const g of [...new Set(guesses)]) if (await pageOk(`https://kauppa.dna.fi/tuote/p/${g}`)) ok.push(g);
    return ok.length ? ok : best(await dnaSlugs(), names, 3);
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
      for (const m of h[1].codes.mpn) if (!c.mpn.includes(m)) c.mpn.push(m);
    }
    if (found.size === before) break;
  }
  return [...found.values()];
}

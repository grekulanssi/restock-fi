import { STORES, rank } from "./stores.js";

// Yhdistää saman tuotteen kaikkiin kauppoihin, joissa haku onnistuu tuotekoodilla tai nimellä.
// Jokainen ehdokas varmistetaan kaupan omalla check()-tuloksella: EAN tai valmistajan koodi (mpn) täsmää.
// C&C on mukana vain katalogituotteissa, koska sen haku ei toimi palvelimelta.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const fetchJson = (url, opts = {}) =>
  fetch(url, { ...opts, headers: { "User-Agent": UA, ...opts.headers }, signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const ean13 = (e) => e.padStart(13, "0");
const nameQuery = (n) => String(n || "")
  .replace(/\b[A-Z0-9]{4,}\/[A-Z]\b/g, " ").replace(/\([^)]*\)|\s-\s.*$|,.*$/g, " ").replace(/-(puhelin|pelikonsoli)/gi, " $1")
  .replace(/\s+/g, " ").trim();

// Valmistajan koodi on varma tunniste vain, jos siinä on sekä kirjaimia että numeroita (esim. MK2D4QN/A).
// Lyhyt numerokoodi (Nintendon "220001" on myös erään SCART-kaapelin koodi) vaatii lisäksi samankaltaisen nimen.
export const strongMpn = (m) => /[A-Z]/.test(m) && /\d/.test(m) && m.length >= 6;
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
export const slugify = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\([^)]*\)/g, " ").replace(/(\d)(gb|gt|tb|tt)\b/g, "$1 $2").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const COLORS = new RegExp(`^(${[
  "musta", "valkoinen", "hopea", "kulta", "sininen", "punainen", "vihrea", "harmaa", "keltainen", "oranssi", "pinkki", "roosa", "violetti", "liila",
  "laventeli", "turkoosi", "beige", "ruskea", "grafiitti", "titaani", "vaalea", "tumma", "syva", "kosminen", "vaaleanpunainen", "vaaleansininen",
  "tummansininen", "syvansininen", "mustansininen", "sinivihrea", "taivaansininen", "ultramariini", "salvia", "oliivinvihrea", "mintunvihrea",
  "tahdenkajo", "yotaivas", "viininpunainen", "jaatikko", "tahtivalkea", "tahtivalo", "keskiyo", "avaruusharmaa", "poudanvalkea", "luonnontitaani",
  "mustatitaani", "valkotitaani", "sinititaani", "aavikkotitaani", "jaansininen", "white", "black", "silver", "gold", "blue", "red", "green", "grey", "gray", "pink",
  "purple", "yellow", "orange", "graphite", "titanium", "midnight", "starlight",
].join("|")})$`);
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
// Telian mallisivu: nimen alkuosa, esim. "apple-iphone-duo" tai "playstation-5-pro". Väri ja koko valitaan sivun varianteista.
// Tarkin arvaus ensin, jotta "apple-iphone-18-pro" ei jää "apple-iphone-18":n taakse. Tallennustila ja väri jäävät pois.
const unit = /^(gt|tt|gb|tb)$/;
const prefixes = (w) => Array.from({ length: Math.min(w.length, 5) - 1 }, (_, i) => w.slice(0, Math.min(w.length, 5) - i).join("-"));
async function* teliaPages(names) {
  const guesses = [...new Set(names.flatMap((n) => {
    const w = slugify(nameQuery(n)).split("-").filter((x, i, a) => x && !COLORS.test(x) && !unit.test(x) && x !== "5g" && !unit.test(a[i + 1] || ""));
    return [...prefixes(w), ...prefixes(w.slice(1))];
  }))];
  for (const g of guesses) if (await pageOk(`https://www.telia.fi/kauppa/tuote/${g}`)) yield g;
}
const teliaHtml = (slug) => fetchText(`https://www.telia.fi/kauppa/tuote/${slug}`).then((h) => h.replace(/\\"/g, '"'));
// Multitronicin haku palauttaa HTML:ää: [[tuotenumero, slug], ...].
async function multitronicSearch(q) {
  const r = await fetch("https://www.multitronic.fi/fi/search/getfiltersanddata/id/null", {
    method: "POST", body: new URLSearchParams({ lang: "fi", c: "search", keywords: q }),
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
    signal: AbortSignal.timeout(15000),
  }).then((x) => x.text()).catch(() => "");
  return [...new Map([...r.matchAll(/\/fi\/products\/(\d+)\/([a-z0-9-]+)/g)].map((m) => [m[1], m[2]]))];
}
// Kärkkäisen tunnus (partNumber) haetaan saldorajapinnasta. keep rajaa hakutulokset nimen perusteella ennen sitä.
async function karkkainenIds(q, keep = () => true, limit = 4) {
  const d = await fetchJson(`https://www.karkkainen.com/search/resources/api/v2/products?storeId=10151&searchTerm=${encodeURIComponent(q)}&langId=-11&limit=${limit}`);
  const ids = await Promise.all((d?.contents || []).filter((p) => keep({ name: p.name })).map(async (p) => {
    const item = p["relationship.item.id"] || p.id;
    const inv = await fetchJson(`https://www.karkkainen.com/wcs/resources/store/10151/inventoryavailability/${item}?onlineStoreId=10151`);
    const part = inv?.InventoryAvailability?.[0]?.partNumber;
    return part && p.seo?.href ? `${p.seo.href.replace(/^\//, "")}~${part}` : null;
  }));
  return ids.filter(Boolean);
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
    return (await multitronicSearch(q)).map(([id]) => id).slice(0, 2);
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
    for await (const g of teliaPages(names)) {
      const html = await teliaHtml(g);
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
  karkkainen: (_, names) => karkkainenIds(nameQuery(names[0])),
};

// Lähdetuote (kauppa + id) -> sama tuote kaikissa kaupoissa, joista se löytyy. Lähde on listan ensimmäinen.
// Kaksi kierrosta: osumista kerätyillä lisäkoodeilla (esim. EAN, kun lähteellä oli vain valmistajan koodi)
// haetaan uudelleen ne kaupat, joista ei vielä löytynyt mitään.
export async function matchAll(store, id, source) {
  source ||= await STORES[store].check(id);
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

// --- Saman mallin kaikki värit (seuranta "Mikä tahansa väri") ---

// Mallin tunniste ilman väriä: "Apple iPhone Duo 256 Gt puhelin, yötaivas" ja "APPLE IPHONE DUO 256GB ÄLYPUHELIN" -> "256gb duo iphone".
// Valmistajan koodi, värisanat ja täytesanat jäävät pois, tallennustila kirjoitetaan aina samoin.
const MPN = /\b[A-Z0-9]{4,}\/[A-Z]\b/g;
const FILLER = /^(apple|puhelin|alypuhelin|matkapuhelin|5g|pelikonsoli)$/;
const modelWords = (n) => slugify(String(n || "").replace(MPN, " ")).replace(/(\d+)-(gb|gt)\b/g, "$1gb").replace(/(\d+)-(tb|tt)\b/g, "$1tb")
  .split("-").filter((w) => w && !COLORS.test(w) && !FILLER.test(w));
export const modelKey = (n) => modelWords(n).sort().join(" ");
// Kaupan oma värikenttä (Telia, Elisa, Veikon Kone) poistetaan nimestä, jotta myös tuntematon värinimi ("Jäänsininen") jää pois.
const keyOf = (o) => modelKey(o.color ? String(o.name).split(o.color).join(" ") : o.name);
const storage = (key) => key.split(" ").filter((w) => /^\d+(gb|tb)$/.test(w)).join(" ");
// Lyhyt hakusana ilman tallennustilaa ("iphone duo"), koska osa hauista ei löydä mitään koko nimellä.
const shortQuery = (n) => modelWords(n).filter((w) => !/^\d+(gb|tb)$/.test(w)).join(" ");
// Nimi ilman väriä ja koodia: "Apple iPhone Duo 256GB yötaivas - MK2E4QN/A" -> "Apple iPhone Duo 256GB".
export const modelName = (n) => String(n || "").replace(MPN, " ").split(/\s+/).filter((w) => !COLORS.test(slugify(w))).join(" ")
  .replace(/\s+-(?=\s|$)/g, "").replace(/,(?=\s*(,|$))/g, "").replace(/\s+/g, " ").trim();
export const colorOf = (o) => (o.color || String(o.name || "").split(/[\s,()/-]+/).filter((w) => COLORS.test(slugify(w))).join(" ")).toLowerCase();

// Väriversio: sama nimi värisanoja lukuun ottamatta, sama tallennustila kuin lähteellä ja samaa luokkaa oleva hinta.
// Nimeä verrataan lähteeseen ja saman kaupan koodeilla löydettyyn tuotteeseen, koska kauppa nimeää värit samalla kaavalla.
function sameModel(refs, src, hit) {
  const key = keyOf(hit);
  if (key.split(" ").length < 2 || storage(key) !== storage(keyOf(src))) return false;
  const priceOk = !src.price || !hit.price || (hit.price / src.price > 0.8 && hit.price / src.price < 1.25);
  return priceOk && refs.some((r) => keyOf(r) === key);
}

// Kaupat, joissa mallin värit luetaan suoraan: Telian mallisivun variantit, Elisan saman ryhmän (groupId) laitteet
// ja DNA:n tuotesivun värivalitsin. ref = saman kaupan koodeilla löydetty tuote, jos sellainen on.
const VARIANTS = {
  async telia(ref, names) {
    const slugs = ref ? [ref.id.split("~")[0]] : [];
    if (!ref) for await (const g of teliaPages(names)) { slugs.push(g); break; }
    const html = slugs[0] ? await teliaHtml(slugs[0]) : "";
    return [...html.matchAll(/\{"id":"(\d+)","sku":"[^"]*","slug":"([a-z0-9-]+)"/g)].map((m) => `${m[2]}~${m[1]}`);
  },
  async elisa(ref, names) {
    const nums = ref ? [Number(ref.id.split("~")[1])] : await Promise.all(best(await elisaSlugs(), names, 3)
      .map(async (slug) => Number((await fetchText(`https://elisa.fi/kauppa/tuote/${slug}`)).match(/"sku":"HANDSET-(\d+)"/)?.[1])));
    for (const n of nums.filter(Boolean)) {
      const uids = Array.from({ length: 49 }, (_, i) => `uid=HANDSET-${n - 24 + i}`).join("&");
      const list = (await fetchJson(`https://elisa.fi/kauppa/rest/products?${uids}`)) || [];
      const group = list.find((p) => p.uid === `HANDSET-${n}`)?.groupId;
      const ids = list.filter((p) => group && p.groupId === group).map((p) => `${p.urlKey}~${p.uid.split("-")[1]}`);
      if (ids.length) return ids;
    }
    return [];
  },
  async dna(ref, names) {
    const slugs = ref ? [ref.id.split("~")[0]] : await FINDERS.dna({ ean: [], mpn: [] }, names);
    for (const slug of slugs.slice(0, 2)) {
      const html = (await fetchText(`https://kauppa.dna.fi/tuote/p/${slug}`)).replace(/\\"/g, '"');
      const ids = [...new Set([...html.matchAll(/"ColorVariant","name":"[^"]*","code":"([a-z0-9-]+)"/g)].map((m) => m[1]))];
      if (ids.length) return ids;
    }
    return [];
  },
};

// Kaupat, joissa värit haetaan nimellä. Palauttaa tunnukset, joiden hakutulos kelpaa (keep). Prisman haku antaa vain viisi osumaa.
const byName = (s, n) => async (q, keep) => (await STORES[s].search(q, n)).filter(keep).map((h) => h.id);
const SEARCH = {
  verkkokauppa: byName("verkkokauppa"),
  power: byName("power", 24),
  prisma: byName("prisma"),
  veikonkone: byName("veikonkone", 24),
  multitronic: async (q, keep) => (await multitronicSearch(q)).filter(([, slug]) => keep({ name: slug.replace(/-+/g, " ") })).map(([id]) => id),
  karkkainen: (q, keep) => karkkainenIds(q, keep, 8),
};

// Tuotteen tarjousten enimmäismäärä: kaikki värit kaikista kaupoista vievät enemmän tilaa.
export const maxOffers = (p) => (p.anyColor ? 60 : 10);

// Lähdetuote -> saman mallin kaikki värit kaikista kaupoista (sama malli ja tallennustila, väri saa vaihdella).
// matchAll löytää lähteen värin koodeilla, minkä jälkeen jokaisesta kaupasta haetaan muut värit ja ne varmistetaan check()-haulla.
export async function matchModel(store, id) {
  const source = await STORES[store].check(id);
  const exact = await matchAll(store, id, source);
  const found = [...exact];
  const seen = new Set(exact.map((o) => `${o.store}:${o.id}`));
  const refs = (s) => [source, ...exact.filter((o) => o.store === s)];
  const keep = (s) => (h) => refs(s).some((r) => keyOf(r) === keyOf(h));
  const verify = async (s, ids) => {
    const todo = [...new Set(ids)].filter((i) => !seen.has(`${s}:${i}`)).slice(0, 16);
    todo.forEach((i) => seen.add(`${s}:${i}`));
    const hits = await Promise.all(todo.map((i) => STORES[s].check(i).catch(() => null)));
    found.push(...hits.filter((h) => h && sameModel(refs(s), source, h)));
  };
  // Hakusanat: lyhyt malli, koko nimi ilman väriä, sama muodossa "256GB" ja saman kaupan oma nimi.
  const base = nameQuery(modelName(source.name));
  const names = exact.map((o) => o.name);
  await Promise.all([
    ...Object.entries(VARIANTS).map(async ([s, list]) => verify(s, await list(exact.find((o) => o.store === s), names).catch(() => []))),
    ...Object.entries(SEARCH).map(async ([s, search]) => {
      const qs = new Set([shortQuery(source.name), base, base.replace(/(\d+)\s*(gt|gb)\b/gi, "$1GB"), ...exact.filter((o) => o.store === s).map((o) => nameQuery(modelName(o.name)))]);
      await verify(s, (await Promise.all([...qs].map((q) => search(q, keep(s)).catch(() => [])))).flat());
    }),
  ]);
  // Haut palauttavat vain muutaman osuman, joten muualta löytyneet värit haetaan vielä erikseen niistä kaupoista, joissa malli on.
  const colors = [...new Set(found.map(colorOf).filter(Boolean))];
  await Promise.all(Object.entries(SEARCH).map(async ([s, search]) => {
    if (!found.some((o) => o.store === s)) return;
    const missing = colors.filter((c) => !found.some((o) => o.store === s && colorOf(o) === c));
    await verify(s, (await Promise.all(missing.map((c) => search(`${base} ${c}`, keep(s)).catch(() => [])))).flat());
  }));
  return found.map((o) => ({ ...o, color: colorOf(o) || undefined }));
}

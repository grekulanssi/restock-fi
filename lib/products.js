import { CATALOG } from "./catalog.js";
import { read, update } from "./db.js";
import { slugify, strongMpn, modelKey, modelName, maxOffers } from "./match.js";

// Tuoterekisteri (products.json): { [slug]: { slug, name, image, anyColor, offers, keys, created, seed?, category? } }.
// Seuranta viittaa tuotteeseen, ja tarjoukset ovat tuotteella, joten uudet kaupat tulevat kaikille seuraajille.
// Kirjoittaja on vain palvelin (api/match.js ja api/rematch.js), ja kirjoitus tehdään ETag-ehdolla (db.update).
// lib/catalog.js on rekisterin siemen: sen tuotteet ovat aina mukana ja näkyvät etusivulla.

// Käyttäjien luomat tuotteet näkyvät etusivulla, kun seuraajia on vähintään näin monta.
export const MIN_WATCHERS = 2;

const offerKey = (o) => `${o.store}:${o.id}`;

export function withSeeds(reg) {
  for (const c of CATALOG) {
    const p = (reg[c.slug] ||= { slug: c.slug, offers: [], keys: [], created: null });
    Object.assign(p, { name: c.name, category: c.category, seed: true });
    for (const o of c.offers) if (!p.offers.some((x) => offerKey(x) === offerKey(o))) p.offers.push({ store: o.store, id: o.id });
  }
  return reg;
}

export const loadProducts = async (opts) => withSeeds(await read("products", {}, opts));

// Seuraajamäärä tuotteittain: käyttäjä lasketaan kerran, vaikka seuraisi samaa tuotetta useasti.
export function watcherCounts(users) {
  const n = {};
  for (const u of Object.values(users)) for (const slug of new Set((u.watches || []).map((w) => w.product))) n[slug] = (n[slug] || 0) + 1;
  return n;
}

// Tunnistusavaimet varmistetuista tarjouksista (matchAll / matchModel). Kaupan tunnus (store:id) on tarjouksissa.
// Mikä tahansa väri: malli ja tallennustila ("256gb duo iphone").
function keysOf(found, anyColor) {
  if (anyColor) return [`model:${modelKey(found[0].name)}`];
  const ean = found.flatMap((o) => o.codes?.ean || []).map((e) => `ean:${e}`);
  const mpn = found.flatMap((o) => o.codes?.mpn || []).filter(strongMpn).map((m) => `mpn:${m}`);
  return [...new Set([...ean, ...mpn])];
}

// Sama tuote: ensin EAN, sitten vahva valmistajan koodi, viimeisenä kaupan tunnus. Jos molemmilla on saman
// tason koodeja mutta yksikään ei ole yhteinen, kyse on eri tuotteesta. Väärä yhdistäminen näkyy julkisesti,
// joten epävarmassa tapauksessa syntyy mieluummin kaksi tuotetta.
// Mikä tahansa väri: sama malli ja lisäksi vähintään yksi yhteinen tarjous.
function sameProduct(p, keys, offers, anyColor) {
  if (!!p.anyColor !== !!anyColor) return false;
  const sharedOffer = offers.some((o) => p.offers.some((x) => offerKey(x) === offerKey(o)));
  if (anyColor) return keys[0] === p.keys[0] && sharedOffer;
  for (const t of ["ean", "mpn"]) {
    const mine = keys.filter((k) => k.startsWith(t + ":")), theirs = p.keys.filter((k) => k.startsWith(t + ":"));
    if (mine.some((k) => theirs.includes(k))) return true;
    if (mine.length && theirs.length) return false;
  }
  return sharedOffer;
}

// Kaupan tuotenimi ilman valmistajan koodia. Isoilla kirjaimilla kirjoitettu nimi (Power) vain, jos muuta ei ole.
const MPN = /\(?\b[A-Z0-9]{4,}\/[A-Z]\b\)?/g;
const tidy = (n) => String(n || "").replace(MPN, " ").replace(/\(\s*\)/g, " ").replace(/\s+-(?=\s|$)/g, "").replace(/[\s,]+$/, "").replace(/\s+/g, " ").trim();
function nameOf(found, anyColor) {
  const names = found.map((o) => (anyColor ? modelName(o.name) : tidy(o.name))).filter(Boolean);
  return (names.find((n) => n !== n.toUpperCase()) || names[0] || "Tuote").slice(0, 120);
}

// Luettava osoite, esim. apple-iphone-duo-256-gt-yotaivas. Törmäyksessä lisäke -2, -3 …
const FILLER = new Set(["puhelin", "alypuhelin", "matkapuhelin", "pelikonsoli", "5g"]);
function newSlug(reg, name, anyColor) {
  let base = slugify(name).split("-").filter((w) => w && !FILLER.has(w)).join("-");
  if (anyColor) base += "-kaikki-varit";
  if (base.length > 70) base = base.slice(0, 71).replace(/-[^-]*$/, "");
  base ||= "tuote";
  let slug = base;
  for (let i = 2; reg[slug]; i++) slug = `${base}-${i}`;
  return slug;
}

// Lisää tuotteelle tarjoukset, joita sillä ei vielä ole. Tarkalla tuotteella yksi tarjous kauppaa kohden,
// mikä tahansa väri -tuotteella kaikki värit. Palauttaa true, jos jotain lisättiin.
export function addOffers(p, found, anyColor) {
  let changed = false;
  for (const o of found) {
    if (p.offers.length >= maxOffers(p)) break;
    if (p.offers.some((x) => x.store === o.store && (anyColor ? x.id === o.id : true))) continue;
    p.offers.push({ store: o.store, id: o.id, name: String(o.name || "").slice(0, 160), url: o.url, color: anyColor ? o.color || undefined : undefined });
    changed = true;
  }
  for (const k of keysOf(found, anyColor)) if (!p.keys.includes(k)) { p.keys.push(k); changed = true; }
  if (!p.image && found.some((o) => o.image)) { p.image = found.find((o) => o.image).image; changed = true; }
  return changed;
}

// Varmistetut tarjoukset -> rekisterin tuote (olemassa oleva tai uusi). Kirjoittaa vain, jos jotain muuttui.
export async function resolveProduct(found, anyColor) {
  const keys = keysOf(found, anyColor);
  let slug;
  const reg = await update("products", {}, (raw) => {
    withSeeds(raw);
    let p = Object.values(raw).find((x) => sameProduct(x, keys, found, anyColor));
    let created = false;
    if (!p) {
      const s = newSlug(raw, nameOf(found, anyColor), anyColor);
      p = raw[s] = { slug: s, name: nameOf(found, anyColor), image: null, anyColor: anyColor || undefined, offers: [], keys: [], created: new Date().toISOString() };
      created = true;
    }
    slug = p.slug;
    return addOffers(p, found, anyColor) || created;
  });
  return withSeeds(reg)[slug];
}

// Selaimelle ja tuotesivulle: vain kauppojen data.
export const publicProduct = (p) => p && ({ slug: p.slug, name: p.name, anyColor: p.anyColor, offers: p.offers.map(({ store, id, name, url, color }) => ({ store, id, name: name || p.name, url, color })) });

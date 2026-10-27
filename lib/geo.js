import { readFileSync } from "node:fs";

// Postinumeroiden ja paikkakuntien koordinaatit (GeoNames FI, CC-BY 4.0, lib/postcodes.json).
// Myymälä, jonka sijaintia ei tunnisteta, lasketaan aina mukaan, jotta ilmoitus ei jää tulematta.
const { zips: ZIPS, places: PLACES } = JSON.parse(readFileSync(new URL("./postcodes.json", import.meta.url), "utf8"));

const norm = (s) => String(s || "").toLowerCase().normalize("NFC").trim();

// Koordinaatit postinumerosta, paikkakunnasta tai tekstistä, jossa paikkakunta esiintyy (esim. "Power Sello Espoo").
export function coordsFor({ zip, city, name } = {}) {
  if (zip && ZIPS[zip]) return ZIPS[zip];
  if (city && PLACES[norm(city)]) return PLACES[norm(city)];
  for (const w of norm(name).split(/[^a-zåäö-]+/).reverse()) if (w.length > 2 && PLACES[w]) return PLACES[w];
  return null;
}

// Käyttäjän sijainti: postinumero tai paikkakunta.
export function locate(input) {
  const q = norm(input);
  if (!q) return null;
  return /^\d{5}$/.test(q) ? ZIPS[q] || null : PLACES[q] || coordsFor({ name: q });
}

export function distanceKm([lat1, lon1], [lat2, lon2]) {
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

// Etäisyys myymälään (null = sijainti ei tiedossa), false = säteen ulkopuolella.
function kmTo(shop, user) {
  const c = coordsFor(shop);
  const km = user.coords && c ? Math.round(distanceKm(user.coords, c)) : null;
  return user.coords && user.radiusKm && km != null && km > user.radiusKm ? false : km;
}

// Onko tuote saatavilla käyttäjälle: verkossa tai jossain säteen sisällä olevassa myymälässä.
// Palauttaa listan osumista ilmoitustekstiä varten, tyhjä lista = ei osumaa.
export function hitsFor(check, user) {
  const hits = [];
  if (check.web?.available) hits.push({ label: "verkkokauppa" });
  for (const s of check.shops || []) {
    if (!s.available) continue;
    const km = kmTo(s, user);
    if (km === false) continue;
    hits.push({ label: `${s.name}${s.stock ? ` ${s.stock} kpl` : ""}${km != null ? `, ${km} km` : ""}`, km });
  }
  // Kauppa, joka kertoo vain "saatavilla" ilman myymälä- tai verkkoerittelyä.
  if (!hits.length && check.available && !check.web && !check.shops) hits.push({ label: "saatavilla" });
  return hits.sort((a, b) => (a.km ?? -1) - (b.km ?? -1));
}

const eur = (n) => `${Number(n).toLocaleString("fi-FI")} €`;
export const outletLabel = (x) => `Outlet ${eur(x.price)}${x.condition ? ` (${x.condition.replace(/\.$/, "")})` : ""}`;

// Outlet-kappaleet käyttäjälle: verkko-outlet kuten verkkokauppa, myymälän kappale vain säteen sisällä.
// maxPrice koskee kappaleen omaa hintaa. Halvin ensin.
export function outletHitsFor(check, user, maxPrice) {
  const hits = [];
  for (const x of check.outlet || []) {
    if (maxPrice && x.price > maxPrice) continue;
    const km = x.web ? null : kmTo(x, user);
    if (km === false) continue;
    hits.push({ label: `${outletLabel(x)}, ${x.web ? "verkko-outlet" : x.name}${km != null ? `, ${km} km` : ""}`, km, price: x.price, url: x.url });
  }
  return hits.sort((a, b) => a.price - b.price);
}

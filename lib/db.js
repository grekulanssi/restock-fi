import { put } from "@vercel/blob";

// Kaksi JSON-tiedostoa Vercel Blobissa: käyttäjien seurannat (kirjoittaa vain käyttöliittymä)
// ja viimeisin saldotila (kirjoittaa vain cron). Näin ne eivät ylikirjoita toisiaan.
// DATA_KEY on polussa, jotta julkisen storen tiedostoja ei voi arvata.
const storeId = () => process.env.BLOB_READ_WRITE_TOKEN.split("_")[3].toLowerCase();
const path = (name) => `data/${process.env.DATA_KEY}/${name}.json`;

export async function read(name, fallback) {
  const r = await fetch(`https://${storeId()}.public.blob.vercel-storage.com/${path(name)}?v=${Date.now()}`, { cache: "no-store" });
  return r.ok ? r.json() : fallback;
}

export function write(name, data) {
  return put(path(name), JSON.stringify(data), {
    access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60,
  });
}

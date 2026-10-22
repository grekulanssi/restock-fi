import { put, get, BlobPreconditionFailedError } from "@vercel/blob";

// JSON-tiedostot Vercel Blobissa: users.json (seurannat), products.json (tuoterekisteri), state.json (viimeisin tila)
// ja events.json (täydennykset). state ja events kirjoittaa vain cron. users ja products päivitetään update()-funktiolla.
// DATA_KEY on polussa, jotta julkisen storen tiedostoja ei voi arvata.
const storeId = () => process.env.BLOB_READ_WRITE_TOKEN.split("_")[3].toLowerCase();
const path = (name) => `data/${process.env.DATA_KEY}/${name}.json`;

// CDN:n kautta (voi olla noin minuutin vanha). fresh = suoraan tallennustilasta.
export async function read(name, fallback, { fresh = false } = {}) {
  if (fresh) return (await readFresh(name))?.data ?? fallback;
  const r = await fetch(`https://${storeId()}.public.blob.vercel-storage.com/${path(name)}?v=${Date.now()}`, { cache: "no-store" });
  return r.ok ? r.json() : fallback;
}

async function readFresh(name) {
  const r = await get(path(name), { access: "public", useCache: false });
  return r?.stream ? { data: await new Response(r.stream).json(), etag: r.blob.etag } : null;
}

export function write(name, data, opts = {}) {
  return put(path(name), JSON.stringify(data), {
    access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60, ...opts,
  });
}

// Luku, muutos ja kirjoitus ETag-ehdolla: jos joku muu kirjoitti välissä, luetaan uudelleen ja muutos tehdään uuteen versioon.
// mutate(data) muokkaa dataa paikallaan ja palauttaa true, jos jotain muuttui. Muuten ei kirjoiteta (Blobin ilmaiskiintiö).
export async function update(name, fallback, mutate) {
  for (let i = 0; i < 6; i++) {
    const cur = await readFresh(name);
    const data = cur?.data ?? structuredClone(fallback);
    if (!mutate(data)) return data;
    try {
      await write(name, data, cur ? { ifMatch: cur.etag } : {});
      return data;
    } catch (e) {
      if (!(e instanceof BlobPreconditionFailedError)) throw e;
    }
  }
  throw new Error(`${name}: tallennus ei onnistunut samanaikaisten muutosten takia`);
}

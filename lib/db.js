import { put, get, head, BlobNotFoundError, BlobPreconditionFailedError } from "@vercel/blob";

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

// Uusin versio ja sen ETag. head() kertoo ETagin tallennustilasta. CDN voi palauttaa vanhan version (eri reitit
// vanhenevat eri tavoin), joten sisältö haetaan useaa reittiä ja hyväksytään vain, jos sen ETag on sama.
// Pakatun vastauksen ETag on heikko (W/"…").
const sameTag = (a, b) => !!a && a.replace(/^W\//, "") === b.replace(/^W\//, "");
async function readFresh(name) {
  for (let i = 0; i < 6; i++) {
    const h = await head(path(name)).catch((e) => { if (e instanceof BlobNotFoundError) return null; throw e; });
    if (!h) return null;
    const v = Date.now();
    const routes = [
      async () => { const g = await get(path(name), { access: "public", useCache: false }); return g?.stream && { tag: g.blob.etag, body: () => new Response(g.stream).json() }; },
      async () => { const r = await fetch(`${h.url}?v=${v}`, { cache: "no-store" }); return r.ok && { tag: r.headers.get("etag"), body: () => r.json() }; },
      async () => { const r = await fetch(`${h.downloadUrl}&v=${v}`, { cache: "no-store" }); return r.ok && { tag: r.headers.get("etag"), body: () => r.json() }; },
    ];
    for (const route of routes) {
      const r = await route().catch(() => null);
      if (r && sameTag(r.tag, h.etag)) return { data: await r.body(), etag: h.etag };
    }
    await new Promise((ok) => setTimeout(ok, 1000 * (i + 1)));
  }
  throw new Error(`${name}: uusinta versiota ei saatu luettua`);
}

export function write(name, data, opts = {}) {
  return put(path(name), JSON.stringify(data), {
    access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60, ...opts,
  });
}

// Luku, muutos ja kirjoitus ETag-ehdolla: jos joku muu kirjoitti välissä, luetaan uudelleen ja muutos tehdään uuteen versioon.
// mutate(data) muokkaa dataa paikallaan ja palauttaa true, jos jotain muuttui. Muuten ei kirjoiteta (Blobin ilmaiskiintiö).
export async function update(name, fallback, mutate) {
  for (let i = 0; i < 10; i++) {
    const cur = await readFresh(name);
    const data = cur?.data ?? structuredClone(fallback);
    if (!mutate(data)) return data;
    try {
      await write(name, data, cur ? { ifMatch: cur.etag } : {});
      return data;
    } catch (e) {
      // ETag ei täsmää (412) tai toinen kirjoitus on kesken (409): odotetaan hetki ja tehdään muutos uudelleen.
      if (!(e instanceof BlobPreconditionFailedError) && !/conditional request|conflict/i.test(e.message)) throw e;
      await new Promise((ok) => setTimeout(ok, 200 + Math.random() * 800));
    }
  }
  throw new Error(`${name}: tallennus ei onnistunut samanaikaisten muutosten takia`);
}

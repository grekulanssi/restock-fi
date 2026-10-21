// Käyttäjän seurannat: palvelin (Vercel Blob) + selaimen oma kopio.
// Blobin CDN voi palauttaa noin minuutin vanhaa dataa, joten käytetään sitä, jonka savedAt on uudempi.
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
export const rand = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => (b % 36).toString(36)).join("");

const urlUser = new URLSearchParams(location.search).get("u");
export const user = urlUser || ls.get("user") || rand(24);
ls.set("user", user);

export async function loadData() {
  let local = null;
  try { local = JSON.parse(ls.get("data:" + user)); } catch {}
  const server = await (await fetch(`/api/watches?user=${user}`)).json();
  const data = (local?.savedAt || 0) > (server.savedAt || 0) ? local : server;
  if (!data.topic) data.topic = "restock-" + rand(10);
  return data;
}

export async function saveData(data) {
  data.savedAt = Date.now();
  ls.set("data:" + user, JSON.stringify(data));
  const r = await fetch("/api/watches", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user, ...data }) });
  if (!r.ok) throw new Error("Tallennus epäonnistui");
}

import { bySlug } from "../lib/catalog.js";
import { loadAll, summarize } from "../lib/summary.js";

// Julkinen tuotesivu /tuote/<slug>. Renderöidään palvelimella, jotta sivu näkyy hakukoneissa.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const TZ = { timeZone: "Europe/Helsinki" };
const fmtDate = (iso) => new Date(iso).toLocaleString("fi-FI", { ...TZ, day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
const eur = (n) => (n == null ? "–" : `${Number(n).toLocaleString("fi-FI")} €`);

function ago(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 60) return `${Math.max(min, 1)} min sitten`;
  if (min < 1440) return `${Math.round(min / 60)} h sitten`;
  return `${Math.round(min / 1440)} pv sitten`;
}

function duration(e) {
  if (!e.end) return "yhä saatavilla";
  const min = Math.round((Date.parse(e.end) - Date.parse(e.start)) / 60000);
  return min < 60 ? `saatavilla n. ${min} min` : `saatavilla n. ${Math.round(min / 60)} h`;
}

export default async function handler(req, res) {
  const p = bySlug(String(req.query.slug || ""));
  if (!p) return res.status(404).send("Tuotetta ei löytynyt");
  const s = await summarize(p, await loadAll(), { live: true });

  const days = [...Array(30)].map((_, i) => {
    const d = new Date(Date.now() - (29 - i) * 864e5).toLocaleDateString("fi-FI", TZ);
    return s.history.filter((e) => new Date(e.start).toLocaleDateString("fi-FI", TZ) === d).length;
  });
  const maxDay = Math.max(1, ...days);
  const stores = s.offers.map((o) => `${o.storeName} (${eur(o.price)})`).join(", ");
  const lead = `${p.name} seurataan kaupoissa ${stores}. ` +
    (s.lastRestock ? `Viimeksi saatavilla ${fmtDate(s.lastRestock.start)} (${s.lastRestock.storeName}), 30 päivän aikana ${s.restocks30} täydennystä.` : "Täydennyksiä ei ole vielä havaittu.");

  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="fi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.name)}: saatavuus ja täydennykset | Restock.fi</title>
<meta name="description" content="${esc(lead)}">
<link rel="manifest" href="/api/manifest">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#141414">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<main>
  <a class="back" href="/">← Kaikki tuotteet</a>
  <div class="row" style="margin-top:12px">
    <div><div class="muted">${esc(p.category)}</div><h1>${esc(p.name)}</h1></div>
    <span class="${s.available ? "ok" : "no"}">${s.available ? "Saatavilla nyt" : "Ei saatavilla"}</span>
  </div>
  <p class="lead">${esc(lead)}</p>

  <div class="box stats">
    <div class="stat"><span class="muted">Halvin hinta</span><b>${eur(s.minPrice)}</b></div>
    <div class="stat"><span class="muted">Täydennykset 30 pv</span><b>${s.restocks30}</b></div>
    <div class="stat"><span class="muted">Seuraajia</span><b id="watchers">${s.watchers}</b></div>
  </div>

  <div class="box">
    <div class="follow" style="margin-top:0">
      <span class="muted" style="align-self:center">Ilmoitus puhelimeen, kun tuote tulee varastoon.</span>
      <input id="wmax" type="number" placeholder="Maksimihinta €">
      <button id="follow">Seuraa</button>
    </div>
    <p class="muted" id="followed" hidden style="margin:10px 0 0">Seurannassa. Ilmoitusasetukset ovat <a href="/#ilmoitukset">etusivulla</a>.</p>
  </div>

  <h2>Mistä ostaa</h2>
  <div class="box">
    ${s.offers.map((o) => `<div class="buy">
      <img src="${esc(o.image || "")}" alt="" loading="lazy">
      <div><a href="${esc(o.url)}" target="_blank" rel="noopener"><strong>${esc(o.storeName)}</strong></a>
        <div class="muted"><span class="${o.available ? "ok" : "no"}">${o.available ? "Saatavilla" : "Loppu"}</span>${o.detail ? " · " + esc(o.detail) : ""}</div>
        <div class="muted">${o.lastRestock ? `Viimeksi varastossa ${ago(o.lastRestock.start)}` : "Ei havaittuja täydennyksiä"}</div></div>
      <strong>${eur(o.price)}</strong>
    </div>`).join("")}
  </div>

  <h2>Täydennyshistoria</h2>
  <div class="box">
    <div class="row"><span class="muted">Viimeiset 30 päivää</span><strong>${s.restocks30} täydennystä</strong></div>
    <div class="bars">${days.map((n) => `<span class="${n ? "" : "zero"}" style="height:${(n / maxDay) * 100}%" title="${n}"></span>`).join("")}</div>
    <div class="axis"><span>30 pv sitten</span><span>tänään</span></div>
    ${s.history.length ? `<ul class="events">${s.history.slice(-10).reverse().map((e) => `<li><strong>${esc(e.storeName)}</strong> · ${fmtDate(e.start)} · ${eur(e.price)} · ${duration(e)}</li>`).join("")}</ul>`
      : `<p class="muted">Historia kertyy, kun tuote tulee seuraavan kerran varastoon. Tarkistus tehdään 2 minuutin välein.</p>`}
  </div>
</main>
<script type="module">
import { loadData, saveData, rand } from "/user.js";
const product = ${JSON.stringify({ slug: p.slug, name: p.name, offers: s.offers.map(({ store, id, name, url }) => ({ store, id, name: name || p.name, url })) })};
let data;
loadData().then((d) => {
  data = d;
  if (d.watches.some((w) => w.product === product.slug)) markFollowed();
});
function markFollowed() {
  document.getElementById("follow").disabled = true;
  document.getElementById("follow").textContent = "Seurataan";
  document.getElementById("followed").hidden = false;
}
document.getElementById("follow").onclick = async () => {
  if (!data) return;
  data.watches.push({ id: rand(8), product: product.slug, name: product.name, maxPrice: Number(document.getElementById("wmax").value) || null, offers: product.offers });
  try { await saveData(data); } catch (e) { return alert(e.message); }
  const w = document.getElementById("watchers"); w.textContent = Number(w.textContent) + 1;
  markFollowed();
};
</script>
</body>
</html>`);
}

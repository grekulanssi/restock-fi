import { read } from "../lib/db.js";
import { notify } from "../lib/notify.js";

// Lähettää testi-ilmoituksen käyttäjän kanaviin. Push-tilaukset otetaan bodysta, koska Blobin data voi olla minuutin vanha.
// Sähköposti luetaan vain tallennetuista tiedoista, ettei endpointilla voi lähettää postia mihin tahansa.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { user, push } = req.body || {};
  const saved = (await read("users", {}))[user] || {};
  const valid = (Array.isArray(push) ? push : []).filter((p) => /^https:\/\//.test(p?.endpoint) && p.keys?.p256dh).slice(0, 5);
  const target = { push: valid.length ? valid : saved.push, email: saved.email };
  const sent = await notify(target, "Restock.fi", "Testi-ilmoitus toimii.", "https://restock-fi.vercel.app/");
  res.json({ sent });
}

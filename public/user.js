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

// Web Push. iPhonessa toimii vain, kun sivu on lisätty Koti-valikkoon (iOS 16.4+).
const VAPID_PUBLIC_KEY = "BJwmDtH9Ab4NIwNBLRzIrRRfRaffG_xSwjCySBohbd1N6bhYrxWMsPxK23nUMoKYFVTQIYqvGhTeOYB3VUYFtK0";
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

export function pushState(data) {
  if (isIOS && !standalone) return "ios-install";
  if (!("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const mine = ls.get("pushEndpoint");
  return Notification.permission === "granted" && mine && (data.push || []).some((p) => p.endpoint === mine) ? "on" : "off";
}

export async function enablePush(data) {
  if (await Notification.requestPermission() !== "granted") throw new Error("Ilmoituksille ei annettu lupaa.");
  const reg = await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(VAPID_PUBLIC_KEY.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
  const json = sub.toJSON();
  data.push = [...(data.push || []).filter((p) => p.endpoint !== json.endpoint), { endpoint: json.endpoint, keys: json.keys }].slice(-5);
  ls.set("pushEndpoint", json.endpoint);
}

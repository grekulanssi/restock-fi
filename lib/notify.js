import webpush from "web-push";

// Lähettää ilmoituksen käyttäjän kanaviin: Web Push -tilaukset ja sähköposti (ntfy.sh:n sähköpostivälityksellä, satunnainen aihe).
webpush.setVapidDetails("https://restock-fi.vercel.app", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

export async function notify(user, title, body, url) {
  const jobs = (user.push || []).map((sub) =>
    webpush.sendNotification(sub, JSON.stringify({ title, body, url }), { TTL: 3600, urgency: "high" }));
  if (user.email) {
    jobs.push(fetch("https://ntfy.sh/", {
      method: "POST",
      body: JSON.stringify({ topic: "restock-mail-" + Math.random().toString(36).slice(2), title, message: body, click: url, tags: ["shopping_cart"], email: user.email }),
    }));
  }
  const results = await Promise.allSettled(jobs);
  return results.filter((r) => r.status === "fulfilled").length;
}

export const hasChannel = (u) => !!(u.push?.length || u.email);

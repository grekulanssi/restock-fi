import webpush from "web-push";

// Lähettää ilmoituksen kaikkiin käyttäjän kanaviin: Web Push -tilaukset, ntfy-aihe ja sähköposti (ntfy:n kautta).
webpush.setVapidDetails("mailto:grekulanssi@hey.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

export async function notify(user, title, body, url) {
  const jobs = (user.push || []).map((sub) =>
    webpush.sendNotification(sub, JSON.stringify({ title, body, url }), { TTL: 3600, urgency: "high" }));
  if (user.topic || user.email) {
    jobs.push(fetch("https://ntfy.sh/", {
      method: "POST",
      body: JSON.stringify({ topic: user.topic || "restock-mail-" + Math.random().toString(36).slice(2), title, message: body, click: url, tags: ["shopping_cart"], ...(user.email && { email: user.email }) }),
    }));
  }
  const results = await Promise.allSettled(jobs);
  return results.filter((r) => r.status === "fulfilled").length;
}

export const hasChannel = (u) => !!(u.push?.length || u.topic || u.email);

// Service worker: näyttää palvelimen lähettämät push-ilmoitukset ja avaa tuotteen klikkauksesta.
self.addEventListener("push", (event) => {
  const d = event.data ? event.data.json() : { title: "Restock.fi", body: "" };
  event.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: "/icon-192.png", data: { url: d.url || "/" } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});

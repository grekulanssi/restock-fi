// Käyttäjäkohtainen manifest: Koti-valikkoon lisätty sovellus avautuu käyttäjän omalla listalla,
// koska iOS:ssä Koti-valikon sovelluksella on eri tallennustila kuin Safarilla.
export default function handler(req, res) {
  const u = String(req.query.u || "").match(/^[a-z0-9]{16,40}$/)?.[0];
  res.setHeader("Content-Type", "application/manifest+json");
  res.json({
    name: "Restock.fi", short_name: "Restock", start_url: u ? `/?u=${u}` : "/", scope: "/",
    display: "standalone", background_color: "#141414", theme_color: "#141414",
    icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png" }],
  });
}

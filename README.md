# Restock.fi (MVP)

Tech-tuotteiden varastovahti. Seuraa samaa tuotetta usealla kaupalla, kirjaa täydennyshistorian ja ilmoittaa puhelimeen, kun tuote tulee saataville (valinnaisesti alle rajahinnan). Kaupat: Verkkokauppa.com, Power, Prisma ja Telia.

Live: https://restock-fi.vercel.app

## Miten toimii

- **Katalogi** (`lib/catalog.js`): kuratoidut tuotteet, joilla on julkinen sivu `/tuote/<slug>`. Sivulla näkyvät hinnat ja tila kaupoittain, täydennykset 30 päivältä, viimeiset täydennykset kestoineen ja seuraajamäärä. Lisäksi on Seuraa-nappi. Sama tuote yhdistetään kauppoihin käsin, ja värivaihtoehdoista seurataan yhtä.
- **Oma haku**: katalogin ulkopuoliset tuotteet haetaan kerralla kaikista kaupoista, joissa on haku. Käyttäjä valitsee osumista saman tuotteen.
- Kirjautumista ei ole. Selain luo käyttäjäavaimen, ja linkillä `/?u=<avain>` saman listan saa auki toisella laitteella.
- **Taustatarkistus**: GitHub Actions (`.github/workflows/check.yml`, yksityinen repo) kutsuu `/api/cron`-osoitetta 2 min välein. GitHub ajaa ajastetut työt usein tuntien viiveellä, joten yksi ajo pysyy käynnissä lähes 6 h ja silmukoi, ja seuraava odottaa jonossa. Cron tarkistaa katalogin ja kaikkien seuraamat tuotteet, kirjaa täydennykset (loppu → saatavilla → loppu) ja lähettää ilmoitukset.
- **Ilmoitukset** (`lib/notify.js`): ensisijaisesti Web Push (`public/sw.js`, VAPID-avaimet). iPhonessa push toimii vain, kun sivu on lisätty Koti-valikkoon (iOS 16.4+), ja sivu neuvoo tämän. Vaihtoehtoina [ntfy.sh](https://ntfy.sh)-aihe ja sähköposti (ntfy:n kautta). ntfy:n iOS-sovellus näyttää viestit viiveellä tai vasta avattaessa, joten sitä ei suositella iPhonelle.
- Kun sivu on auki, se tarkistaa saldot myös itse 2 min välein ja näyttää selainilmoituksen.

| Tiedosto | Tehtävä |
|---|---|
| `lib/stores.js` | Kauppakohtainen haku ja saldotarkistus (VK: tuotesivun `stocks`-data, Power: `/api/v2`, Prisma: storefront-api ja schema.org, Telia: tuotesivun RSC-data, vain katalogi, id `<slug>~<varianttiId>`) |
| `lib/catalog.js` | Katalogituotteet ja niiden kauppakohtaiset tuotenumerot |
| `lib/summary.js` | Kokoaa tuotteen tilan, historian ja seuraajat |
| `lib/db.js` | Vercel Blob: `users.json` (seurannat), `state.json` (viimeisin tila), `events.json` (täydennykset, 90 pv) |
| `api/tuote.js` | Palvelimella renderöity tuotesivu (`/tuote/:slug`, rewrite `vercel.json`:ssa) |
| `api/catalog.js` | Etusivun tuotelista |
| `api/search.js`, `api/check.js` | Haku kaikista kaupoista ja yhden tuotteen tarkistus |
| `api/watches.js` | Käyttäjän seurantojen ja push-tilausten luku ja tallennus |
| `api/test-push.js` | Testi-ilmoitus käyttäjän kanaviin (sähköposti ja ntfy vain tallennetuista tiedoista) |
| `api/cron.js` | Taustatarkistus, historia ja ilmoitukset. Tila kirjoitetaan vain, kun saatavuus, hinta tai kuva muuttuu (Blobin ilmaiskiintiö). |
| `public/` | Etusivu, `style.css`, `user.js` (seurannat ja push-tilaus), `sw.js` ja kuvakkeet |
| `api/manifest.js` | Käyttäjäkohtainen manifest, jotta Koti-valikon sovellus avautuu omalla listalla (iOS:ssä eri tallennustila kuin Safarilla) |

Blobin CDN voi palauttaa noin minuutin vanhaa dataa. Siksi `user.js` pitää seurannoista oman kopion selaimessa ja käyttää versiota, jonka `savedAt` on uudempi.

## Uuden katalogituotteen lisäys

Hae tuotenumerot (`/api/search?q=...`, Telialle variantti-id tuotesivun lähdekoodista) ja lisää rivi `lib/catalog.js`:ään. Saman tuotteen tunnistaa eri kaupoissa SKU- tai EAN-koodista.

## Ympäristömuuttujat (Vercel)

- `BLOB_READ_WRITE_TOKEN` – Vercel Blob (store `restock-fi`)
- `DATA_KEY` – satunnainen polkuosa, ettei julkisen storen tiedostoja voi arvata
- `CRON_SECRET` – sama arvo myös GitHubin repo-secretinä `CRON_SECRET`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` – Web Push. Julkinen avain on myös `public/user.js`:ssä.

## Ajo ja julkaisu

```
vercel dev      # paikallisesti
vercel --prod   # julkaisu
```

## Rajoitukset

- Gigantti, Proshop ja Jimms estävät palvelinhaut (429/403/Cloudflare). Elisa ja DNA puuttuvat vielä.
- Täydennyshistoria on vain niin tarkka kuin tarkistusväli (2 min). Jos GitHub ei käynnistä uutta ajoa ennen kuin edellinen päättyy (6 h), väliin voi jäädä katko.: lyhyt täydennys voi mennä ohi.
- Prismasta saadaan vain verkkokaupan saatavuus. Teliasta saadaan verkkokaupan ja myymälöiden yhteinen tila (kyllä/ei). Powerista saadaan myymälöiden määrä, ei myymälöiden nimiä. Myymäläkohtainen tieto (nimet ja saldot) on vain Verkkokauppa.comista.

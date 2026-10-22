# Restock.fi (MVP)

Tech-tuotteiden varastovahti. Seuraa samaa tuotetta usealla kaupalla, kirjaa täydennyshistorian ja ilmoittaa puhelimeen, kun tuote tulee saataville (valinnaisesti alle rajahinnan). Kaupat: Verkkokauppa.com, Power, Prisma (kaikki S-ryhmän myymälät), Telia, Elisa, DNA ja C&C, myös myymäläkohtaisesti. Ilmoitukset voi rajata postinumeron tai paikkakunnan ja säteen mukaan.

Live: https://restock-fi.vercel.app

## Miten toimii

- **Katalogi** (`lib/catalog.js`): kuratoidut tuotteet, joilla on julkinen sivu `/tuote/<slug>`. Sivulla näkyvät hinnat ja tila kaupoittain, täydennykset 30 päivältä, viimeiset täydennykset kestoineen ja seuraajamäärä. Lisäksi on Seuraa-nappi. Sama tuote yhdistetään kauppoihin käsin, ja värivaihtoehdoista seurataan yhtä.
- **Oma haku**: katalogin ulkopuoliset tuotteet haetaan kerralla kaikista kaupoista, joissa on haku. Käyttäjä valitsee osumista saman tuotteen.
- Kirjautumista ei ole. Selain luo käyttäjäavaimen, ja linkillä `/?u=<avain>` saman listan saa auki toisella laitteella.
- **Taustatarkistus**: GitHub Actions (`.github/workflows/check.yml`, julkinen repo, joten minuutit ovat ilmaisia) kutsuu `/api/cron`-osoitetta 2 min välein. GitHub ajaa ajastetut työt usein tuntien viiveellä, joten yksi ajo pysyy käynnissä lähes 6 h ja silmukoi, ja seuraava odottaa jonossa. Cron tarkistaa katalogin ja kaikkien seuraamat tuotteet, kirjaa täydennykset (loppu → saatavilla → loppu) ja lähettää ilmoitukset.
- **Ilmoitukset** (`lib/notify.js`): ensisijaisesti Web Push (`public/sw.js`, VAPID-avaimet). iPhonessa push toimii vain, kun sivu on lisätty Koti-valikkoon (iOS 16.4+), ja sivu neuvoo tämän. Vaihtoehtoina [ntfy.sh](https://ntfy.sh)-aihe ja sähköposti (ntfy:n kautta). ntfy:n iOS-sovellus näyttää viestit viiveellä tai vasta avattaessa, joten sitä ei suositella iPhonelle.
- **Säde** (`lib/geo.js`): käyttäjä antaa postinumeron tai paikkakunnan ja säteen. Ilmoitus tulee, kun tuotetta on verkkokaupassa tai säteen sisällä olevassa myymälässä. Myymälän sijainti haetaan postinumerosta tai paikkakunnasta (`lib/postcodes.json`, GeoNames FI, CC-BY 4.0). Tuntemattoman sijainnin myymälä lasketaan mukaan, jotta ilmoitus ei jää tulematta.
- Kun sivu on auki, se tarkistaa saldot myös itse 2 min välein ja näyttää selainilmoituksen.

| Tiedosto | Tehtävä |
|---|---|
| `lib/stores.js` | Kauppakohtainen haku ja saldotarkistus. Jokainen palauttaa `web` (verkkokauppa) ja `shops` (myymälät). Haku: VK, Power, Prisma. Vain katalogi: Telia (`<slug>~<variantti>`), Elisa (`<slug>~<laitenumero>`), DNA (`<slug>~<Applen tuotekoodi>`, GraphQL persisted query, hash voi vanhentua), C&C (`<slug>`) |
| `lib/geo.js`, `lib/postcodes.json` | Sijainnit, etäisyydet ja säderajaus |
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

Hae tuotenumerot (`/api/search?q=...`, muille tuotesivun osoitteesta ja lähdekoodista) ja lisää rivi `lib/catalog.js`:ään. Saman tuotteen tunnistaa eri kaupoissa Applen tuotekoodista (esim. MK2D4QN/A) tai EAN-koodista.

## Ympäristömuuttujat (Vercel)

- `BLOB_READ_WRITE_TOKEN` – Vercel Blob (store `restock-fi`)
- `DATA_KEY` – satunnainen polkuosa, ettei julkisen storen tiedostoja voi arvata
- `CRON_SECRET` – sama arvo myös GitHubin repo-secretinä `CRON_SECRET`
- Funktiot ajetaan Tukholmassa (`regions: arn1` `vercel.json`:ssa), lähellä kauppoja.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` – Web Push. Julkinen avain on myös `public/user.js`:ssä.

## Ajo ja julkaisu

```
vercel dev      # paikallisesti
vercel --prod   # julkaisu
```

## Rajoitukset

- Gigantti (Vercel Security Checkpoint), Proshop ja Jimms estävät automaattiset haut. Niitä ei kierretä. Luvallinen reitti on affiliate-feed tai kaupan oma rajapinta. Kärkkäinen, Veikon Kone, Multitronic ja Tector puuttuvat vielä.
- Täydennyshistoria on vain niin tarkka kuin tarkistusväli (2 min). Jos GitHub ei käynnistä uutta ajoa ennen kuin edellinen päättyy (6 h), väliin voi jäädä katko.
- Teliasta saadaan vain verkkokaupan ja myymälöiden yhteinen tila (kyllä/ei), joten säde ei rajaa Teliaa. Elisa, DNA ja C&C kertovat tilan (saatavilla/ei) mutta eivät kappalemäärää.

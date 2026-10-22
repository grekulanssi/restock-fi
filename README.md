# Restock.fi (MVP)

Tech-tuotteiden varastovahti. Seuraa samaa tuotetta usealla kaupalla, kirjaa täydennyshistorian ja ilmoittaa puhelimeen, kun tuote tulee saataville (valinnaisesti alle rajahinnan ja missä tahansa värissä). Kaupat: Verkkokauppa.com, Power, Prisma (kaikki S-ryhmän myymälät), Telia, Elisa, DNA, C&C, Kärkkäinen, Veikon Kone ja Multitronic, myös myymäläkohtaisesti. Ilmoitukset voi rajata postinumeron tai paikkakunnan ja säteen mukaan.

Live: https://restock-fi.vercel.app

## Miten toimii

- **Katalogi** (`lib/catalog.js`): kuratoidut tuotteet, joilla on julkinen sivu `/tuote/<slug>`. Sivulla näkyvät hinnat ja tila kaupoittain, täydennykset 30 päivältä, viimeiset täydennykset kestoineen ja seuraajamäärä. Lisäksi on Seuraa-nappi. Sama tuote yhdistetään kauppoihin käsin, ja värivaihtoehdoista seurataan yhtä.
- **Oma haku ja automaattinen yhdistäminen** (`lib/match.js`, `/api/match`): käyttäjä valitsee tuotteen yhdestä kaupasta, ja palvelu etsii saman tuotteen muista kaupoista EAN-koodilla, valmistajan koodilla (esim. MK2D4QN/A) tai nimellä. Jokainen ehdokas varmistetaan kaupan omasta tuotedatasta. Jos molemmilla on eri vahva valmistajan koodi tai eri EAN, kyse on eri tuotteesta. Lyhyt numerokoodi (esim. Nintendon 220001) tai pelkkä nimi vaatii lisäksi lähes saman nimen ja samaa luokkaa olevan hinnan. Automaattinen yhdistäminen kattaa Verkkokauppa.comin, Powerin, Prisman, Veikon Koneen, Multitronicin, Kärkkäisen, Telian, Elisan ja DNA:n. Operaattoreilla ei ole palvelimelta toimivaa hakua: Telian mallisivu päätellään nimestä (`apple-iphone-duo`, `playstation-5-pro`) ja variantti valitaan EAN:n tai SKU:n perusteella, Elisa haetaan sivukartasta ja värivariantti lähekkäisistä laitetunnuksista EAN:n perusteella, DNA:n osoite muodostetaan (Applen puhelimet) tai haetaan kategoriasivuilta. C&C on mukana vain katalogituotteissa. Jos kauppa myy saman tuotteen eri EAN-koodilla (esim. Elisan PS5 Pro), yhdistäminen ei löydä sitä, ja se lisätään katalogiin käsin.
- **Mikä tahansa väri** (`matchModel` `lib/match.js`:ssä, `/api/match?anyColor=1`): seurantaan tulevat saman mallin kaikki värit kaikista kaupoista. Värit luetaan Telian mallisivun varianteista, Elisan saman ryhmän (`groupId`) laitteista ja DNA:n värivalitsimesta. Muissa kaupoissa haetaan mallin nimellä ilman väriä ja vielä jokaisella muualta löytyneellä värillä. Ehdokas hyväksytään, kun nimi on sama värisanoja lukuun ottamatta, tallennustila on sama ja hinta samaa luokkaa, joten esim. 512 Gt tai Pro Max ei mene läpi. Ilmoituksessa on väri ja kauppa ("Apple iPhone Duo 256GB yötaivas, Telia"), ja samalla ajolla saatavilla tulleet värit kootaan yhteen ilmoitukseen.
- **Uudelleenhaku yöllä** (`api/rematch.js`, `.github/workflows/rematch.yml`): kerran vuorokaudessa omat seurannat (ei katalogituotteet) haetaan uudelleen, ja kaupat, joihin tuote on tullut myyntiin, lisätään seurantaan. Mitään ei poisteta. `users.json` kirjoitetaan vain, jos jotain lisättiin, ja silloin juuri luettuun versioon, jotta selaimen samanaikainen tallennus säilyy. Muuttuneen käyttäjän `savedAt` päivitetään, jolloin selain ottaa palvelimen version. Seurannan "Etsi muista kaupoista" -nappi tekee saman heti.
- Kirjautumista ei ole. Selain luo käyttäjäavaimen, ja linkillä `/?u=<avain>` saman listan saa auki toisella laitteella.
- **Taustatarkistus**: GitHub Actions (`.github/workflows/check.yml`, julkinen repo, joten minuutit ovat ilmaisia) kutsuu `/api/cron`-osoitetta 2 min välein. GitHub ajaa ajastetut työt usein tuntien viiveellä, joten yksi ajo pysyy käynnissä lähes 6 h ja silmukoi, ja seuraava odottaa jonossa. Cron tarkistaa katalogin ja kaikkien seuraamat tuotteet, kirjaa täydennykset (loppu → saatavilla → loppu) ja lähettää ilmoitukset.
- **Ilmoitukset** (`lib/notify.js`): ensisijaisesti Web Push (`public/sw.js`, VAPID-avaimet). iPhonessa push toimii vain, kun sivu on lisätty Koti-valikkoon (iOS 16.4+), ja sivu neuvoo tämän. Lisäksi halutessa sähköposti, joka välitetään [ntfy.sh](https://ntfy.sh):n kautta. ntfy-sovelluksesta luovuttiin, koska iOS-versio näytti viestit viiveellä.
- **Säde** (`lib/geo.js`): käyttäjä antaa postinumeron tai paikkakunnan ja säteen. Ilmoitus tulee, kun tuotetta on verkkokaupassa tai säteen sisällä olevassa myymälässä. Myymälän sijainti haetaan postinumerosta tai paikkakunnasta (`lib/postcodes.json`, GeoNames FI, CC-BY 4.0). Tuntemattoman sijainnin myymälä lasketaan mukaan, jotta ilmoitus ei jää tulematta.
- Kun sivu on auki, se tarkistaa saldot myös itse 2 min välein ja näyttää selainilmoituksen.

| Tiedosto | Tehtävä |
|---|---|
| `lib/stores.js` | Kauppakohtainen haku ja saldotarkistus. Jokainen palauttaa `web` (verkkokauppa) ja `shops` (myymälät). Haku: VK, Power, Prisma, Veikon Kone (Klevu-haku, id = EAN, verkkosaatavuus tuotesivun `stockStatusData`-kentästä, koska Klevun `low_stock` kattaa myös ennakkomyynnin). Vain katalogi: Telia (`<slug>~<variantti>`), Elisa (`<slug>~<laitenumero>`), DNA (`<slug>~<Applen tuotekoodi>`, GraphQL persisted query, hash voi vanhentua), C&C (`<slug>`), Kärkkäinen (`<slug>~<partNumber>`, HCL Commerce REST), Multitronic (tuotenumero) |
| `lib/geo.js`, `lib/postcodes.json` | Sijainnit, etäisyydet ja säderajaus |
| `lib/catalog.js` | Katalogituotteet ja niiden kauppakohtaiset tuotenumerot |
| `lib/summary.js` | Kokoaa tuotteen tilan, historian ja seuraajat |
| `lib/db.js` | Vercel Blob: `users.json` (seurannat), `state.json` (viimeisin tila), `events.json` (täydennykset, 90 pv) |
| `api/tuote.js` | Palvelimella renderöity tuotesivu (`/tuote/:slug`, rewrite `vercel.json`:ssa) |
| `api/catalog.js` | Etusivun tuotelista |
| `lib/match.js`, `api/match.js` | Saman tuotteen etsiminen kaikista kaupoista koodien perusteella (`matchAll`) ja saman mallin kaikki värit (`matchModel`) |
| `api/search.js`, `api/check.js` | Haku kaikista kaupoista ja yhden tuotteen tarkistus |
| `api/watches.js` | Käyttäjän seurantojen ja push-tilausten luku ja tallennus |
| `api/test-push.js` | Testi-ilmoitus käyttäjän kanaviin (sähköposti vain tallennetuista tiedoista) |
| `api/cron.js` | Taustatarkistus, historia ja ilmoitukset. Tila kirjoitetaan vain, kun saatavuus, hinta tai kuva muuttuu (Blobin ilmaiskiintiö). |
| `api/rematch.js` | Seurantojen uudelleenhaku kerran yössä (GitHub Actions, sama `CRON_SECRET`) |
| `public/` | Etusivu, `style.css`, `user.js` (seurannat ja push-tilaus), `sw.js` ja kuvakkeet |
| `api/manifest.js` | Käyttäjäkohtainen manifest, jotta Koti-valikon sovellus avautuu omalla listalla (iOS:ssä eri tallennustila kuin Safarilla) |

Blobin CDN voi palauttaa noin minuutin vanhaa dataa. Siksi `user.js` pitää seurannoista oman kopion selaimessa ja käyttää versiota, jonka `savedAt` on uudempi.

## Uuden katalogituotteen lisäys

Hae tuotenumerot (`/api/search?q=...`, muille tuotesivun osoitteesta ja lähdekoodista) ja lisää rivi `lib/catalog.js`:ään. Saman tuotteen tunnistaa eri kaupoissa Applen tuotekoodista (esim. MK2D4QN/A) tai EAN-koodista.

## Ympäristömuuttujat (Vercel)

- `BLOB_READ_WRITE_TOKEN` – Vercel Blob (store `restock-fi`)
- `DATA_KEY` – satunnainen polkuosa, ettei julkisen storen tiedostoja voi arvata
- `CRON_SECRET` – sama arvo myös GitHubin repo-secretinä `CRON_SECRET`
- Katalogituotteen seuranta (`product`) käyttää aina `lib/catalog.js`:n nykyistä kauppalistaa, joten uudet kaupat tulevat vanhoihin seurantoihin automaattisesti.
- Funktiot ajetaan Tukholmassa (`regions: arn1` `vercel.json`:ssa), lähellä kauppoja.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` – Web Push. Julkinen avain on myös `public/user.js`:ssä.

## Ajo ja julkaisu

```
vercel dev      # paikallisesti
vercel --prod   # julkaisu
```

## Rajoitukset

- Gigantti (Vercel Security Checkpoint), Tector, Proshop ja Jimms estävät automaattiset haut. Niitä ei kierretä. Luvallinen reitti on affiliate-feed tai kaupan oma rajapinta.
- Täydennyshistoria on vain niin tarkka kuin tarkistusväli (2 min). Jos GitHub ei käynnistä uutta ajoa ennen kuin edellinen päättyy (6 h), väliin voi jäädä katko.
- Teliasta ja Veikon Koneesta saadaan vain myymälöiden yhteinen tila (kyllä/ei), joten säde ei rajaa niiden myymälöitä. Elisa, DNA ja C&C kertovat tilan (saatavilla/ei) mutta eivät kappalemäärää.

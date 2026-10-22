# Restock.fi (MVP)

Tech-tuotteiden varastovahti. Seuraa samaa tuotetta usealla kaupalla, kirjaa täydennyshistorian ja ilmoittaa puhelimeen, kun tuote tulee saataville (valinnaisesti alle rajahinnan ja missä tahansa värissä). Kaupat: Verkkokauppa.com, Power, Prisma (kaikki S-ryhmän myymälät), Telia, Elisa, DNA, C&C, Kärkkäinen, Veikon Kone ja Multitronic, myös myymäläkohtaisesti. Ilmoitukset voi rajata postinumeron tai paikkakunnan ja säteen mukaan.

Live: https://restock-fi.vercel.app

## Miten toimii

- **Tuoterekisteri** (`lib/products.js`, `products.json`): katalogi syntyy kysynnästä. Kun joku alkaa seurata tuotetta, palvelin etsii sen kaikista kaupoista ja liittää seurannan rekisterin tuotteeseen tai luo uuden. Seuranta on pelkkä viittaus (`{ id, product, maxPrice }`), joten tuotteen kaupat ovat yhteiset ja nyt tai myöhemmin löytyvät uudet kaupat hyödyttävät kaikkia seuraajia. Käyttäjäkohtainen on vain maksimihinta (sekä sijainti ja säde käyttäjän asetuksissa).
- **Tunnistus**: sama tuote tunnistetaan ensin EAN-koodista, sitten vahvasta valmistajan koodista (esim. MK2D4QN/A) ja viimeisenä kaupan tunnuksesta (`store:id`). Koodit tulevat tarjouksista, jotka `matchAll` on jo varmistanut. Jos molemmilla on saman tason koodeja mutta yksikään ei ole yhteinen, kyse on eri tuotteesta. Väärä yhdistäminen näkyisi julkisesti, joten epävarmassa tapauksessa syntyy mieluummin kaksi tuotetta. "Mikä tahansa väri" on oma tuotteensa: malli ja tallennustila (esim. "256gb duo iphone") ja lisäksi vähintään yksi yhteinen tarjous.
- **Rekisterin rivi**: slug (luettava, esim. `apple-iphone-duo-256-gt-yotaivas`, törmäyksessä `-2`), nimi (kaupan tuotenimi ilman valmistajan koodia, ei käyttäjän kirjoittama), kuva, tarjoukset, tunnistusavaimet (`keys`), `anyColor` ja luontiaika. Rekisteriin kirjoittaa vain palvelin (`/api/match` ja `/api/rematch`), ja vain kun syntyy uusi tuote tai tiedot täydentyvät. Kirjoitus tehdään ETag-ehdolla (`update` `lib/db.js`:ssä): jos joku muu ehti kirjoittaa välissä, muutos tehdään uudelleen uusimpaan versioon. Samoin tallennetaan `users.json`, joten eri käyttäjien samanaikaiset tallennukset eivät hävitä toisiaan.
- **Tuotesivut** (`/tuote/<slug>`): jokaisella rekisterin tuotteella on julkinen sivu, jolla näkyvät hinnat ja tila kaupoittain, täydennykset 30 päivältä, viimeiset täydennykset kestoineen, seuraajamäärä ja Seuraa-nappi. Sivulla on vain kauppojen data ja seuraajamäärä, ei käyttäjäkohtaista tietoa. Tila ja historia ovat tarjouskohtaisia (`store:id`), joten historia kertyy jokaiselle tuotteelle. Seurannasta on linkki tuotteen sivulle.
- **Etusivu** (`/api/catalog`): `lib/catalog.js`:n tuotteet ovat rekisterin siemen ja näkyvät aina. Käyttäjien luomat tuotteet näkyvät, kun seuraajia on vähintään `MIN_WATCHERS` (2). Järjestys on seuraajamäärän mukaan. Ilman seuraajia tuote putoaa listalta, mutta sivu jää.
- **Automaattinen yhdistäminen** (`lib/match.js`, `POST /api/match`): käyttäjä valitsee tuotteen yhdestä kaupasta, ja palvelu etsii saman tuotteen muista kaupoista EAN-koodilla, valmistajan koodilla (esim. MK2D4QN/A) tai nimellä. Jokainen ehdokas varmistetaan kaupan omasta tuotedatasta. Jos molemmilla on eri vahva valmistajan koodi tai eri EAN, kyse on eri tuotteesta. Lyhyt numerokoodi (esim. Nintendon 220001) tai pelkkä nimi vaatii lisäksi lähes saman nimen ja samaa luokkaa olevan hinnan. Automaattinen yhdistäminen kattaa Verkkokauppa.comin, Powerin, Prisman, Veikon Koneen, Multitronicin, Kärkkäisen, Telian, Elisan ja DNA:n. Operaattoreilla ei ole palvelimelta toimivaa hakua: Telian mallisivu päätellään nimestä (`apple-iphone-duo`, `playstation-5-pro`) ja variantti valitaan EAN:n tai SKU:n perusteella, Elisa haetaan sivukartasta ja värivariantti lähekkäisistä laitetunnuksista EAN:n perusteella, DNA:n osoite muodostetaan (Applen puhelimet) tai haetaan kategoriasivuilta. C&C on mukana vain katalogituotteissa. Jos kauppa myy saman tuotteen eri EAN-koodilla (esim. Elisan PS5 Pro), yhdistäminen ei löydä sitä, ja se lisätään katalogiin käsin.
- **Mikä tahansa väri** (`matchModel` `lib/match.js`:ssä, `anyColor`): seurantaan tulevat saman mallin kaikki värit kaikista kaupoista. Värit luetaan Telian mallisivun varianteista, Elisan saman ryhmän (`groupId`) laitteista ja DNA:n värivalitsimesta. Muissa kaupoissa haetaan mallin nimellä ilman väriä ja vielä jokaisella muualta löytyneellä värillä. Ehdokas hyväksytään, kun nimi on sama värisanoja lukuun ottamatta, tallennustila on sama ja hinta samaa luokkaa, joten esim. 512 Gt tai Pro Max ei mene läpi. Ilmoituksessa on väri ja kauppa ("Apple iPhone Duo 256GB yötaivas, Telia"), ja samalla ajolla saatavilla tulleet värit kootaan yhteen ilmoitukseen.
- **Uudelleenhaku yöllä** (`api/rematch.js`, `.github/workflows/rematch.yml`): kerran vuorokaudessa rekisterin tuotteet (katalogi ja ne, joilla on seuraajia) haetaan uudelleen, ja kaupat, joihin tuote on tullut myyntiin, lisätään tuotteelle. Mitään ei poisteta, ja `products.json` kirjoitetaan vain, jos jotain lisättiin. Seurannan "Etsi muista kaupoista" -nappi tekee saman heti.
- Kirjautumista ei ole. Selain luo käyttäjäavaimen, ja linkillä `/?u=<avain>` saman listan saa auki toisella laitteella.
- **Taustatarkistus**: GitHub Actions (`.github/workflows/check.yml`, julkinen repo, joten minuutit ovat ilmaisia) kutsuu `/api/cron`-osoitetta 2 min välein. GitHub ajaa ajastetut työt usein tuntien viiveellä, joten yksi ajo pysyy käynnissä lähes 6 h ja silmukoi, ja seuraava odottaa jonossa. Cron tarkistaa katalogin ja seurattujen tuotteiden tarjoukset rekisteristä, kirjaa täydennykset (loppu → saatavilla → loppu) ja lähettää ilmoitukset.
- **Ilmoitukset** (`lib/notify.js`): ensisijaisesti Web Push (`public/sw.js`, VAPID-avaimet). iPhonessa push toimii vain, kun sivu on lisätty Koti-valikkoon (iOS 16.4+), ja sivu neuvoo tämän. Lisäksi halutessa sähköposti, joka välitetään [ntfy.sh](https://ntfy.sh):n kautta. ntfy-sovelluksesta luovuttiin, koska iOS-versio näytti viestit viiveellä.
- **Säde** (`lib/geo.js`): käyttäjä antaa postinumeron tai paikkakunnan ja säteen. Ilmoitus tulee, kun tuotetta on verkkokaupassa tai säteen sisällä olevassa myymälässä. Myymälän sijainti haetaan postinumerosta tai paikkakunnasta (`lib/postcodes.json`, GeoNames FI, CC-BY 4.0). Tuntemattoman sijainnin myymälä lasketaan mukaan, jotta ilmoitus ei jää tulematta.
- Kun sivu on auki, se tarkistaa saldot myös itse 2 min välein ja näyttää selainilmoituksen.

| Tiedosto | Tehtävä |
|---|---|
| `lib/stores.js` | Kauppakohtainen haku ja saldotarkistus. Jokainen palauttaa `web` (verkkokauppa) ja `shops` (myymälät). Haku: VK, Power, Prisma, Veikon Kone (Klevu-haku, id = EAN, verkkosaatavuus tuotesivun `stockStatusData`-kentästä, koska Klevun `low_stock` kattaa myös ennakkomyynnin). Ilman omaa hakua (yhdistäminen tai katalogi): Telia (`<slug>~<variantti>`), Elisa (`<slug>~<laitenumero>`), DNA (`<slug>~<Applen tuotekoodi>`, GraphQL persisted query, hash voi vanhentua), C&C (`<slug>`), Kärkkäinen (`<slug>~<partNumber>`, HCL Commerce REST), Multitronic (tuotenumero) |
| `lib/geo.js`, `lib/postcodes.json` | Sijainnit, etäisyydet ja säderajaus |
| `lib/catalog.js` | Rekisterin siemen: katalogituotteet ja niiden kauppakohtaiset tuotenumerot |
| `lib/products.js` | Tuoterekisteri: tunnistus, uuden tuotteen luonti, tarjousten lisäys ja seuraajamäärät |
| `lib/summary.js` | Kokoaa tuotteen tilan, historian ja seuraajat |
| `lib/db.js` | Vercel Blob: `users.json` (seurannat), `products.json` (tuoterekisteri), `state.json` (viimeisin tila ja ilmoitustila), `events.json` (täydennykset, 90 pv). `update` = luku ja kirjoitus ETag-ehdolla |
| `api/tuote.js` | Palvelimella renderöity tuotesivu (`/tuote/:slug`, rewrite `vercel.json`:ssa) |
| `api/catalog.js` | Etusivun tuotelista seuraajamäärän mukaan |
| `lib/match.js`, `api/match.js` | Saman tuotteen etsiminen kaikista kaupoista koodien perusteella (`matchAll`) ja saman mallin kaikki värit (`matchModel`). `POST /api/match` palauttaa rekisterin tuotteen ja luo sen tarvittaessa |
| `api/search.js`, `api/check.js` | Haku kaikista kaupoista ja yhden tuotteen tarkistus |
| `api/watches.js` | Käyttäjän seurantojen ja push-tilausten luku ja tallennus. GET palauttaa myös seurattujen tuotteiden tiedot. Tyhjä lista ilman ilmoituskanavia poistaa käyttäjän |
| `api/test-push.js` | Testi-ilmoitus käyttäjän kanaviin (sähköposti vain tallennetuista tiedoista) |
| `api/cron.js` | Taustatarkistus, historia ja ilmoitukset. Tila kirjoitetaan vain, kun saatavuus, hinta tai kuva muuttuu (Blobin ilmaiskiintiö). |
| `api/rematch.js` | Rekisterin tuotteiden uudelleenhaku kerran yössä (GitHub Actions, sama `CRON_SECRET`) |
| `public/` | Etusivu, `style.css`, `user.js` (seurannat ja push-tilaus), `sw.js` ja kuvakkeet |
| `api/manifest.js` | Käyttäjäkohtainen manifest, jotta Koti-valikon sovellus avautuu omalla listalla (iOS:ssä eri tallennustila kuin Safarilla) |

Blobin CDN voi palauttaa minuutista muutamaan minuuttiin vanhaa dataa, joten etusivu ja tuotesivu päivittyvät viiveellä. Päivitykset (`update`) lukevat uusimman version ja tarkistavat sen ETagin. Siksi `user.js` pitää seurannoista oman kopion selaimessa ja käyttää versiota, jonka `savedAt` on uudempi, ja tuotesivu hakee juuri luodun tuotteen suoraan tallennustilasta.

## Katalogi käsin

Katalogia ei tarvitse ylläpitää, koska tuotteet syntyvät seurannoista. `lib/catalog.js`:ään kannattaa lisätä tuote vain, jos sen halutaan näkyvän etusivulla aina tai jos automaattinen yhdistäminen ei löydä jotakin kauppaa (C&C, eri EAN-koodi). Rivin tarjoukset yhdistetään rekisterin tuotteeseen samalla slugilla.

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

- Gigantti (Vercel Security Checkpoint), Tector, Proshop ja Jimms estävät automaattiset haut. Niitä ei kierretä. Luvallinen reitti on affiliate-feed tai kaupan oma rajapinta.
- Täydennyshistoria on vain niin tarkka kuin tarkistusväli (2 min). Jos GitHub ei käynnistä uutta ajoa ennen kuin edellinen päättyy (6 h), väliin voi jäädä katko.
- Teliasta ja Veikon Koneesta saadaan vain myymälöiden yhteinen tila (kyllä/ei), joten säde ei rajaa niiden myymälöitä. Elisa, DNA ja C&C kertovat tilan (saatavilla/ei) mutta eivät kappalemäärää.

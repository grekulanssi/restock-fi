# Restock.fi (MVP)

Varastovahti, joka seuraa samaa tuotetta usealla kaupalla ja ilmoittaa puhelimeen, kun tuote tulee saataville (valinnaisesti alle rajahinnan). Kaupat: Verkkokauppa.com, Power ja Prisma.

Live: https://restock-fi.vercel.app

## Miten toimii

- Käyttäjä hakee tuotteen kerran, ja haku kohdistuu kaikkiin kauppoihin. Käyttäjä valitsee osumista saman tuotteen eri kaupoista, ja niistä tulee yksi seuranta.
- Kirjautumista ei ole. Selain luo käyttäjäavaimen, ja linkillä `/?u=<avain>` saman listan saa auki toisella laitteella.
- Taustatarkistus: GitHub Actions (`.github/workflows/check.yml`) kutsuu `/api/cron`-osoitetta 30 min välein (yksityisen repon ilmaisminuutit riittävät tähän). Kun tuote tulee saataville, ilmoitus lähtee [ntfy.sh](https://ntfy.sh):n kautta käyttäjän aiheeseen ja halutessa sähköpostiin.
- Kun sivu on auki, se tarkistaa saldot myös itse 2 min välein ja näyttää selainilmoituksen.

| Tiedosto | Tehtävä |
|---|---|
| `lib/stores.js` | Kauppakohtainen haku ja saldotarkistus (VK: tuotesivun `stocks`-data, Power: `/api/v2`, Prisma: storefront-api + tuotesivun schema.org) |
| `lib/db.js` | `users.json` (seurannat) ja `state.json` (viimeisin tila) Vercel Blobissa |
| `api/search.js` | Haku kaikista kaupoista, tai suoraan tuotelinkillä |
| `api/check.js` | Yhden tuotteen saldo ja hinta |
| `api/watches.js` | Käyttäjän seurantojen luku ja tallennus |
| `api/cron.js` | Taustatarkistus ja ilmoitukset. Tila kirjoitetaan vain muutoksista (Blobin ilmaiskiintiö). |
| `public/index.html` | Käyttöliittymä |

## Ympäristömuuttujat (Vercel)

- `BLOB_READ_WRITE_TOKEN` – Vercel Blob (store `restock-fi`)
- `DATA_KEY` – satunnainen polkuosa, ettei julkisen storen tiedostoja voi arvata
- `CRON_SECRET` – sama arvo myös GitHubin repo-secretinä `CRON_SECRET`

## Ajo ja julkaisu

```
vercel dev      # paikallisesti
vercel --prod   # julkaisu
```

## Rajoitukset

- Gigantti ja Proshop estävät palvelinhaut (429/403), joten ne puuttuvat.
- Prismasta saadaan vain verkkokaupan saatavuus, ei myymäläkohtaista saldoa. Powerista saadaan myymälöiden määrä, ei myymälöiden nimiä.
- GitHubin ajastus voi myöhästyä muutamia minuutteja ruuhka-aikoina.

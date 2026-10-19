# Restock.fi (MVP)

Varastovahti: ilmoittaa, kun seurattu tuote tulee varastoon (verkossa tai myymälässä) ja hinta on alle asetetun rajan. Toistaiseksi vain Verkkokauppa.com.

## Miten toimii

- `api/check.js` – Vercel-funktio. Hakee tuotesivun (`/fi/product/<pid>`) ja lukee sivun `stocks`-datasta saldot verkkoon ja myymälöihin sekä schema.org-datasta nimen ja hinnan.
- `public/index.html` – käyttöliittymä. Seurattavat tuotteet tallentuvat selaimen localStorageen. Sivu tarkistaa tuotteet 2 min välein niin kauan kuin se on auki. Ilmoitus tulee selainilmoituksena ja halutessa [ntfy](https://ntfy.sh)-sovellukseen.

Ei tietokantaa, ei kirjautumista eikä taustaseurantaa.

## Ajo ja julkaisu

```
vercel dev      # paikallisesti
vercel --prod   # julkaisu
```

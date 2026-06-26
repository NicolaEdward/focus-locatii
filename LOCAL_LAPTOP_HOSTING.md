# Hosting de pe laptop + integrare Wix

Aplicatia poate rula de pe laptop, dar laptopul devine serverul public. Asta inseamna:

- laptopul trebuie sa stea pornit
- aplicatia trebuie sa ruleze permanent
- internetul trebuie sa fie stabil
- daca laptopul intra in sleep, site-ul cade
- parolele si baza de date trebuie protejate

Pentru o prezentare comerciala sau test, este OK. Pentru productie serioasa, Vercel/VPS ramane mai stabil.

## Varianta recomandata pentru laptop: tunel HTTPS

Tunelul expune `http://localhost:3001` pe internet fara port forwarding in router.

### Optiunea A: ngrok

Este cea mai simpla daca domeniul/DNS ramane in Wix.

1. Creeaza cont pe ngrok.
2. Instaleaza ngrok pe laptop.
3. Autentifica ngrok:

```powershell
ngrok config add-authtoken TOKENUL_TAU
```

4. Porneste aplicatia:

```powershell
npm run build
npm run start:laptop
```

5. In alt terminal:

```powershell
ngrok http 3001
```

Vei primi un URL de forma:

```text
https://ceva.ngrok-free.app
```

Acest URL poate fi pus in Wix ca link sau iframe.

Pentru `locatii.focusmedia.ro`, ai nevoie de domeniu custom in ngrok si CNAME in Wix DNS catre targetul dat de ngrok.

### Optiunea B: Cloudflare Tunnel

Este foarte buna tehnic, dar pentru `locatii.focusmedia.ro` trebuie ca domeniul sa fie gestionat in Cloudflare sau sa configurezi corect DNS-ul cu Cloudflare.

Flux general:

```powershell
cloudflared tunnel --url http://localhost:3001
```

Pentru domeniu custom:

```powershell
cloudflared tunnel create focus-locatii
cloudflared tunnel route dns focus-locatii locatii.focusmedia.ro
cloudflared tunnel run focus-locatii
```

## Varianta port forwarding

Foloseste asta doar daca stii sigur ca providerul de internet iti permite conexiuni inbound si nu esti in CGNAT.

Ai nevoie de:

- IP static sau Dynamic DNS
- port forwarding in router pentru 80/443
- reverse proxy, de exemplu Caddy sau Nginx
- certificat HTTPS
- firewall configurat corect

Nu recomand aceasta varianta pentru primul deploy.

## Integrare in Wix

### Recomandat: link in meniu

In Wix:

1. Edit Site
2. Menus & Pages
3. Add Menu Item
4. Link
5. Web Address
6. pui URL-ul public, de exemplu `https://locatii.focusmedia.ro`

### Alternativa: iframe

1. Add Elements
2. Embed Code
3. Embed a Site
4. pui URL-ul public
5. setezi containerul cat mai mare, ideal full width si inaltime mare

Iframe-ul poate fi mai dificil pe mobile si la print/PDF. Pentru aplicatia asta, linkul/subdomeniul este mai bun.

## Comenzi locale

Prima instalare:

```powershell
npm install
npm run db:init
```

Pornire productie:

```powershell
npm run build
npm run start:laptop
```

Pornire dezvoltare:

```powershell
npm run dev -- -p 3001
```

## Checklist inainte sa dai link clientilor

- schimba parola MySQL expusa in chat
- schimba `ADMIN_PASSWORD`
- seteaza laptopul sa nu intre in sleep
- foloseste HTTPS public, nu `http://localhost`
- testeaza de pe telefon, pe date mobile
- testeaza `/locatii`
- testeaza `/admin/locatii`
- testeaza import Excel
- testeaza WhatsApp
- testeaza Print / Save as PDF

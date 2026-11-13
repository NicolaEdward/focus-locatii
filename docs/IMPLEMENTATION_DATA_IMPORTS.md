# Date, importuri și dependențe — implementare

Data verificării: 13 noiembrie 2026. Bază audit: `ba83e0dbed5d50575e51ec735505dce54e9b20fc`.
Nu există migrare de schemă pentru acest lot. Nu s-au modificat date de producție și nu s-au încărcat fișiere în Google Drive.

## Comportamentul livrat

| Constatare | Implementare | Verificare locală |
| --- | --- | --- |
| SEC-DATA-001 | Proxy Drive numai pentru ID-uri legate de inventar; acces anonim numai la locații ACTIVE publicate; PNG/JPEG/GIF/WebP cu MIME și semnătură concordante; SVG respins; CSP sandbox și nosniff pe corp. Schițele raster publicate rămân accesibile deliberat. | Rută reală transpiliată cu upstream sintetic: ID necunoscut/ascuns, SVG, MIME fals, PNG valid și schiță publicată. |
| SEC-DATA-002 | Numără octeții reali, oprește/cancel stream peste 15 MiB; AbortController la 10 secunde; limită distribuită 300 cereri/IP/minut; răspunsuri fără cache. | Stream incremental fără Content-Length și cu header fals; anularea upstream; deadline accelerat în testul rutei. |
| SEC-DATA-003 | Preview/diff obligatoriu înainte de import; protecție implicită a câmpurilor administrate manual; locațiile noi ascunse implicit, cu publicare explicită în formular; tarifele și montajul noi private. | Reimport real MySQL cu locație ascunsă, tarif public, montaj privat, GPS corectat, note și featured; toate se păstrează. |
| SEC-DATA-004 | `private, no-store`, `Vary: Cookie`, nosniff pentru descărcare binară, redirect și refuz acces. | 200/307/401 pe ruta reală cu documente sintetice. |
| SEC-DATA-005 | Existență, ACL și consistență client/campanie/rezervare/billing/creanță înainte de scriere; verificare repetată cu lock în tranzacție, inclusiv pe strămoșii implicați în ownership. | Matrice same-owner/foreign-owner/COO, legături încrucișate rezervare/factură și upload respins fără document creat. |
| REL-001 | Loturi atomice de maximum 250 locații, versiunile revalidate după lock la READ COMMITTED; batch, categorii, locații, imagini și audit în aceeași tranzacție; intenție idempotentă și consultarea rezultatului după timeout. | Eroare injectată după primul rând, eroare audit, preview expirat/modificat, confirmări concurente, replay, JSON și multipart Excel reale. |
| REL-004 | Next și dependențe afectate actualizate țintit, pinuri revizuite, un singur lockfile pnpm, verificare versiuni și SBOM CycloneDX. | Audit registry producție: 0 advisories la data verificării. Compatibilitatea finală build/roluri este și parte din integrarea tuturor loturilor. |

## Contractul importului

Ambele API-uri necesită în continuare `inventory.manage`. Un client care trimite direct un fișier sau lista JSON primește acum un **preview fără scrieri**. Confirmarea este o cerere separată cu același conținut și `previewToken` returnat. Aceasta este o schimbare intenționată de contract; integrarea care considera primul POST drept aplicare trebuie actualizată.

- Excel: `POST /api/import/excel`, formular multipart cu `file`, `action=preview` (implicit), `publishNewLocations=false` (implicit). Confirmarea trimite `action=confirm`, același fișier/opțiuni și `previewToken`.
- JSON: `POST /api/import/json`, corp `{ "locations": [...], "options": { "publishNewLocations": false, "overrideManagedFields": false } }`. Confirmarea adaugă `"action":"confirm"` și `"previewToken":"..."`.
- Preview-ul este semnat HMAC și legat de utilizator, hash-ul conținutului, opțiuni și versiunile locațiilor. Expiră în 10 minute pentru scrieri noi. Serverul recalculează toate valorile; nu acceptă difful clientului drept comandă de scriere.
- Maximum 250 locații per lot atomic; JSON maximum 5 MiB; Excel maximum 20 MiB și cerere multipart maximum 21 MiB, numărate din stream. Limitele parserului worker pentru ZIP/celule/formule/timp/memorie rămân active. Un volum mai mare trebuie împărțit în fișiere înainte de confirmare; nu există aplicare parțială implicită.
- La modificarea inventarului între preview și confirmare, serverul răspunde 409 și lotul se anulează integral. Generează un preview nou și verifică diferențele.
- Păstrează același token la retry. ID-ul intenției din preview este stabil: `inventory-<sha256(token), primele 40 caractere>`; cheia primară a `ImportBatch` serializează confirmările identice. Același token finalizat întoarce rezultatul original, inclusiv după expirarea perioadei de preview.
- `GET /api/import/batches/<intentId>` întoarce `completed` numai pentru un lot comis. `202 unknown` înseamnă că nu există încă rezultat comis vizibil; nu dovedește un eșec. UI oferă verificarea rezultatului după eroare și retry al aceleiași confirmări.

La reimport, implicit se păstrează: publicarea locației/tarifului/montajului, featured/premium, GPS real/display și proveniența/verificarea lui, mapsUrl, notele interne, galeria și schița. API-ul are opțiunea explicită `overrideManagedFields=true`, inclusă în preview și audit, pentru administratori cu aceeași capabilitate `inventory.manage`; UI nu o activează. Orice corecție istorică în masă sau republicare necesită o revizuire separată a diffului. Nu există backfill automat al datelor vechi.

Noile locații păstrează implicit politica ascunsă; bifa din formular permite publicarea numai a locațiilor noi din lot. Publicarea ulterioară a tarifelor/montajului se face prin editarea explicită existentă. Auditul stochează before/after pentru cele trei controale de publicare, hash-ul fișierului, numărul de rânduri și opțiunile, în aceeași tranzacție cu inventarul (`metadata.durability=business-transaction`).

Documentele istorice cu legături contradictorii sunt refuzate cu 422; nu sunt mutate sau reparate automat. Arhivarea și auditul ei sunt acum atomice. Răspunsurile nu expun mesaje brute Prisma sau conținutul documentului arhivat.

## Dependențe și triere

Instalarea canonică folosește `pnpm@10.28.0`, Node 24 și `pnpm-lock.yaml`. Lockfile-ul npm divergent a fost eliminat pentru a preveni instalarea grafului vulnerabil printr-o comandă diferită.

| Pachet | Audit | Implementare | Minim de securitate verificat |
| --- | --- | --- | --- |
| next | 15.5.19 | 15.5.29 | 15.5.28 |
| sharp | 0.35.3 | 0.35.5, override | 0.35.5 |
| postcss | 8.5.22 | 8.5.32, override | 8.5.23 |
| mysql2 | 3.22.5 | 3.24.6 | 3.23.1 |
| nanoid (ramura 3) | 3.3.16 | 3.3.20, override limitat la ramura 3 | 3.3.18 |
| source-map-js | 1.2.1 | 1.2.2, override | 1.2.2 |
| deepmerge-ts | 7.1.5 | 8.0.2, override | 8.0.0 |
| zod | 3.25.76 | 4.6.7 | 4.6.6 |

Nu s-a rulat `audit --fix`. Versiunile selectate și cerințele Node au fost interogate în registry; release-urile oficiale stabile au fost confirmate: [Next 15.5.29](https://github.com/vercel/next.js/releases/tag/v15.5.29) (3 noiembrie), [sharp 0.35.5](https://github.com/lovell/sharp/releases/tag/v0.35.5) (27 septembrie), [Zod 4.6.7](https://github.com/colinhacks/zod/releases/tag/v4.6.7) (12 octombrie). Next rămâne pe ramura 15.5. Migrarea Zod 4 include corecția explicită a câmpurilor PATCH cu defaults: omiterea unui câmp nu mai reaplică defaults de CREATE. Apelurile `z.record` trebuie să specifice schema cheii în integrarea CRM (`z.record(z.string(), z.unknown())`).

Trierea constatărilor inițiale (sursele sunt advisories upstream din audit, nu exploituri executate):

- [GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw), [GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) și advisories sharp justifică actualizarea împreună a Next și sharp, deoarece optimizerul de imagini era disponibil. Nu au fost folosite imagini malițioase.
- [GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36), condiționat de Windows, nu reprezenta o exploatare Vercel/Linux confirmată; versiunea a fost oricum eliminată din graf.
- Advisories Next cu Server Actions/rewrites/headere particulare au precondiții care nu au fost demonstrate în aplicație; patchul le acoperă fără excepții temporare.
- [GHSA-rgwj-5xj2-c3m3](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3) (mysql2), [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) (deepmerge-ts) și [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) (nanoid) nu aveau precondiții de exploatare confirmate; versiunile afectate au fost eliminate.
- [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) (postcss), [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) (source-map-js), [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) (Zod) sunt acoperite de versiunile noi.

Nu rămân excepții de registry asumate în acest lot. Zero advisories nu reprezintă o garanție de absență a tuturor vulnerabilităților; parserul XLSX vendored 0.20.3 are în continuare verificarea separată de format și regresie.

`pnpm run test:dependency-policy` verifică graful instalat și generează `artifacts/security/dependency-sbom.json` (CycloneDX 1.6, versiuni, purl-uri și SHA-256 al lockfile-ului, fără căi locale sau secrete). CI trebuie să ruleze și `pnpm audit --prod --audit-level high`; registrul se poate modifica după această verificare.

## Verificare reproductibilă

```bash
pnpm run test:media-boundaries
pnpm run test:document-access
pnpm run test:public-visibility
pnpm run test:spreadsheet-security
pnpm run test:dependency-policy
pnpm audit --prod --audit-level high
node scripts/release/run-with-env.cjs .env.implementation.local node_modules/.bin/tsx scripts/test-data-import-hardening.ts
```

Ultima suită refuză producția și orice DB care nu este locală și nu are prefixul `focus_preview_`. Creează numai fixture-uri sintetice proprii și le curăță. Integrarea finală trebuie să includă typecheck/build, imaginea logo benignă prin `/_next/image`, acces pe roluri și capturi desktop/mobil ale formularului. Nu s-a făcut deploy sau test de exploatare în producție în acest lot.

Politica conservatoare de respingere SVG poate afecta schițe SVG existente: acestea trebuie convertite în raster sau servite ulterior dintr-o origine separată, după o decizie explicită. Nu s-au convertit sau șters active existente și nu s-a inventariat producția.

## Extensie: mutațiile individuale ale inventarului

Crearea, editarea, duplicarea și ștergerea unei locații folosesc auditul durabil în aceeași tranzacție cu locația, categoria și imaginile sale. Rutele transmit actorul autentificat către comandă; comanda blochează rândul utilizatorului și verifică din nou `active`, rolul și `tokenVersion`, apoi sesiunea înregistrată dacă există. Un actor dezactivat, cu rol schimbat ori token/sesiune revocate nu mai poate scrie folosind rezultatul unei autorizări anterioare.

Crearea cere `inventory.create` sau `inventory.manage`; editarea, duplicarea și ștergerea cer `inventory.manage`. Datele complete pentru răspuns sunt citite înainte de commit, apoi serializate cu `reservationViewer` pentru a păstra protecția între portofolii. Erorile Prisma nu sunt expuse în răspunsuri.

Ștergerea blochează locația și verifică istoricul după lock la READ COMMITTED. Rezervările inclusiv anulate, taskurile inclusiv arhivate, rândurile de import financiar, istoricul GPS și blocajele de disponibilitate inclusiv închise împiedică ștergerea; se recomandă ascunderea locației. Numai imaginile proprii ale unei locații fără istoric pot fi eliminate împreună cu ea. Inserările concurente trebuie să păstreze FK-urile InnoDB către locație; verificarea schemei rămâne parte din preflight-ul de lansare.

`test:location-mutation-transactions` execută create/update/duplicate/delete reale într-o bază locală sintetică: injectează indisponibilitatea auditului după scriere, verifică rollback-ul categoriei/imaginilor și al cascadei de delete, actorul vechi pe toate cele patru rute, matricea de revocare a sesiunii și un insert de istoric între citirea actorului și lock-ul locației. Verifică și că PATCH-ul Zod 4 nu resetează câmpurile omise. Nu au fost schimbate utilitarele bulk GPS în această extensie.

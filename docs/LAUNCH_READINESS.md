# Pregatire pentru lansare

## Verificat la 23.06.2026

- build Next.js de productie: trecut;
- TypeScript strict: trecut;
- teste disponibilitate, pro-rata, facturare, RBAC si import financiar Excel real: trecute;
- smoke HTTP: trecut, inclusiv login, RBAC, revocare sesiune, rezervari, conflicte, sync si Excel;
- smoke vizual: trecut pentru portal public, inventar si dashboard pe desktop si mobil;
- consola browser: fara erori;
- baza Aiven: migrare COO/business foundation aplicata si repetabila;
- client accounts backfilled din inchirieri existente;
- billing items generate pentru inchirierile existente cu suma disponibila;
- dependinte: Next.js 15.5.19 si React 19.2.7, versiuni corectate pentru vulnerabilitatile RSC cunoscute.

## Conturi si environment

Variabile obligatorii: `DATABASE_URL`, `AUTH_SECRET`, `NEXT_PUBLIC_BASE_URL`, datele de contact publice si credentialele temporare de bootstrap. `AUTH_SECRET` trebuie sa aiba minimum 32 de caractere.

In Vercel, ruleaza `npm run db:migrate-rbac` o singura data pentru fiecare baza noua, apoi elimina `BOOTSTRAP_ADMIN_PASSWORD`. Creeaza conturile reale din `/admin/utilizatori` si verifica fiecare rol cu un utilizator dedicat.

## Probleme de date ramase

- auditul brut identifica 11 locatii fara `mainPhotoUrl`; portalul foloseste imagini alternative/fallback, dar fotografiile master trebuie completate;
- 2 locatii au status master `UNKNOWN`; statusul public este calculat defensiv, dar datele trebuie confirmate;
- dashboard-ul detecteaza 2 suprapuneri legacy. Acestea trebuie verificate comercial, nu sterse automat;
- fisierul HTML de referinta contine 8 coduri vechi care nu se regasesc identic in portofoliul curent; necesita decizie de business, nu import automat.

## Checklist lansare

- [x] RBAC in frontend, pagini server si API;
- [x] ownership pentru agenti;
- [x] dashboard-uri pe rol cu date reale;
- [x] validari financiare, perioade si suprapuneri;
- [x] sesiuni revocabile si audit;
- [x] loading, empty si error states pentru zona noua;
- [x] security headers si limite de upload/payload;
- [x] exporturile existente verificate;
- [x] import financiar Excel-first cu preview si Needs Review;
- [x] totaluri RON/EUR separate;
- [x] CRM cu lead-uri, contacte si activitati multiple;
- [x] facturare cu `invoiceDate` separat de `dueDate`;
- [x] export contabil lunar din BillingItems;
- [x] notificari interne pentru scadente si facturi de emis;
- [ ] rezolvare cele 2 conflicte legacy;
- [ ] completare fotografii si statusuri master;
- [ ] rotire parola MySQL si orice parola transmisa anterior in clar;
- [ ] completare manuala pentru inchirierile vechi fara suma/termen/regula facturare;
- [ ] creare conturi nominale pentru echipa;
- [ ] activare Vercel Firewall rate limiting si monitorizare erori;
- [ ] backup Aiven verificat prin restaurare intr-un mediu de test.

## Deploy

1. Ruleaza toate verificarile din README.
2. Aplica migrarile aditive pe baza tinta.
3. Configureaza variabilele Vercel pentru Production.
4. Deploy si ruleaza `npm run smoke:live`.
5. Testeaza manual login/logout, fiecare rol, hold -> BOOKED, solicitare -> CONTACTED, exporturile si taskurile operationale.

Lansarea tehnica poate continua dupa deploy si smoke live. Lansarea comerciala completa ramane conditionata de curatarea datelor marcate mai sus.

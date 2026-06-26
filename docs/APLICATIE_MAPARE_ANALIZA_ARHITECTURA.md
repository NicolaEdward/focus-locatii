# Analiza completa: Focus Media OOH Portal

Data analizei: 2026-06-25

## 1. Rezumat executiv

Aplicatia este deja mai mult decat un site de prezentare: este un portal operational OOH care leaga inventarul public de vanzari, hold-uri, campanii, operatiuni, CRM, financiar, utilizatori si audit. Modelul actual este un monolit Next.js App Router cu Prisma/MySQL si multe reguli de business in `src/lib`.

Punctele cele mai bune:

- inventarul, disponibilitatea si rezervarile folosesc aceeasi baza de date;
- exista separare public/admin si filtrare server-side pentru roluri;
- workflow-ul de hold -> inchiriere -> decorare -> neutralizare este modelat;
- exista module pentru financiar, CRM, furnizori, clienti, campanii, notificari si audit;
- exista teste rapide pentru disponibilitate, pro-rata, RBAC, billing si import financiar.

Cele mai mari riscuri arhitecturale:

- componente foarte mari, greu de intretinut: `AdminReservationsPanel.tsx`, `ClientCampaignsWorkspace.tsx`, `CooCommandCenter.tsx`, `FinancialDashboardPanel.tsx`;
- operatiunile de decorare/neutralizare sunt tinute in `productionNotes` ca metadata HTML, nu intr-o tabela dedicata;
- logica de business este duplicata intre `dashboard.ts`, `reservations.ts` si componente client;
- route handler-ele contin uneori prea multa logica de domeniu;
- lipsesc observabilitate, joburi programate reale, queue si notificari externe;
- initializarea Prisma este la import de modul, nu lazy;
- rate limiting-ul de login este local, nu distribuit.

Directia recomandata: pastreaza produsul ca monolit modular, dar reorganizeaza-l pe domenii clare: `inventory`, `sales`, `operations`, `crm`, `finance`, `identity`, `reporting`. Dupa aceea poti adauga taskuri operationale reale, notificari, calendare, pipeline comercial, rapoarte si automatizari fara sa rupi fluxurile existente.

## 2. Harta functionala completa

### 2.1 Public: portal de locatii

Rute:

- `/` redirectioneaza catre `/locatii`;
- `/locatii` afiseaza portofoliul public;
- `/locatii/[id]` afiseaza prezentarea unei locatii.

Functionalitati:

- harta interactiva cu Leaflet si marker clustering;
- filtre dupa cautare, categorie, oras/zona, format media, disponibilitate si premium;
- carduri de locatii cu status public si detalii comerciale;
- preview locatie din harta;
- prezentare locatie dedicata;
- shortlist local in browser prin `localStorage`;
- bara de media plan pentru selectii;
- export Excel pentru selectia de locatii;
- cerere de oferta din shortlist;
- contact prin WhatsApp/email;
- ascunderea datelor sensibile in API-ul public.

Date publice expuse:

- locatie, categorie, oras, tip, dimensiune, coordonate de display, imagini, status public;
- preturi doar daca `showPricePublic` este activ;
- cost montaj doar daca `showInstallationCostPublic` este activ;
- fara rezervari brute, note interne, rate card ascuns sau documente private.

Observatii:

- experienta este buna pentru explorare si selectie;
- urmatorul pas util ar fi media plan partajabil prin link, nu doar shortlist local;
- ar fi util un formular de oferta mai bogat: perioada dorita, buget, tip campanie, atasamente brief.

### 2.2 Admin: inventar si locatii

Rute:

- `/admin/locatii`;
- `/admin/locatii/import`;
- `/admin/locatii/gps`;
- API-uri: `/api/locations`, `/api/locations/[id]`, `/api/import/excel`, `/api/import/json`, `/api/gps/*`, `/api/export/*`.

Functionalitati:

- lista completa de locatii;
- cautare dupa cod, adresa, oras, tip, categorie;
- editare locatie;
- adaugare locatie;
- duplicare locatie;
- stergere doar daca nu exista rezervari legate;
- toggle public/pret public;
- editare status si availability text;
- import Excel;
- export JSON/CSV;
- audit GPS;
- resetare coordonate display;
- raspandire coordonate suprapuse;
- restaurare coordonate din Google Maps.

Puncte bune:

- exista `LocationEditor` si validari;
- API-urile de mutatie cer `inventory.manage`;
- stergerea este protejata cand exista rezervari;
- GPS are fluxuri dedicate.

Riscuri:

- statusul static al locatiei poate intra in conflict mental cu disponibilitatea calculata din rezervari;
- multe editari rapide se fac direct din tabel, ceea ce poate fi greu de auditat granular;
- importul si normalizarea datelor ar trebui sa aiba un pipeline de staging/preview permanent.

### 2.3 Vanzari: solicitari, hold-uri, rezervari, inchirieri

Rute/API:

- UI principal in `/admin/locatii#rezervari`;
- `/api/offer-requests`;
- `/api/offer-requests/[id]`;
- `/api/reservations`;
- `/api/reservations/[id]`;
- `/api/admin/reservations/sync`;
- `/api/admin/seller-reassignments`;
- `/api/admin/sellers`.

Functionalitati:

- solicitare publica intra ca lead `OfferRequest`;
- agentul preia solicitari;
- statusuri solicitare: `NEW`, `CONTACTED`, `QUOTED`, `WON`, `LOST`, `ARCHIVED`;
- selectie una sau mai multe locatii;
- creare hold intern;
- expirare automata dupa 5 zile;
- verificare suprapuneri pe locatie si perioada;
- grup contractual pentru mai multe locatii;
- impartire chirie pe locatii;
- conversie in `BOOKED` doar cu client si campanie reale;
- tranzitii controlate de rol;
- seller asignat automat pentru agenti/directori;
- COO/SUPER_ADMIN pot reasigna seller;
- audit pentru actiuni critice;
- istoric prin `RentalChangeLog` si `RentalPriceSegment`.

Puncte bune:

- regula de conflict este centralizata in `assertNoReservationConflict`;
- tranzitiile sunt separate in `reservation-workflow`;
- `BOOKED` cere client/campanie reale, reducand datele text legacy;
- exista ownership pentru agenti.

Riscuri:

- `HOLD` si `RESERVED` par aproape sinonime in UI, pot crea confuzie;
- update-ul de grup si update-ul individual au reguli usor diferite;
- logica de creare/editare rezervari este mare si greu de testat integral;
- nu exista inca un calendar vizual clar pentru disponibilitate pe fiecare locatie.

### 2.4 Campanii si clienti

Rute/API:

- `/admin/clienti`;
- `/admin/campanii`;
- `/api/admin/clients`;
- `/api/admin/clients/[id]`;
- `/api/admin/clients/[id]/contacts`;
- `/api/admin/clients/merge`;
- `/api/admin/campaigns`;
- `/api/admin/campaigns/[id]`;
- `/api/admin/client-campaigns`.

Functionalitati:

- creare si editare client account;
- contacte client;
- owner de cont;
- campanii cu firma contractanta, seller, perioada, moneda, valoare, termeni de plata;
- arhivare campanie daca nu are inchirieri active;
- cautare clienti/campanii;
- detectare clienti duplicati;
- detectare facturi duplicate;
- detectare clienti care par de fapt nume de campanii;
- documente atasate client/campanie/rezervare/factura;
- redecorare pe locatie din modulul de campanii.

Puncte bune:

- exista separare intre client real si campanie;
- merge de clienti actualizeaza multe legaturi;
- modulul are rol de data-cleanup, nu doar CRUD.

Riscuri:

- `ClientCampaignsWorkspace` este prea mare si combina clienti, campanii, facturi, cleanup, documente si redecorari;
- campaniile din `Campaign` si inchirierile din `Reservation` pot deveni greu de sincronizat daca evolueaza separat;
- lipsesc campanii cu pachete/line-items clare, bugete si obiective.

### 2.5 Operatiuni: decorari, neutralizari, taskuri

Surse:

- date din `Reservation.installationDate`, `Reservation.neutralizationDate`, `periodStart`, `periodEnd`;
- status operational in `productionNotes` prin `operation-status.ts`;
- API: `/api/reservations/[id]/operations`;
- Command Center: `/api/admin/command-center`.

Functionalitati:

- lista decorari;
- lista neutralizari;
- statusuri: `NEW`, `IN_PROGRESS`, `DONE`, `ARCHIVED`;
- redecorari extra;
- arhivare/finalizare;
- taskurile finalizate ies din lista activa si raman in istoric prin metadata;
- COO poate actiona direct din command center.

Puncte bune:

- exista concept operational real;
- exista audit;
- exista rol dedicat `campaigns.operate`.

Riscuri majore:

- taskurile nu sunt entitati relationale, ci metadata in text;
- este greu sa faci rapoarte operationale serioase: cost, echipa, SLA, poze before/after, status pe furnizor;
- logica de generare a taskurilor exista in mai multe locuri;
- nu exista calendar operational, alocare echipe sau checklist mobil.

Recomandare: introdu tabela `OperationTask` si migreaza treptat metadata veche.

### 2.6 COO Command Center

Rute:

- `/admin/dashboard` pentru rol COO afiseaza `CooCommandCenter`.

Functionalitati:

- overview operational;
- problem center;
- conflicte;
- hold-uri active si expirate;
- taskuri operationale;
- campanii active, incep curand, se termina curand;
- inventar disponibil/ocupat/blocat;
- CRM rapid;
- realocare vanzatori;
- exporturi rapide;
- actiuni directe pe rezervari si taskuri.

Puncte bune:

- este centrul nervos al aplicatiei;
- grupeaza problemele pe module si da actiune recomandata;
- combina vanzari, operational, inventar si financiar.

Riscuri:

- `dashboard.ts` si `CooCommandCenter.tsx` sunt foarte mari;
- problemele sunt calculate la cerere, nu materializate sau urmarite ca status real;
- unele actiuni ascund local randuri dupa click, dar nu exista refresh/stare centralizata;
- poate deveni lent daca baza creste mult.

### 2.7 CRM

Rute/API:

- `/admin/crm`;
- `/api/admin/crm/leads`;
- `/api/admin/crm/leads/[id]`;
- `/api/admin/crm/leads/[id]/activities`.

Functionalitati:

- lead-uri CRM;
- contacte;
- activitati multiple;
- statusuri tip pipeline: Cold, Calificat, In analiza, In oferta, Negociere, Contractare, On Hold, Nu raspunde, Account Management, Castigat, Pierdut, Inactiv;
- follow-up;
- asignare vanzator;
- filtrare dupa status/vanzator/cautare;
- jurnal de activitati.

Puncte bune:

- exista diferenta intre lead si activitate;
- se poate urmari istoric de vanzari.

Riscuri:

- `OfferRequest` si `CrmLead` coexista si se pot dubla;
- nu exista conversie formala intre lead -> client -> campanie -> hold;
- lipsesc scoring, probabilitate, motive pierdere standardizate si reminder real.

### 2.8 Financiar

Rute/API:

- dashboard financiar in `/admin/dashboard` si module dedicate;
- `/admin/furnizori`;
- `/api/admin/financial/upload`;
- `/api/admin/financial/uploads/[id]/confirm`;
- `/api/admin/financial/summary`;
- `/api/admin/financial/export`;
- `/api/admin/financial/manual`;
- `/api/admin/financial/rows/[kind]/[id]`;
- `/api/admin/receivables/[id]/payment`;
- `/api/admin/receivables/merge`;
- `/api/admin/billing/export`;
- `/api/admin/suppliers`.

Functionalitati:

- import Excel financiar;
- preview inainte de confirmare;
- confirmare versiune activa;
- anulare import neconfirmat;
- randuri de plata si incasare;
- RON/EUR separat;
- firme multiple;
- furnizori;
- introducere manuala;
- review/excludere randuri;
- arhiva;
- export financiar;
- marcarea incasarilor;
- notificari interne pentru scadente/facturi.

Puncte bune:

- Excel-first este realist pentru business;
- exista separare payable/receivable;
- exista versiune activa de raport;
- testul de import financiar acopera un exemplu consistent.

Riscuri:

- financiarul este inca partial manual;
- `BillingItem` exista, dar pare decuplat de fluxul financiar activ;
- reconcilierea intre contracte, facturi si incasari poate deveni complicata;
- lipseste integrare cu contabilitate/e-Factura/banca.

### 2.9 Utilizatori, roluri, sesiuni, audit

Rute/API:

- `/admin/login`;
- `/admin/utilizatori`;
- `/api/auth/login`;
- `/api/auth/logout`;
- `/api/auth/session`;
- `/api/admin/users`;
- `/api/admin/users/[id]`.

Functionalitati:

- login cu cookie HttpOnly;
- token HMAC;
- sesiune 12 ore;
- tokenVersion pentru revocare sesiuni;
- parole cu scrypt;
- roluri: SUPER_ADMIN, COO, SALES_DIRECTOR, SALES_AGENT, FINANCE_OPERATOR;
- permisiuni centralizate in `rbac.ts`;
- verificare permisiuni server-side;
- audit pentru actiuni importante;
- blocare temporara login dupa incercari esuate.

Puncte bune:

- autorizarea nu depinde doar de UI;
- schimbarea rolului/parolei poate revoca sesiunile;
- exista protectie basic de origine pentru mutatii.

Riscuri:

- rate limit local, nu distribuit;
- fara 2FA;
- fara politici de parole avansate;
- fara log centralizat/alerte pentru auth.

## 3. Harta tehnica

### Stack

- Next.js 15 App Router;
- React 19;
- TypeScript;
- Tailwind CSS;
- Prisma 6;
- MySQL;
- Leaflet si markercluster;
- XLSX pentru import/export;
- lucide-react pentru iconuri.

### Structura principala

- `src/app`: pagini si API route handlers;
- `src/components/public`: UI public;
- `src/components/admin`: UI intern;
- `src/lib`: business logic, queries, import/export, auth, RBAC;
- `src/types`: DTO-uri;
- `prisma/schema.prisma`: model relational;
- `scripts`: migrari, smoke tests, importuri, audituri.

### Modele principale de date

- Inventar: `Category`, `Location`, `Image`, `GpsAuditLog`, `ImportBatch`;
- Vanzari: `OfferRequest`, `Reservation`, `RentalPriceSegment`, `RentalChangeLog`;
- Clienti/campanii: `ClientAccount`, `ClientContact`, `Campaign`, `ClientDocument`;
- CRM: `CrmLead`, `CrmContact`, `CrmActivity`;
- Financiar: `BillingItem`, `FinancialReportUpload`, `FinancialReportCompanySnapshot`, `FinancialPayable`, `FinancialReceivable`, `FinancialImportIssue`;
- Furnizori: `Supplier`, `SupplierContact`;
- Sistem: `User`, `AppNotification`, `AuditLog`.

### API surface

Public:

- locatii publice;
- detalii locatie;
- solicitari oferta;
- shortlist Excel/print;
- poze Google Drive proxy;
- health db.

Admin:

- inventar;
- import/export;
- GPS;
- rezervari;
- operatiuni;
- command center;
- clienti;
- campanii;
- CRM;
- financiar;
- furnizori;
- utilizatori;
- notificari;
- rapoarte Excel.

### Teste rulate in analiza

Au trecut:

- `test-availability`;
- `test-prorata`;
- `test-rbac`;
- `test-billing`;
- `test-financial-import`;
- `typecheck`.

Nu am rulat smoke complet cu baza live/browser in aceasta analiza. O incercare de citire directa prin Prisma a fost blocata de conexiunea TLS din mediul curent.

## 4. Ce este bun

1. Produsul are un nucleu real de business, nu doar CRUD.
2. Disponibilitatea este calculata din rezervari active, ceea ce este corect.
3. Fluxul de vanzari protejeaza impotriva suprapunerilor.
4. `BOOKED` forteaza legarea la client si campanie reale.
5. RBAC este centralizat si verificat pe server.
6. Exista audit pentru multe actiuni critice.
7. Exista documentatie interna utila.
8. Exista teste pentru parti importante de business.
9. Financiarul are preview/confirmare, nu importa direct orbeste.
10. Command Center-ul COO este o baza buna pentru management operational.

## 5. Ce nu este bun sau va bloca scalarea

### 5.1 Componente prea mari

Cele mai mari fisiere:

- `AdminReservationsPanel.tsx` peste 100 KB;
- `ClientCampaignsWorkspace.tsx` peste 70 KB;
- `CooCommandCenter.tsx` peste 50 KB;
- `FinancialDashboardPanel.tsx` peste 40 KB;
- `dashboard.ts` peste 40 KB.

Problema: cand un fisier tine liste, formulare, filtre, mutatii, tabele, modale si logica de business, orice schimbare devine riscanta.

Recomandare: spargere pe subcomponente si hooks:

- `ReservationsToolbar`;
- `ReservationForm`;
- `ReservationTable`;
- `OperationTasksTable`;
- `OfferRequestsPanel`;
- `CampaignEditor`;
- `FinancialImportPanel`;
- `FinancialManualEntryModal`;
- `CooProblemCenter`;
- `CooOperationsTab`.

### 5.2 Operatiuni in text, nu in tabela

Decorari, neutralizari si redecorari sunt tinute in `productionNotes` prin comentariu HTML cu JSON.

Problema: greu de cautat, sortat, raportat, asignat, auditabil si integrat.

Model recomandat:

- `OperationTask`
  - `id`
  - `reservationId`
  - `campaignId`
  - `locationId`
  - `kind`: decoration / neutralization / redecoration / maintenance
  - `status`
  - `scheduledFor`
  - `completedAt`
  - `assignedToUserId`
  - `supplierId`
  - `cost`
  - `currency`
  - `briefUrl`
  - `beforePhotoUrl`
  - `afterPhotoUrl`
  - `notes`
  - `createdByUserId`

### 5.3 Logica duplicata

Exemple:

- derivarea taskurilor operationale exista in dashboard si in componenta client;
- ferestrele operationale existau hardcodate in mai multe locuri;
- statusurile si fallback-urile apar in mai multe straturi.

Recomandare: `src/modules/operations/task-service.ts` cu o singura functie:

- `listOperationalTasks(filters)`;
- `deriveBaseTasks(reservation)`;
- `createOperationTask`;
- `updateOperationTaskStatus`.

### 5.4 Route handlers prea incarcate

Unele API-uri contin validare, business logic, tranzactii, audit si serializare in acelasi fisier.

Recomandare:

- route handler = auth + parse + call command/query + response;
- business logic in `src/modules/<domain>/server`;
- DTO mappers separati.

### 5.5 Prisma la import

`src/lib/prisma.ts` creeaza clientul la module scope. Functioneaza, dar pentru build/deploy si testare este mai robust un getter lazy:

- `getPrisma()`;
- sau pastrarea exportului, dar creat prin functie interna lazy.

### 5.6 Lipsa observabilitate

Nu exista un sistem clar pentru:

- erori runtime;
- slow queries;
- evenimente importante;
- alerte cand importul financiar esueaza;
- alerte cand hold-urile expira;
- alerte cand taskurile operationale intarzie.

Recomandare: integrare cu Sentry/Logtail/Axiom sau Vercel Observability, plus loguri structurate.

### 5.7 Lipsa joburi programate

Acum expirarea hold-urilor ruleaza oportunist cand se listeaza rezervari/dashboard.

Recomandare:

- cron zilnic/orar pentru `expireHolds`;
- cron pentru notificari;
- cron pentru taskuri operationale restante;
- cron pentru backup/audit.

### 5.8 Client-side fetching fara cache standard

Componentele folosesc mult `fetch` manual si state local. Pentru module mari, asta produce refresh-uri partiale si stari greu de sincronizat.

Recomandare:

- SWR sau React Query pentru admin client state;
- sau Server Actions + `revalidatePath` pentru formulare simple;
- pattern consistent pentru optimistic updates si invalidare.

### 5.9 Fara paginare server-side peste tot

Multe liste iau 300/500/1000 randuri. Este acceptabil acum, dar va deveni lent.

Recomandare:

- paginare cursor-based;
- filtre server-side;
- indexuri pe cautari frecvente;
- exporturi async pentru rapoarte mari.

### 5.10 Design system insuficient formalizat

Exista clase globale bune (`focus-button`, `focus-input`, `focus-card`), dar nu exista primitive UI reutilizabile suficient de multe.

Recomandare:

- `Button`, `Input`, `Select`, `Textarea`, `Badge`, `Table`, `Modal`, `Tabs`, `Toast`, `ConfirmDialog`;
- reducerea stilurilor inline repetitive;
- stari standard: loading, empty, error, saved.

## 6. Arhitectura recomandata

### 6.1 Pastreaza monolitul, dar modularizeaza domeniile

Structura propusa:

```text
src/modules/
  identity/
    server/
    components/
    schemas.ts
    types.ts
  inventory/
    server/
    components/
    schemas.ts
    types.ts
  sales/
    server/
    components/
    schemas.ts
    types.ts
  operations/
    server/
    components/
    schemas.ts
    types.ts
  crm/
    server/
    components/
    schemas.ts
    types.ts
  finance/
    server/
    components/
    schemas.ts
    types.ts
  reporting/
    server/
    exporters/
    types.ts
```

Regula:

- `server/queries.ts`: citiri;
- `server/commands.ts`: mutatii;
- `server/policies.ts`: ownership si permisiuni de domeniu;
- `schemas.ts`: Zod;
- `types.ts`: DTO-uri;
- `components/`: UI domeniu.

### 6.2 Introdu un strat de comenzi si tranzactii

Exemple:

- `createHoldCommand`;
- `confirmReservationCommand`;
- `cancelReservationCommand`;
- `createCampaignCommand`;
- `createOperationTaskCommand`;
- `confirmFinancialUploadCommand`;
- `mergeClientsCommand`.

Fiecare comanda:

- valideaza input;
- verifica policy;
- ruleaza tranzactie;
- scrie audit;
- emite eveniment intern.

### 6.3 Evenimente interne

Adauga un `DomainEvent` simplu:

- `hold.created`;
- `hold.expired`;
- `reservation.booked`;
- `campaign.started`;
- `operation.overdue`;
- `invoice.overdue`;
- `payment.recorded`;
- `lead.won`.

La inceput pot fi doar randuri in DB. Mai tarziu pot declansa notificari, emailuri si joburi.

### 6.4 Tabele noi utile

Prioritare:

- `OperationTask`;
- `DomainEvent`;
- `AutomationRun` sau `JobRun`;
- `MediaPlan`;
- `MediaPlanItem`;
- `Quote` / `Offer`;
- `QuoteLineItem`;
- `CampaignLineItem`;
- `NotificationPreference`.

Optionale:

- `ActivityLog` unificat pentru user-facing timeline;
- `FileAsset` pentru documente/poze centralizate;
- `IntegrationCredential` daca apar integrari externe.

### 6.5 API-uri mai curate

Pe termen mediu:

- public APIs raman route handlers;
- admin mutations pot deveni Server Actions unde sunt formulare simple;
- route handlers raman pentru upload/export/webhook/external API;
- toate raspunsurile ar trebui sa treaca prin DTO mappers.

## 7. Idei pentru a face aplicatia mai utila

### 7.1 Pentru clienti

- media plan partajabil prin link public securizat;
- cerere oferta cu perioada dorita si buget;
- comparare locatii in shortlist;
- PDF/PowerPoint media plan generat automat;
- link de prezentare pentru fiecare campanie;
- disponibilitate vizuala pe calendar;
- recomandari automate de locatii similare.

### 7.2 Pentru vanzari

- conversie formala: solicitare -> CRM lead -> oferta -> hold -> booking;
- pipeline Kanban;
- reminder follow-up;
- scor lead;
- probabilitate si forecast;
- sabloane de oferta;
- calcul automat valoare propusa pe luna/perioada;
- istoric client complet intr-un timeline.

### 7.3 Pentru COO/operatiuni

- calendar operational saptamanal;
- taskuri alocate catre echipa/furnizor;
- checklist mobil pe locatie;
- upload poza before/after;
- costuri de decorare/redecorare/neutralizare;
- SLA si taskuri intarziate;
- blocari locatie cu motiv si expirare;
- mentenanta locatii.

### 7.4 Pentru financiar

- generare automata de billing items din contracte;
- reconciliere intre contract, factura si incasare;
- import bancar;
- export contabil standardizat;
- alerte automate pentru scadente;
- dashboard cashflow;
- aging report pe clienti si furnizori.

### 7.5 Pentru management

- ocupare pe oras/tip/supplier;
- profitabilitate pe locatie;
- venit recurent si forecast;
- top clienti;
- rate de conversie agenti;
- costuri operationale;
- campanii cu risc;
- inventar nevandut.

## 8. Roadmap recomandat

### Faza 1: Stabilizare arhitectura

1. Extrage modulele mari in subcomponente.
2. Introdu `OperationTask`.
3. Centralizeaza derivarea taskurilor operationale.
4. Muta logica route handlers in commands/queries.
5. Adauga paginare server-side pentru liste mari.
6. Adauga loguri structurate si error tracking.
7. Muta Prisma catre initializare lazy.

### Faza 2: Productivitate operationala

1. Calendar decorari/neutralizari.
2. Task assignment.
3. Poze before/after.
4. Notificari interne + email.
5. Cron pentru hold expiry si overdue tasks.
6. Media plan shareable.
7. Oferta generata din shortlist.

### Faza 3: Comercial si financiar avansat

1. Pipeline CRM complet.
2. Quote/offer model.
3. Contract/campaign line items.
4. Billing automation.
5. Reconciliere financiara.
6. Forecast vanzari.
7. Profitabilitate locatie/campanie.

### Faza 4: Platformizare

1. Observability complet.
2. CI/CD cu teste obligatorii.
3. Backup si restore drills.
4. Integrari externe: contabilitate, email, SMS/WhatsApp, Drive.
5. API public/privat versionat.
6. Permisiuni mai granulare pe echipe/zone.

## 9. Prioritati concrete

Prioritate maxima:

1. `OperationTask` relational.
2. Spargere `AdminReservationsPanel`.
3. Spargere `ClientCampaignsWorkspace`.
4. Centralizare logica taskuri/disponibilitate.
5. Cron pentru hold-uri si taskuri restante.
6. Observabilitate si erori.

Prioritate medie:

1. Media plan shareable.
2. Calendar disponibilitate.
3. Oferta/quote formal.
4. Paginare server-side.
5. UI primitives.
6. SWR/React Query sau Server Actions consistente.

Prioritate mai tarziu:

1. Integrari contabilitate/banca.
2. Workflow approvals avansat.
3. Multi-tenant sau multi-brand.
4. Predictii/AI pentru recomandari locatii.

## 10. Concluzie

Aplicatia are fundatie buna si deja rezolva o problema reala: transforma un inventar OOH si fisiere de disponibil intr-un sistem operational. Urmatorul salt nu este sa adaugi inca 20 de butoane, ci sa cureti nucleul: domenii separate, taskuri operationale reale, route handlers subtiri, componente mai mici, joburi programate si observabilitate.

Daca faci aceste schimbari, aplicatia poate creste natural din portal de locatii intr-un sistem complet de operare pentru OOH: vanzari, operatiuni, financiar, management si raportare.

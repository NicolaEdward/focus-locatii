# Prezentare aplicatie

## Scop

Aplicatia inlocuieste trimiterea manuala a fisierelor de disponibil cu un portal unic pentru clienti, echipa comerciala si operatiuni. Inventarul, perioadele ocupate si exporturile folosesc aceeasi sursa MySQL.

## Utilizatori

- clientul consulta locatii si cere oferta fara cont;
- agentul lucreaza lead-uri si creeaza hold-uri;
- directorul controleaza pipeline-ul si confirma vanzarile;
- COO urmareste ocuparea, riscurile si implementarea;
- administratorul gestioneaza accesul si datele master.

## Concepte principale

- `Location`: pozitie OOH, fata sau suport vandabil;
- `Reservation`: hold sau inchiriere pe o perioada;
- `OfferRequest`: solicitare publica si lead comercial;
- `ClientAccount` si `ClientContact`: client/account central, account owner si contacte;
- `CrmLead`, `CrmContact`, `CrmActivity`: pipeline CRM si jurnal de activitate dupa modelul Edward CRM;
- `BillingItem`: facturare asteptata calculata din inchirieri, cu `invoiceDate` separat de `dueDate`;
- `FinancialReportUpload`, `FinancialPayable`, `FinancialReceivable`: import financiar Excel-first, RON/EUR separat, preview si review;
- `AppNotification`: notificari interne pentru scadente, facturi de emis si follow-up financiar;
- `Category`: familie de suporturi;
- `Image` si coordonate GPS: prezentare comerciala si harta;
- operation metadata: starea decorarii si neutralizarii;
- `User` si `AuditLog`: acces intern si trasabilitate.

## Separarea datelor publice

API-ul public nu returneaza rezervari, note interne, linkuri originale private sau rate card ascuns. Preturile apar public doar daca `showPricePublic` este activ. API-urile de administrare necesita sesiune si permisiune.

## Module operationale

### Public listing

Clientul vede inventarul comercial, filtreaza locatii, selecteaza shortlist, cere oferta pe WhatsApp/email si poate exporta Excel-ul shortlistului. Datele sensibile nu sunt expuse public.

### Admin/vanzari

Vanzatorii creeaza hold-uri si inchirieri. Vanzatorul este preluat automat din contul logat pentru `SALES_AGENT` si `SALES_DIRECTOR`; COO/SUPER_ADMIN pot atribui controlat catre alt vanzator. Rezervarile verifica suprapunerile si genereaza disponibilitatea reala.

### COO Command Center

COO vede overview, probleme, campanii, CRM, operational, inventar, financiar, exporturi si admin. Problemele sunt grupate pe Operational, Vanzari, Financiar, CRM, Inventar si Date incomplete, cu descriere pe inteles si actiune recomandata.

### Financiar

Importul financiar porneste din Excel, detecteaza firme, furnizori/plati, clienti/incasari, moneda RON/EUR si randuri neclare. Raportul devine activ doar dupa confirmare. Randurile achitate/incasate integral nu incarca lista principala si raman in arhiva.

### CRM

CRM-ul are lead-uri, contacte si activitati multiple pe acelasi lead. Statusurile sunt modelate dupa spreadsheet-ul Edward CRM: Cold, Calificat, In analiza, In ofertare, In negociere, In contractare, On Hold, Nu raspunde, Account Management, Castigat, Pierdut, Inactiv.

## Limitari cunoscute

- statusurile operationale sunt pastrate momentan in metadatele notelor de productie, nu intr-un tabel separat de taskuri;
- notificarea este interna in aplicatie; trimiterea email automata ramane pas ulterior;
- rate limiting-ul de login este local fiecarei instante; pentru protectie distribuita se recomanda Vercel Firewall/Redis;
- aplicatia nu are inca observabilitate externa cu alerte si trasare distribuita;
- randurile financiare neclare trebuie validate manual inainte sa fie considerate finale.

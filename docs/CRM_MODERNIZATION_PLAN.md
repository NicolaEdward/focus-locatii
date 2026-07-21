# Focus Media CRM Modernization Plan

> Document istoric. Contractul canonic implementat este CRM v4, descris in
> `docs/CRM_V4_CONVERGENCE.md`. Referintele de mai jos la modelele CRM legacy,
> probabilitate manuala si forecast ponderat nu mai descriu produsul activ.

## 1. Objective

CRM-ul Focus Media trebuie sa devina instrumentul zilnic al vanzatorului, nu doar un tabel in care se introduc lead-uri.

Rezultatul dorit:

- fiecare vanzator stie ce trebuie sa faca azi;
- niciun lead activ nu ramane fara urmator pas;
- toate discutiile, intalnirile si ofertele sunt intr-un istoric unic;
- clientii existenti sunt reutilizati, nu duplicati;
- Selector oferta poate fi pornit direct din contextul oportunitatii;
- directorul de vanzari vede pipeline-ul echipei si blocajele;
- COO vede exceptii si forecast, nu fiecare detaliu operational;
- conversia in client, campanie si inchiriere este controlata si auditabila.

CRM-ul nu trebuie sa creeze automat rezervari, HOLD sau BOOKED.

## 2. Current State

### Existing technical foundation

Modelele existente acopera deja:

- `CrmLead`: companie, contact, owner, status, valoare estimata, probabilitate, data estimata de inchidere, follow-up si note;
- `CrmContact`: contacte multiple pentru lead;
- `CrmActivity`: telefon, email, vizita, meeting, follow-up, oferta trimisa si note;
- `ClientAccount`: registrul oficial de clienti;
- `Campaign`: campaniile contractate sau administrate;
- `OfferRequest`: solicitarile venite din portalul public;
- `AppNotification`: notificari interne;
- `User`: owner si responsabil comercial;
- audit pentru creare si actualizare.

### Existing data

La momentul auditului:

- 0 lead-uri CRM;
- 0 activitati CRM;
- 0 contacte CRM;
- 0 solicitari publice active;
- 26 clienti activi;
- 30 campanii;
- 3 utilizatori comerciali activi.

Aceasta inseamna ca redesignul poate fi facut fara migrarea unui volum CRM existent.

### Current product limitations

- pagina este un tabel lat, greu de folosit zilnic;
- toate cele maximum 500 de lead-uri, plus contacte si ultimele activitati, sunt incarcate dintr-o singura cerere;
- filtrele sunt executate numai in browser;
- nu exista pagina/drawer dedicat unui lead;
- nu exista vedere "Astazi";
- nu exista Kanban/pipeline vizual;
- nu exista notificari pentru follow-up CRM;
- nu exista conversie ghidata lead -> client -> campanie;
- solicitarile publice si lead-urile CRM sunt doua fluxuri separate;
- statusurile acceptate contin doua seturi legacy suprapuse;
- nu exista reguli obligatorii pentru urmatorul pas;
- nu exista forecast comercial coerent;
- nu exista detectie de client duplicat inainte de crearea lead-ului;
- campurile importante precum probabilitatea si expected close exista, dar nu sunt expuse complet in UI.

## 3. Product Principles

1. CRM-ul trebuie sa raspunda prima data la intrebarea: "Ce trebuie sa fac azi?"
2. Un lead activ trebuie sa aiba owner si urmator pas.
3. ClientAccount este registrul oficial de clienti; CRM-ul nu trebuie sa creeze duplicate.
4. Activitatile sunt jurnal permanent si nu se suprascriu.
5. Statusul descrie etapa comerciala, nu actiunea efectuata.
6. O activitate poate actualiza statusul si urmatorul follow-up intr-o singura salvare.
7. Selector oferta este instrumentul de selectie din contextul lead-ului.
8. HOLD si BOOKED se creeaza numai prin fluxurile comerciale existente, cu confirmare explicita.
9. Vanzatorul vede prioritatile proprii; directorul vede echipa; COO vede exceptii si forecast.
10. Lista foloseste DTO sumar si paginare; detaliile se incarca doar la deschidere.

## 4. Recommended Information Architecture

Ruta ramane:

- `/admin/crm`

Navigarea interna CRM:

### Astazi

Ecranul implicit pentru vanzator:

- follow-up-uri restante;
- follow-up-uri pentru azi;
- lead-uri fara urmator pas;
- lead-uri fara activitate recenta;
- oportunitati care se inchid curand;
- activitatea recenta proprie;
- actiune rapida: lead nou;
- actiune rapida: inregistreaza apel/meeting/email.

### Pipeline

Kanban pe etape comerciale:

- Nou;
- Calificat;
- Brief primit;
- Oferta in pregatire;
- Oferta trimisa;
- Negociere;
- Castigat;
- Pierdut;
- Nurture / revenire ulterioara.

Cardul trebuie sa arate:

- companie;
- contact principal;
- owner;
- valoare estimata;
- probabilitate;
- urmatorul follow-up;
- numar de zile in etapa;
- avertizare daca este restant;
- sursa;
- formate/zone de interes.

### Toate lead-urile

Lista profesionala, paginata server-side:

- cautare;
- status;
- owner;
- sursa;
- client direct/agentie;
- follow-up restant/azi/viitor/lipsa;
- perioada de creare;
- valoare estimata;
- probabilitate;
- sortare.

### Echipa

Disponibil pentru Sales Director, COO si SUPER_ADMIN:

- pipeline pe vanzator;
- activitati in ultimele 7/30 zile;
- follow-up compliance;
- lead-uri fara activitate;
- valoare pipeline;
- forecast ponderat;
- rata castig/pierdere;
- durata medie pe etapa;
- lead-uri reasignabile.

## 5. Lead Detail Workspace

Lead-ul trebuie deschis intr-un drawer mare sau pagina dedicata, nu editat intr-un rand de tabel.

### Header

- companie;
- status;
- owner;
- valoare estimata si moneda;
- probabilitate;
- expected close;
- urmatorul follow-up;
- sursa;
- client existent asociat, daca exista.

### Actiuni principale

- Inregistreaza activitate;
- Programeaza follow-up;
- Deschide Selector oferta;
- Leaga de client existent;
- Converteste in client/campanie;
- Marcheaza castigat;
- Marcheaza pierdut.

### Timeline

Ordine descrescatoare:

- apel;
- email;
- WhatsApp;
- meeting;
- vizita;
- oferta trimisa;
- schimbare status;
- reasignare;
- follow-up;
- note.

Fiecare eveniment arata:

- cine;
- cand;
- tip;
- continut;
- status la momentul respectiv;
- urmator pas;
- data urmatorului follow-up.

### Contacte

- unul sau mai multe contacte;
- contact principal;
- functie;
- telefon;
- email;
- note;
- actiuni rapide pentru apel, email si WhatsApp.

### Context comercial OOH

- perioada campaniei dorite;
- orase/zone;
- formate;
- buget;
- coduri/locatii selectate;
- termen estimat pentru decizie;
- observatii de brief.

In prima faza aceste informatii pot reutiliza campurile existente. Structurarea lor in campuri dedicate necesita o migrare aditiva ulterioara.

## 6. Status Architecture

UI-ul trebuie sa foloseasca un singur set canonic:

| Status UI | Semnificatie | Necesita follow-up |
|---|---|---|
| NEW | Lead nou, neverificat | Da |
| QUALIFIED | Nevoie si contact validate | Da |
| BRIEF_RECEIVED | Avem cerinta comerciala | Da |
| PROPOSAL_IN_PROGRESS | Se pregateste selectia/oferta | Da |
| PROPOSAL_SENT | Oferta trimisa | Da |
| NEGOTIATION | Negociere activa | Da |
| WON | Castigat | Nu |
| LOST | Pierdut | Nu |
| NURTURE | Revenire ulterioara | Da, la o data viitoare |

Compatibilitatea cu valorile existente se face prin mapare centrala, nu prin afisarea ambelor seturi in UI.

Reguli:

- statusurile active necesita owner;
- trecerea intr-un status activ necesita urmator pas si data;
- `LOST` necesita motiv;
- `WON` necesita confirmarea conversiei sau asocierea la un client/campanie;
- mutarea in `PROPOSAL_SENT` creeaza automat o activitate "oferta trimisa";
- schimbarea owner-ului este auditata.

## 7. Duplicate Prevention

Inainte de crearea lead-ului:

- cauta `ClientAccount` dupa nume normalizat;
- cauta lead-uri active dupa companie;
- cauta email si telefon;
- afiseaza rezultate posibile;
- permite "Leaga de client existent";
- permite continuarea numai cu confirmare daca exista o potrivire aproximativa.

Vanzatorii pot vedea denumirea tuturor clientilor pentru deduplicare, dar datele private si editarea raman guvernate de ownership.

## 8. Selector Integration

Din lead:

1. Vanzatorul apasa "Deschide Selector oferta".
2. CRM-ul salveaza contextul lead-ului in session storage.
3. Selectorul porneste cu perioada si filtrele cunoscute.
4. Selectia este salvata inapoi ca activitate CRM si lista de coduri.
5. Nu se creeaza rezervare, HOLD sau BOOKED.

Cand Media Plan este activat:

- lead-ul poate genera un draft de oferta;
- draftul pastreaza legatura cu lead-ul;
- statusul poate trece in `PROPOSAL_IN_PROGRESS` sau `PROPOSAL_SENT`;
- conversia ramane explicita.

## 9. Public Request Integration

Solicitarile din portal trebuie sa intre automat in CRM:

- deduplicare prin `sourceOfferRequestId`;
- owner stabilit prin reguli sau coada de alocare;
- sursa `PUBLIC_PORTAL`;
- codurile selectate pastrate;
- activitate initiala "Solicitare primita";
- notificare catre owner;
- SLA pentru primul contact.

Jobul trebuie sa fie idempotent si sa nu creeze doua lead-uri pentru aceeasi solicitare.

## 10. Notifications

Notificari interne recomandate:

- follow-up scadent azi;
- follow-up restant;
- lead fara urmator pas;
- lead fara activitate de X zile;
- lead reasignat;
- solicitare publica noua;
- oportunitate apropiata de expected close;
- lead castigat/pierdut;
- activitate importanta adaugata de alt utilizator.

Implementare:

- job zilnic protejat cu `CRON_SECRET`;
- notificari idempotente in `AppNotification`;
- arhivare automata cand follow-up-ul este rezolvat sau schimbat;
- click pe notificare deschide direct lead-ul.

Email:

- faza ulterioara;
- digest zilnic pentru fiecare vanzator;
- rezumat de echipa pentru Sales Director;
- necesita furnizor email si configurare separata;
- nu se implementeaza pana nu exista adrese verificate si politici de livrare.

## 11. Metrics

### Vanzator

- follow-up-uri azi;
- follow-up-uri restante;
- lead-uri fara urmator pas;
- pipeline total;
- pipeline ponderat;
- castigat luna curenta;
- rata conversie;
- activitati ultimele 7 zile;
- timp mediu pana la primul contact.

### Sales Director

- pipeline pe vanzator;
- pipeline pe etapa;
- forecast ponderat;
- activitati per vanzator;
- lead-uri neatinse;
- follow-up compliance;
- rata castig/pierdere;
- varsta medie in etapa;
- motive de pierdere.

### COO

- forecast total;
- oportunitati mari;
- oportunitati blocate;
- lead-uri fara owner;
- lead-uri fara activitate;
- conversie pe sursa;
- exceptii, nu lista completa de activitati.

Politica de forecast din acest plan a fost inlocuita. CRM v4 insumeaza valoarea
integrala a oportunitatilor si deriva nivelul de forecast determinist din etapa;
nu foloseste probabilitate manuala si nu calculeaza valoare ponderata.

Valorile si monedele nu se combina fara conversie explicita.

## 12. API Architecture

### Summary list

`GET /api/admin/crm/leads`

Parametri:

- `q`;
- `status`;
- `assignee`;
- `due`;
- `source`;
- `clientType`;
- `createdFrom`;
- `createdTo`;
- `sort`;
- `cursor`;
- `limit`.

Returneaza numai:

- identificare;
- companie/contact;
- status;
- owner;
- valoare/probabilitate;
- follow-up;
- ultima activitate;
- numar activitati/contacte;
- avertizari calculate.

### Detail

`GET /api/admin/crm/leads/[id]`

Returneaza:

- lead complet;
- client asociat;
- contacte;
- timeline paginat;
- campanii asociate;
- selectii/oferte asociate cand modulele exista.

### Activities

- `GET /api/admin/crm/leads/[id]/activities`;
- `POST /api/admin/crm/leads/[id]/activities`.

### Commands

- `POST /api/admin/crm/leads/[id]/convert`;
- `POST /api/admin/crm/leads/[id]/reassign`;
- `POST /api/admin/crm/leads/[id]/link-client`;
- `POST /api/admin/crm/sync-public-requests`.

Comenzile trebuie sa fie idempotente si auditate.

## 13. RBAC

### Sales Agent

- vede si modifica lead-urile proprii;
- vede lista minima a tuturor clientilor pentru deduplicare;
- poate adauga contacte si activitati la lead-urile proprii;
- nu poate reasigna catre alt vanzator;
- nu poate vedea pipeline-ul complet al echipei;
- nu poate accesa date financiare private.

### Sales Director

- vede pipeline-ul echipei;
- poate reasigna lead-uri;
- poate corecta owner/status;
- vede metrici de echipa;
- nu modifica SmartBill sau documente financiare.

### COO / SUPER_ADMIN

- acces global;
- poate reasigna si combina clienti;
- vede forecast si exceptii;
- poate corecta conversii gresite prin flux auditat.

### Finance / Field Operator

- fara acces CRM, cu exceptia contextului minim explicit necesar altui workflow.

## 14. Performance Requirements

- lista initiala maximum 50 de lead-uri;
- paginare/cursor server-side;
- cautare server-side cu debounce;
- niciun `include` cu activitati complete pe lista;
- ultima activitate se returneaza ca sumar;
- timeline-ul se incarca la deschiderea lead-ului;
- Kanbanul incarca sumar pe etapa;
- metricile folosesc `count`, `groupBy` si agregari;
- nicio cerere repetitiva la fiecare rand;
- update local sau revalidare controlata dupa mutarea in pipeline;
- fara refresh complet pentru activitati simple.

## 15. Data Model Plan

### Phase 1: no migration

Se reutilizeaza:

- `CrmLead`;
- `CrmContact`;
- `CrmActivity`;
- `ClientAccount`;
- `OfferRequest`;
- `AppNotification`.

Se pot implementa fara migrare:

- noul UI;
- paginare;
- detail drawer;
- timeline;
- status mapping;
- validarea urmatorului pas;
- duplicate suggestions;
- selector context;
- notificari follow-up;
- metrici;
- sincronizare solicitari publice;
- conversie controlata folosind campurile deja existente.

### Phase 2: additive migration

Campuri recomandate:

- `priority`;
- `lastActivityAt`;
- `stageChangedAt`;
- `closedAt`;
- `lostReasonCode`;
- `wonCampaignId`;
- `nextActionType`;
- `nextActionNote`;
- `campaignPeriodStart`;
- `campaignPeriodEnd`;
- `budgetMin`;
- `budgetMax`;
- `briefData Json`.

Indexuri:

- `(assignedToUserId, status, nextFollowUpDate)`;
- `(status, updatedAt)`;
- `(clientId, status)`;
- `(sourceOfferRequestId)`;
- `(stageChangedAt)`.

Migrarea trebuie revizuita separat, tinand cont ca istoricul Prisma al bazei de productie necesita mai intai reconciliere.

## 16. Implementation Roadmap

### Batch 1: CRM Daily Workspace

Fara migrare:

- pagina Astazi;
- pipeline Kanban;
- lista paginata;
- lead detail drawer;
- timeline lazy;
- formular rapid de lead;
- status canonic;
- follow-up obligatoriu pentru statusurile active;
- lost reason obligatoriu;
- detectie client/lead duplicat;
- metrici personale;
- teste RBAC si privacy.

Acesta este lotul recomandat pentru prima implementare.

### Batch 2: Integrations and Notifications

- notificari follow-up;
- sincronizare solicitari publice;
- deschidere Selector oferta din lead;
- salvare coduri selectate ca activitate;
- notificare la reasignare;
- dashboard Sales Director.

### Batch 3: Controlled Conversion

- lead -> client existent/nou;
- lead -> campanie;
- confirmare si audit;
- fara HOLD/BOOKED automat;
- asociere la oferta/Media Plan cand modulul este live.

### Batch 4: Forecast and Data Quality

- pipeline ponderat;
- aging pe etapa;
- motive de pierdere;
- SLA primul contact;
- rapoarte pe sursa;
- campuri si indexuri aditive.

### Batch 5: Email and Automation

- provider email;
- digest zilnic;
- reminder email optional;
- template-uri;
- log de livrare;
- retry si protectie anti-spam.

## 17. Acceptance Criteria for Batch 1

- vanzatorul vede imediat follow-up-urile de azi si restante;
- lead-urile proprii sunt izolate corect;
- directorul vede echipa;
- lead-ul poate fi creat in sub un minut;
- clientii existenti sunt sugerati inainte de creare;
- lead-ul activ nu poate ramane fara urmator pas;
- statusurile nu sunt duplicate;
- timeline-ul este clar si cronologic;
- modificarile apar fara refresh complet;
- lista este paginata si nu incarca toate activitatile;
- publicul si utilizatorii operationali nu pot accesa CRM;
- nu se creeaza rezervari, HOLD sau BOOKED;
- nu se modifica SmartBill;
- nu se expun date private public;
- nu se ruleaza migrare.

## 18. Main Risks

- istoricul migrarilor Prisma trebuie reconciliat inainte de orice camp nou;
- OfferRequest si CrmLead pot produce duplicate daca sincronizarea nu are cheie idempotenta;
- statusurile legacy trebuie mapate, nu sterse brusc;
- conversia in client trebuie sa respecte ownership si merge;
- metricile pe EUR/RON trebuie separate;
- notificarea fara job de cleanup poate deveni zgomotoasa;
- un Kanban care incarca toate lead-urile nu este scalabil;
- emailul nu trebuie pornit fara provider, domeniu verificat si log de livrare.

## 19. Recommended Decision

Implementarea trebuie sa inceapa cu Batch 1, fara migrare.

Prioritatea nu este adaugarea mai multor campuri, ci:

1. ecranul Astazi;
2. pipeline clar;
3. lead detail si timeline;
4. follow-up obligatoriu;
5. deduplicare;
6. paginare si API sumar;
7. metrici personale.

Acest lot transforma CRM-ul dintr-un tabel tehnic intr-un instrument comercial utilizabil, fara sa afecteze rezervarile, financiarul sau datele deja existente.

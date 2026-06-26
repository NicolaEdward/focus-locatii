# Workflow-uri OOH

## Solicitare client

1. Clientul filtreaza inventarul public si selecteaza locatii.
2. Trimite o solicitare cu nume si cel putin email sau telefon.
3. Solicitarea intra ca `NEW` si nu expune date interne.
4. Un agent o preia; statusul devine `CONTACTED`, iar agentul devine owner.
5. Poate continua prin `QUOTED`, `WON`, `LOST` sau `ARCHIVED`.

Solicitarea poate fi transformata in lead CRM. Pentru CRM-ul intern, `CrmLead` este entitatea principala, iar fiecare apel, email, vizita, oferta sau follow-up se salveaza separat in `CrmActivity`.

## Hold si inchiriere

1. Agentul selecteaza una sau mai multe locatii pe lista si harta.
2. Completeaza clientul, campania, perioada, firma contractanta si chiria lunara.
3. Completeaza moneda, termenul de plata si regula de facturare.
4. Aplicatia verifica perioada si suprapunerile pe fiecare locatie.
5. Agentul salveaza un `RESERVED`, adica hold intern valabil 5 zile.
6. Directorul de vanzari, COO sau SUPER_ADMIN poate confirma `RESERVED -> BOOKED`.
7. Daca nu este confirmat, hold-ul devine `EXPIRED` si locatia revine in disponibil.

Pentru o selectie cu mai multe fete/coduri, aplicatia creeaza un grup contractual si imparte chiria totala egal intre coduri. Raportarea foloseste partea aferenta fiecarui cod.

Vanzatorul nu se introduce manual pentru fluxul normal. Pentru `SALES_AGENT` si `SALES_DIRECTOR`, seller-ul este contul logat. COO/SUPER_ADMIN pot crea sau reasigna catre alt vanzator doar prin dropdown si cu audit.

## Tranzitii permise

- `HOLD -> RESERVED | BOOKED | CANCELLED | EXPIRED`
- `RESERVED -> BOOKED | CANCELLED | EXPIRED`
- `BOOKED -> CANCELLED`
- `CANCELLED` si `EXPIRED` sunt terminale.

Sunt blocate salturile directe imposibile si confirmarea unei inchirieri de catre `SALES_AGENT`. Anularea pastreaza istoricul; rezervarile nu mai sunt sterse fizic din UI.

## Disponibilitate

Disponibilitatea publica este calculata din rezervarile active, nu doar din statusul static al locatiei. Algoritmul suporta locatie libera complet, ocupata complet, libera la inceput, la final sau intre doua perioade. O suprapunere `HOLD`, `RESERVED` sau `BOOKED` blocheaza o a doua rezervare.

## Client Accounts

Clientul este salvat ca `ClientAccount`, cu account owner si contacte. Daca o inchiriere veche avea doar text, migrarea creeaza client account din datele existente. In fluxurile noi, clientul poate fi cautat/creat controlat, iar notificarile financiare folosesc account owner-ul.

## Facturare si scadenta

Facturarea si scadenta sunt separate:

- `invoiceDate` = data la care trebuie emisa factura;
- `dueDate` = `invoiceDate + paymentTermDays`;
- `billingRule` decide momentul facturarii: inceput/final luna, inceput/final campanie, lunar in avans, lunar dupa prestare, integral sau manual;
- `billingFrequency` decide daca se genereaza un singur `BillingItem` sau unul lunar;
- lunile partiale se calculeaza pro-rata.

Exportul contabil lunar foloseste `BillingItem`, nu presupune automat facturare la inceput de luna.

## Financiar Excel-first

1. Utilizatorul autorizat incarca raportul Excel.
2. Aplicatia detecteaza firme, furnizori/plati, clienti/incasari, totaluri, RON/EUR si randuri neclare.
3. Preview-ul arata totaluri separate pe moneda si randuri de verificat.
4. Randurile neclare se corecteaza sau se exclud manual.
5. Raportul devine activ doar dupa confirmare.

Valorile incasate/achitate integral nu apar in listele principale, ci in arhiva.

## Notificari account owner

Pentru incasari si facturi de emis, aplicatia creeaza notificari interne catre account owner. Daca nu exista account owner, fallback-ul este catre SALES_DIRECTOR si COO. Utilizatorul poate marca “am sunat” sau “rezolvat”, iar actiunea intra in audit.

## Operatiuni

Campaniile confirmate genereaza liste pentru decorare si neutralizare. COO/SUPER_ADMIN pot marca taskurile `NEW`, `IN_PROGRESS`, `DONE` sau `ARCHIVED`. Taskurile finalizate ies din lista activa, dar raman in istoric.

## Dashboard-uri si KPI

- Agent: lead-uri deschise, hold-uri proprii, campanii proprii si venit confirmat pro-rata.
- Director: vanzari lunare, hold-uri de decis, campanii viitoare, pipeline si performanta agentilor.
- COO: ocupare, campanii active/viitoare, riscuri, conflicte, venit, operatiuni, clienti si orase.
- Admin: utilizatori, inventar, conflicte, sanatatea sesiunii/bazei si audit recent.

Venitul lunar este chiria lunara inmultita cu zilele active si impartita la numarul de zile calendaristice din fiecare luna.

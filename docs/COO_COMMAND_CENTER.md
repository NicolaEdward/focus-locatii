# COO Operational Command Center

Dashboard-ul COO din `/admin/dashboard` este centrul operational pentru portalul OOH Focus Media.

## Permisiuni COO

COO poate gestiona activitatea operationala si administrarea de zi cu zi:

- utilizatori non-SUPER_ADMIN;
- locatii si inventar;
- rezervari, hold-uri si inchirieri;
- decorari si neutralizari;
- solicitari client si CRM;
- financiar, import Excel si notificari scadente;
- export disponibil, situatie vanzari si facturare contabilitate;
- audit/log-uri importante.

SUPER_ADMIN ramane rolul suprem. Doar SUPER_ADMIN poate crea sau modifica un cont SUPER_ADMIN.

## Module

- Overview: sanatate operationala, campanii active, campanii care incep curand, activitate vanzatori, inventar pe oras.
- Probleme: centru inteligibil cu impact, prioritate si actiune recomandata pentru operational, vanzari, financiar, CRM, inventar si date incomplete.
- Vanzari: activitate pe vanzatori, rezervari neconfirmate, campanii confirmate.
- CRM: lead-uri dupa modelul Edward CRM, contacte, statusuri comerciale, follow-up si activitati multiple pe acelasi lead.
- Operational: decorari, neutralizari si taskuri intarziate.
- Inventory: disponibilitate pe oras/tip suport, locatii disponibile, ocupate si blocate.
- Financiar: import Excel, de incasat, de platit, restante, scadente, Needs Review, arhiva si uploaduri.
- Exporturi: disponibil, situatie vanzari, facturare contabilitate, financiar, solicitari si audit GPS.
- Admin: utilizatori, locatii, import Excel si GPS.

## Actiuni Directe

Din dashboard, COO poate:

- confirma un hold ca inchiriere;
- prelungi un hold;
- elibera un hold;
- marca un hold ca pierdut;
- schimba perioada unei rezervari;
- asigna un vanzator;
- marca un conflict ca rezolvat;
- aproba o exceptie;
- crea task operational;
- trece taskuri in lucru, finalizate sau arhivate;
- actualiza statusul CRM, valoarea estimata, follow-up-ul si notitele unui lead.
- incarca raportul financiar Excel, revizuieste randurile neclare si confirma raportul;
- urmari notificarile de scadenta si marca “am sunat” sau “rezolvat”;
- exporta facturarea lunara pentru contabilitate.

Toate actiunile critice trec prin API-uri protejate si sunt inregistrate in audit log.

## Reguli Pastrate

- Disponibilitatea se calculeaza din rezervari si inchirieri.
- Hold-urile expirate nu mai blocheaza locatia.
- Corecturile comerciale pe inchirieri vechi nu sunt blocate de conflicte istorice daca nu se schimba perioada sau locatia.
- Schimbarea perioadei/locatiei pastreaza verificarea de suprapunere.
- Datele interne nu sunt expuse in partea publica.

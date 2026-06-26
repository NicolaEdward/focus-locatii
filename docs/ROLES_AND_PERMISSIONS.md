# Roluri si permisiuni

Rolurile sunt centralizate in `src/lib/rbac.ts`. Navigatia ascunde functiile nepermise, paginile server redirectioneaza utilizatorii fara acces, iar fiecare API critic revalideaza sesiunea, rolul, starea activa si versiunea tokenului in baza de date.

## SUPER_ADMIN

Acces complet: utilizatori, roluri, inventar, import, GPS, rezervari, operatiuni, rapoarte si audit. Nu poate dezactiva propriul cont si aplicatia nu permite eliminarea ultimului `SUPER_ADMIN` activ.

## COO

Vede dashboard-ul executiv si operational, inventarul complet, campaniile, disponibilitatea, rezervarile, operatiunile, rapoartele si auditul. Poate gestiona administrarea de zi cu zi: utilizatori non-`SUPER_ADMIN`, inventar, campanii, rezervari, inchirieri, decorari, neutralizari, solicitari si exporturi. Nu poate crea, promova sau modifica un cont `SUPER_ADMIN`; acest control ramane exclusiv pentru `SUPER_ADMIN`.

Dashboard-ul COO foloseste componenta Operational Command Center si permite actiuni directe pe hold-uri, conflicte, taskuri operationale si mini CRM. Vezi `docs/COO_COMMAND_CENTER.md`.

## SALES_DIRECTOR

Vede pipeline-ul comercial complet, performanta agentilor, inventarul, rezervarile si rapoartele. Poate confirma un hold ca inchiriere si poate respinge/anula conform workflow-ului. Nu gestioneaza utilizatori, configurari sau GPS.

## SALES_AGENT

Vede inventarul si datele comerciale proprii. Poate prelua solicitari nealocate, crea hold-uri si actualiza propriile rezervari. Nu poate confirma direct o inchiriere, vedea raportul financiar agregat, modifica inventarul, importa date sau gestiona utilizatori.

## Ownership

Rezervarile si solicitarile noi primesc `ownerId`. Pentru datele legacy fara `ownerId`, aplicatia foloseste temporar campul `salesperson` si compara numele sau emailul utilizatorului. Datele altui agent sunt filtrate server-side, nu doar ascunse in UI.

## Sesiuni

- cookie `HttpOnly`, `Secure` in productie si `SameSite=Lax`;
- token HMAC cu expirare la 12 ore;
- utilizatorul activ si `tokenVersion` sunt verificate la fiecare acces protejat;
- schimbarea rolului, parolei sau starii revoca sesiunile existente;
- 8 autentificari esuate intr-o fereastra de 15 minute blocheaza temporar instanta.

Middleware-ul nu este folosit ca unic control de acces. Autorizarea este facuta in Server Components si Route Handlers, evitand dependenta de un singur strat de rutare.

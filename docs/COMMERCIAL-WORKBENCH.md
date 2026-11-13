# Oferte, DOOH și agentul de vânzări

Implementarea adaugă trei spații în aplicația Next existentă: `/admin/commercial-quotes`, `/admin/dooh`, `/admin/ai`. Nu activează furnizori, nu creează date reale și nu demonstrează înlocuirea unui vânzător. Migrarea aditivă creează 16 tabele noi, fără rescrierea istoricului existent.

## Politică și traseu comercial

1. COO/SUPER_ADMIN configurează explicit TVA, tratamentul taxei, moneda reală a tarifelor numerice, valabilitatea ofertei/aprobării și limitele de utilizare. Nu există valori fiscale aprobate implicit. Modificarea politicii invalidează versiunile comerciale vechi la executare.
2. Sellerul selectează clientul și campania atribuite aceluiași seller, amplasamente statice disponibile și destinatarul exact. Tarifele pozitive provin din inventar, moneda trebuie să coincidă cu moneda campaniei și politica; conversia valutară automată este refuzată. Calculul determinist folosește Decimal și zile calendaristice incluzând ultima zi.
3. O ofertă are versiuni imuabile cu termeni, prețuri, surse, date și hash. Revizuirea verifică versiunea așteptată și invalidează aprobările anterioare. UI arată ultimele 100 oferte și până la 20 versiuni/ofertă. Alte versiuni rămân în baza de date; volumele peste aceste limite cer o paginare dedicată.
4. Un manager comercial aprobă exact versiunea/acțiunea/destinatarul/expirarea afișate. Acceptarea sau respingerea clientului este un eveniment separat cu referință verificată și document opțional din același dosar. Acceptarea nu creează automat o rezervare.
5. O aprobare HOLD include data exactă de expirare, maximum cinci zile. Execuția umană sau scope-ul `hold.execute` revalidează aprobatorul activ, portofoliul, politica, disponibilitatea și hash-ul, folosește blocările canonice ale rezervărilor și consumă aprobarea în aceeași tranzacție cu HOLD și receipt. Nu poate crea BOOKED. O schimbare de disponibilitate refuză operația; se cere o nouă versiune a ofertei.
6. Aprobarea expedierii se consumă într-o singură intrare în coadă. Execuția este umană, cu revalidarea versiunii/destinatarului/supresiei la trimitere. Conectorul Resend este implementat, dar rămâne inactiv până la configurare și aprobarea politicii. Nu este un sistem fiscal de emitere a facturilor.

## Acces și instrumente pentru integrare

Rolurile comerciale și D_CEO pot citi spațiul în limitele RBAC; D_CEO nu poate modifica. Sellerul vede propriul portofoliu, managerii păstrează accesul global existent. Configurarea politicii este numai COO/SUPER_ADMIN. Emiterea și revocarea principalelor, aprobările, capacitatea DOOH și pilotul sunt manageriale (SALES_DIRECTOR/COO/SUPER_ADMIN). D_CEO vede statusul operațional; revizuirea pilotului este managerială.

`POST /api/agent/tools` acceptă exclusiv token de serviciu în `Authorization: Bearer fm_ai_…` și corpul:

```json
{"tool":"availability.check","requestKey":"intent-stable-uuid","input":{"locationIds":["id"],"periodStart":"2090-01-01","periodEnd":"2090-01-31"}}
```

Tokenul este afișat o singură dată, păstrat numai ca SHA256 în DB, revocabil și limitat la 31 zile, seller, scopes, mod și buget zilnic. Nu se refolosește cookie-ul uman. Corpul este limitat la 32KB în timpul citirii, inclusiv fără Content-Length; rata este 60 cereri/minut/principal. Instrumentele sunt tipizate și refuză câmpurile suplimentare:

- `inventory.search`: inventar minimizat, lipsuri explicite și proveniență, fără contacte/costuri interne.
- `availability.check`: disponibilitate canonică cu sursă, timestamp, versiuni/hash și prospețime de 30 secunde; nu include clientul altui seller și nu alocă inventar.
- `opportunity.read`: numai oportunitățile sellerului delegat, versiune opțional așteptată; textele sunt marcate neîncrezătoare.
- `quote.draft`: aceeași funcție deterministă de ofertare, numai client/campanie proprii.
- `approval.request`: cerere de aprobare, fără drept de autoaprobare.
- `hold.execute`: numai aprobarea consumabilă a unui om verificat și exact principalul aprobat.
- `receipt.read`: propriul rezultat persistat, după retry sau timeout.

Shadow permite numai citiri. Modificările și receipt-ul reușit se salvează atomic. Cheia aceleiași intenții trebuie păstrată la timeout; același key cu alt payload este refuzat. La eșec, întreaga tranzacție a instrumentului este anulată, apoi se persistă un receipt de eșec și consumul limitei într-o tranzacție separată. Acest design evită SAVEPOINT, nesuportat de protocolul prepared Prisma/MySQL. Un crash între rollback și receipt nu lasă efect comercial. Un replay cu rezultat confirmat întoarce acel rezultat. Niciun instrument nu execută SQL/URL arbitrar, nu schimbă roluri, nu confirmă BOOKED și nu înregistrează plăți.

`GET /api/admin/commercial-workbench?receiptId=…` recuperează un rezultat autorizat. Istoricul UI include hashes, model/tokenuri când există, policy/request/principal și status. Auditul mutațiilor este scris în aceeași tranzacție cu markerul `business-transaction`, cu citiri curente blocate pentru utilizator activ, rol, tokenVersion și sesiunea înregistrată atunci când există. O schimbare concurentă a drepturilor anulează întreaga scriere. Actorul delegat păstrează rolul și versiunea de credențiale citite din DB, fără cookie uman. Tokenurile și contactele nu sunt jurnalizate în audit.

## Activarea furnizorilor, după revizuirea proprietarului

Generarea internă folosește AI SDK 7 și modelul explicit `AI_SALES_MODEL=provider/model` prin AI Gateway; nu se alege un model implicit. Sunt necesare `AI_SALES_GENERATION_ENABLED=true`, autentificarea Gateway (`VERCEL_OIDC_TOKEN` sau `AI_GATEWAY_API_KEY`) și politica `generationEnabled`. Aprobă providerul/regiunea/retenția/prețul și configurează un buget Gateway înainte de activare. Limita aplicației este per persoană/zi, maxim 600 tokenuri output/apel, 15 secunde, fără retry automat. Eșecurile consumă apelul rezervat. Tarifele, clientul, destinatarul, notele și documentele nu sunt trimise modelului; doar perioada, orașele și numărul amplasamentelor. Textul rezultat este intern, necesită revizuire și nu este folosit automat în email. Calculele/termenii provin din cod determinist.

Pentru expediere: configurează `RESEND_API_KEY`, `COMMERCIAL_FROM_EMAIL`, `COMMERCIAL_SEND_ENABLED=true`, politica `outboundEnabled` și VERCEL_ENV=production. Validează domeniul și dreptul de contact înainte. Nici Preview, nici testele nu expediază. Adaugă webhook `POST /api/commercial-delivery` cu `COMMERCIAL_WEBHOOK_SECRET` (secret Svix `whsec_…`) pentru `email.delivered`, `email.bounced`, `email.complained`. Semnătura/timestamp-ul, deduplicarea și hash-ul sunt verificate; bounce/complaint înscrie destinatarul la supresie. O confirmare întârziată de livrare nu șterge un bounce. După timeout, starea `unknown`/`sending` trebuie reconciliată la furnizor; aplicația nu retrimite automat. Oprirea nu poate retrage o cerere deja în zbor.

Butonul de oprire revocă principalele și dezactivează instrumentele, generarea și expedierile. Oprirea pilotului sau un incident de efect neautorizat/disponibilitate falsă/calcul incorect sau depășirea pragurilor de precizie/cost execută aceeași oprire. Valorile politicii aprobate și metricile numerice ale fiecărei revizuiri sunt păstrate în audit pentru reconstruirea deciziilor. Reluarea cere o politică și delegări noi.

## DOOH

Modelul este separat de ocuparea statică: profil verificat manual (fus IANA, durată buclă/spot, sursă), interval de instanți `[start,end)`, daypart local `[minuteStart,minuteEnd)` fără trecere peste miezul nopții, cotă în basis points. Un spot integral este cota minimă. Profilul este blocat la alocare; se verifică toate ferestrele suprapuse și cota disponibilă; două cereri concurente nu pot depăși capacitatea. O rezervare/blocare istorică pe întregul amplasament refuză alocarea DOOH până la reconciliere. Nu se deduce automat SOV din istoricul static. Crearea profilului și sursele înghețate ale ofertelor blochează amplasamentele în aceeași ordine ca ștergerea inventarului; o ștergere concurentă nu poate lăsa referințe orfane.

Profilul cu alocări viitoare nu poate fi editat, iar termenii sunt copiați în alocare pentru păstrarea istoricului. Alocarea cere un manager și referința aprobării. Retragerea păstrează rândul cu status cancelled. Proof of play este legat de alocare, interval, număr efectiv/așteptat, sursă și SHA256 al dovezii verificate de om. Același hash cu valori diferite este refuzat. Aceste date sunt rapoarte confirmate manual, nu telemetrie verificată automat. Nu există ad server presupus sau simulare de difuzare; fotografia de montaj nu devine dovadă de playback.

## Pilot și evaluare

Managerul preregistrează obiectivul, eligibilitatea, domeniul permis al datelor, maturizarea, mărimea minimă a eșantionului, precizia și costul maxim. Activarea leagă aprobarea de hash-ul protocolului; protocolul oprit nu se reactivează. În această versiune canalele pilotului sunt `none` și fiecare efect comercial cere om. Alocarea deterministă este la nivelul unei chei stabile de companie, păstrând nonconversiile. Responsabilul trebuie să verifice eligibilitatea și unicitatea cheii (CUI/ID de companie), cu o cohortă potrivită înainte de recrutare; nu folosi nume diferite ale aceleiași companii.

Înregistrarea rezultatelor cere evaluator și referință. Cazul nu poate fi marcat matur înainte de fereastra sa. Încasările/marja sunt raportate de evaluator pe surse, nu deduse din CRM WON sau chirii. Moneda protocolului trebuie păstrată; nu agrega valute diferite. Folosește registrul și `getCampaignFinance(campaignId,currency)` după verificarea portofoliului pentru extragerea financiară, păstrând marja null când sursa indică lipsuri. Datele financiare nu sunt verificate automat de formular.

Rapoartele separă înscrișii/maturii și păstrează marja necunoscută ca null, nu zero. Precizia fără afirmații este necunoscută. Limita aproximativă 3/n pentru zero incidente folosește numai cazurile evaluate și nu reprezintă o demonstrație statistică de siguranță sau superioritate. Compară seller singur cu seller asistat pe cohorte comparabile, apoi evaluează costul total, timpul cu rework, oportunitățile valide, corectitudinea, marja și încasările după maturizare. Înlocuirea vânzătorului rămâne `NOT_ESTABLISHED`.

Evaluator offline fără acces DB/rețea:

```sh
pnpm run evaluate:sales-pilot scripts/fixtures/sales-pilot-evaluator.json
```

Fișierul inclus este **self-test sintetic adversarial**, cu un candidat deliberat incorect; rezultatele lui nu măsoară performanța reală. Evaluatorul verifică afirmațiile față de fapte furnizate, sumele față de oracle, efectele/autorizările și promisiunile de disponibilitate, apoi compară brațele și semnalează oprirea. Pentru un pilot real, înlocuiește fișierul cu observații aprobate, păstrează hash/proveniență, verifică sursele și protocolul; nu transforma fixture-urile în rezultate reale. UI permite administrarea cazurilor și revizuirea rezultatului, nu recrutare sau mesaje automate.

## Verificare și limite de livrare

`test:commercial-workbench` refuză orice DB care nu este locală, sintetică și numită focus_preview_…, precum și VERCEL_ENV production. Creează/șterge numai propriile fixture-uri. Acoperă bani/calendare/hash, roluri/portofoliu, quote idempotency și istoric, aprobări stale, outbound dezactivat, rollback/receipts, shadow/revocare, HOLD atomic, capacitate concurentă, proof idempotent, semnături/replay/supresie, maturizare și kill switch. Nu contactează niciun provider/model/client.

Migrarea trebuie aplicată prin fluxul de migrare revizuit al proiectului, după backup și verificarea schemei. Nu rula db push în producție. Nu sunt incluse activarea furnizorilor, importul/reconcilierea inventarului DOOH istoric, trimiterea de mesaje reale sau rezultatele pilotului. Acestea cer configurație și date verificate ale companiei.

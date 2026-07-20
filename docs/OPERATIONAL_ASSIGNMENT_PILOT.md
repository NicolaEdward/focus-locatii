# Pilot assignment operational

## Decizie de arhitectura

Am ales varianta A: adoptare controlata a modelului `OperationTask`, exclusiv pentru assignment explicit.

Motive:

- modelul existent are deja relatii catre rezervare, campanie, locatie, utilizator si furnizor;
- are status, tip, termen (`scheduledFor`), `dedupeKey` si index pentru assignee/status;
- evita duplicarea assignmentului si statusului in `Reservation.productionNotes`;
- permite control IDOR relational si interogari rapide pentru `Munca mea`;
- nu necesita migrare.

Varianta B, metadata noua in fluxul derivat BOOKED, a fost respinsa deoarece ar dubla assignee/status/deadline, nu ar avea chei externe sau indexuri si ar face auditul si accesul direct mai fragile.

## Limita pilotului

Flag nou:

`OPERATIONAL_ASSIGNMENT_ENABLED=true`

Acest flag este separat de:

- `OPERATION_TASKS_ENABLED`;
- `OPERATION_TASK_READS_ENABLED`;
- `ENABLE_LEGACY_RESERVATION_SYNC`.

Cele trei flags legacy raman oprite. Activarea pilotului nu porneste sincronizarea sau citirea globala a celor aproximativ 288 taskuri istorice.

## Sursa de adevar in pilot

- `BOOKED + productionNotes` ramane sursa pentru derivarea lucrarilor curente.
- `OperationTask` se materializeaza sau se actualizeaza doar cand un manager atribuie explicit o lucrare.
- statusul operat de Field se scrie in `OperationTask` si se oglindeste in `productionNotes` pentru compatibilitate temporara.
- `HOLD` si `RESERVED` nu sunt eligibile si nu sunt materializate.
- taskurile istorice legate de rezervari anulate nu apar in inboxul Field.

## Matrice de acces

| Rol | Lista operationala | Assignment | Task direct | Poze dovada | Finalizare |
| --- | --- | --- | --- | --- | --- |
| FIELD_OPERATOR | Numai taskuri atribuite | Nu | Numai atribuit | Numai atribuit | Numai atribuit BOOKED, minimum o poza noua |
| SALES_AGENT | Numai client/campanie proprie | Nu | Numai ownership propriu | Numai ownership propriu | Conform policy proprii |
| SALES_DIRECTOR | Conform policy echipa existenta | Nu | Global operational | Global operational | Conform permisiunilor existente |
| COO | Overview global | Da | Global | Global | Override conform policy existenta |
| SUPER_ADMIN | Overview global | Da | Global | Global | Override conform policy existenta |

Toate verificarile critice se fac in API. Ascunderea din UI nu este folosita drept masura de securitate.

## Flux manager

1. Managerul deschide `/admin/operational`.
2. Selecteaza lucrari BOOKED active.
3. Alege un Field Operator activ.
4. Completeaza motivul.
5. Ruleaza dry-run.
6. Confirma batch-ul determinist.
7. Sistemul materializeaza sau realoca taskurile intr-o tranzactie.
8. Sistemul scrie audit per task si audit de batch.
9. Operatorul nou este notificat; operatorul anterior este notificat la realocare.

Batch-ul este limitat la 100 de taskuri si este idempotent.

## Flux Field

`/admin/operational` devine `Munca mea`:

- arata numai taskurile atribuite utilizatorului autentificat;
- nu incarca lista globala de rezervari BOOKED;
- permite `In lucru` si finalizare;
- finalizarea cere minimum o fotografie noua;
- pozele pot fi previzualizate si eliminate inainte de upload;
- taskurile finalizate recent sunt secundare si colapsabile.

## Dry-run si date istorice

Raport read-only:

```text
pnpm run audit:operational-assignment
```

Raportul afiseaza taskurile materializate, nealocate, stale, lipsa fata de fluxul BOOKED si sample-uri cu ID-uri interne. Nu face scrieri.

Nu se executa `backfill:operation-tasks --write` si nu se atribuie automat taskurile istorice fara dry-run si aprobare explicita.

## Cutover propus

Pilotul poate deveni flux canonic numai dupa:

1. minimum un cont Field activ verificat;
2. un set mic de taskuri reale aprobat si atribuit manual;
3. minimum o saptamana fara IDOR, taskuri lipsa sau duplicate;
4. reconcilierea taskurilor stale legate de rezervari non-BOOKED;
5. clasificarea taskurilor nealocate;
6. verificarea notificarii si a retentiei pozelor;
7. decizia explicita de oprire a dual-write-ului in `productionNotes`.

Pana atunci, flags-urile globale OperationTask raman oprite.

## Rollback

Rollback functional imediat:

1. seteaza `OPERATIONAL_ASSIGNMENT_ENABLED=false` sau elimina variabila;
2. redeploy al deploymentului stabil;
3. taskurile materializate raman inerte si nu sunt sterse;
4. managerii continua sa vada fluxul derivat existent;
5. Field primeste un ecran fail-closed si nu vede rezervari generale.

Rollback-ul nu necesita migrare si nu modifica rezervari, HOLD, BOOKED, facturi sau SmartBill.

## Proof storage

Accesul este autentificat, documentele sunt eliminate logic dupa 30 de zile si nu apar in API-ul public. Implementarea curenta pastreaza payload-ul imaginilor in `ClientDocument.storageUrl` ca data URL.

Verdict pentru stocare:

- GO pentru pilot restrans cu fisiere mici si volum redus;
- NO-GO pentru rollout larg pana la mutarea intr-un object storage privat, cu delete verificabil, limite mai mici si monitorizarea volumului DB.

# Focus Media OOH Portal

Portal operational pentru inventarul OOH Focus Media, disponibilitate, solicitari de oferta, hold-uri, inchirieri, implementare si raportare comerciala. Aplicatia publica ruleaza la `https://locatii.focusmedia.ro`, iar zona interna la `/admin`.

## Module

- portal public cu harta, filtre, prezentari, shortlist si solicitare oferta;
- inventar OOH cu fotografii, coordonate, caracteristici si disponibilitate calculata;
- rezervari interne de 5 zile si inchirieri confirmate;
- calendar pentru campanii viitoare, decorari si neutralizari;
- export disponibil si situatie vanzari Excel;
- dashboard-uri pentru agent, director de vanzari, COO si administrator;
- utilizatori, roluri, sesiuni revocabile si audit pentru actiuni critice.

## Stack

- Next.js 15 App Router, React 19, TypeScript;
- Tailwind CSS, Leaflet si marker clustering;
- Prisma 6 si MySQL Aiven;
- Vercel pentru productie.

## Pornire locala

1. Copiaza `.env.local.example` in `.env.local` si completeaza valorile.
2. Ruleaza `npm install`.
3. Ruleaza `npm run db:generate`.
4. Ruleaza migrarile aditive: `npm run db:migrate-reservation-workflow`, `npm run db:migrate-reservation-timeline`, `npm run db:migrate-rbac`.
5. Ruleaza `npm run dev`.

Nu folosi `prisma db push` pe baza existenta. Aplicatia foloseste tabelele `portfolio_*`, iar migrarile incluse sunt aditive.

## Verificari

```bash
npm run typecheck
npm run test:availability
npm run test:prorata
npm run test:rbac
npm run build
npm run smoke
npm run smoke:visual
```

Proiectul nu are inca ESLint configurat separat. `next build` ruleaza validarea de tipuri si verificarile de build; introducerea ESLint este recomandata in etapa urmatoare.

## Cont initial

`npm run db:migrate-rbac` creeaza primul `SUPER_ADMIN` numai daca tabela de utilizatori este goala. Citeste `BOOTSTRAP_ADMIN_EMAIL` si `BOOTSTRAP_ADMIN_PASSWORD`, cu fallback temporar la `ADMIN_EMAIL` si `ADMIN_PASSWORD`. Dupa prima autentificare, conturile se gestioneaza din `/admin/utilizatori`.

Nu salva parole reale in repository. Dupa bootstrap, elimina variabilele de parola initiala din Vercel si roteste orice credential transmis anterior in clar.

## Documentatie

- [Prezentare aplicatie](docs/OOH_APP_OVERVIEW.md)
- [Roluri si permisiuni](docs/ROLES_AND_PERMISSIONS.md)
- [Workflow-uri](docs/WORKFLOWS.md)
- [Pregatire lansare](docs/LAUNCH_READINESS.md)

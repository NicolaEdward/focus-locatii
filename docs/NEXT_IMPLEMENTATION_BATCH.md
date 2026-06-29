# Next Implementation Batch

Date: 2026-06-29

Recommended first build batch: Public Redesign MVP.

This is the safest next product batch because it improves sales impact without requiring a database migration, without implementing quote/offer links, and without changing reservation or finance behavior.

## 1. Goal

Make the public catalog feel like a premium outdoor media sales experience.

Users should be able to:

- browse locations confidently;
- understand each location quickly;
- build a shortlist/media plan;
- request an offer;
- trust that the public presentation is polished and privacy-safe.

## 2. Scope

### Improve public location cards

Files likely affected:

- `src/components/public/LocationCard.tsx`
- `src/components/public/LocationExplorer.tsx`
- `src/components/ui/StatusBadge.tsx`

Changes:

- Stronger image-led layout.
- Cleaner hierarchy:
  - code;
  - city/area;
  - media type;
  - dimensions;
  - availability;
  - price only when public.
- CTA labels:
  - "Prezentare"
  - "Adauga in media plan"

### Improve location presentation view

Files likely affected:

- `src/components/public/LocationPresentation.tsx`
- `src/components/public/LocationMiniPreview.tsx`
- `src/components/public/LocationPresentationOverlay.tsx`
- `src/app/locatii/[id]/page.tsx`

Changes:

- Structure sections:
  - hero;
  - gallery;
  - specs;
  - commercial highlights;
  - area/map;
  - availability note;
  - CTA.
- Keep public-safe coordinates and fields only.
- Improve mobile spacing and image behavior.

### Improve shortlist visual structure

Files likely affected:

- `src/components/public/ShortlistDrawer.tsx`
- `src/components/public/MediaPlanBar.tsx`
- `src/lib/media-plan.ts`
- `src/lib/media-plan-download.ts`

Changes:

- Show selected locations as basket rows.
- Add selected period fields at shortlist level or per item if low-risk.
- Show total selected locations and total sqm.
- Show price summary only for public-visible prices.
- Keep Excel/print/contact actions.

### Add future MediaPlan CTA placeholder

Add disabled/secondary CTA:

- "Salveaza ca media plan" or "Media plan salvat - in curand"

Rules:

- It must be clearly disabled or labeled as future.
- It must not create database records.
- It must not imply offer link exists yet.

## 3. Out Of Scope

- No quote/oferta implementation.
- No secure offer link.
- No MediaPlan database model.
- No reservation creation from public.
- No OperationTask flag changes.
- No SmartBill changes.
- No admin page split.

## 4. Acceptance Criteria

- `/locatii` loads and looks more like a sales catalog.
- Cards are clearer and mobile-friendly.
- Presentation page has clear commercial sections.
- Shortlist is easier to review.
- Public API privacy tests pass.
- No internal/private keys appear in public responses.
- Existing offer request submission still works.
- Existing Excel export still works.
- No database migration.

## 5. Tests To Run

- `pnpm run typecheck`
- `pnpm run test:public-visibility`
- `pnpm run test:availability`
- `pnpm run test:rbac`
- `pnpm prisma validate`
- Browser smoke:
  - `/locatii`
  - filters
  - card preview
  - presentation overlay
  - detail page
  - shortlist drawer
  - mobile viewport

## 6. Risks

- Public components may accidentally rely on admin-only DTO fields. Keep tests strict.
- Larger images can hurt performance. Use existing image URLs and placeholders carefully.
- "Media plan" language can overpromise. Use it as "selectie/media plan" until saved MediaPlan exists.

## 7. Recommended Commit Shape

One focused commit:

```text
feat: improve public sales catalog experience
```

If changes become larger, split:

1. `feat: improve public location cards`
2. `feat: polish public location presentation`
3. `feat: improve public shortlist drawer`

## 8. Next Five Small Batches

1. Public Redesign MVP.
2. Internal MediaPlan schema and draft service.
3. Admin MediaPlan create/edit page.
4. Secure public offer link read-only page.
5. Offer accept/change request and conversion to HOLD after availability recheck.


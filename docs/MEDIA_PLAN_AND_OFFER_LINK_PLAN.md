# Media Plan And Offer Link Plan

Date: 2026-06-29

Goal: introduce a saved commercial proposal workflow without jumping directly from public interest to BOOKED reservations.

## 1. Product Flow

Target flow:

```text
Sales/public shortlist
  -> MediaPlan DRAFT
  -> availability check
  -> offer link SENT
  -> client VIEWED
  -> client ACCEPTED or CHANGE_REQUESTED
  -> sales rechecks availability
  -> convert accepted items to HOLD / RESERVED
  -> later BOOKED after contract confirmation
```

Important rule:
- Client acceptance must not create BOOKED directly.
- It should create a pending internal action and require a final availability/conflict recheck.

## 2. Media Plan MVP

Media Plan is a saved commercial proposal draft.

Recommended model:

```prisma
enum MediaPlanStatus {
  DRAFT
  SENT
  REVISED
  ACCEPTED
  EXPIRED
  CANCELLED
}

model MediaPlan {
  id              String   @id @default(cuid())
  companyEntity   String
  clientId        String?
  leadId          String?
  campaignName    String
  sellerUserId    String?
  periodStart     DateTime
  periodEnd       DateTime
  status          MediaPlanStatus @default(DRAFT)
  commercialNotes String?  @db.Text
  internalNotes   String?  @db.Text
  subtotal        Decimal  @default(0) @db.Decimal(14, 2)
  discount        Decimal  @default(0) @db.Decimal(14, 2)
  vat             Decimal  @default(0) @db.Decimal(14, 2)
  total           Decimal  @default(0) @db.Decimal(14, 2)
  currency        String   @db.VarChar(3)
  validUntil      DateTime?
  createdByUserId String?
  updatedByUserId String?
  sentAt          DateTime?
  acceptedAt      DateTime?
  expiredAt       DateTime?
  cancelledAt     DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

Recommended item model:

```prisma
model MediaPlanItem {
  id                         String   @id @default(cuid())
  mediaPlanId                String
  locationId                 String?
  reservationId              String?
  locationSnapshot           Json
  selectedPeriodStart        DateTime
  selectedPeriodEnd          DateTime
  basePrice                  Decimal? @db.Decimal(14, 2)
  discount                   Decimal? @db.Decimal(14, 2)
  finalPrice                 Decimal? @db.Decimal(14, 2)
  currency                   String?  @db.VarChar(3)
  availabilityStateAtCreation String?
  notes                      String?  @db.Text
  sortOrder                  Int      @default(0)
  createdAt                  DateTime @default(now())
  updatedAt                  DateTime @updatedAt
}
```

Company context should use the existing supported values:
- `Focus Media`
- `Excellence Media`
- `Focus BG / Focus Media LLC EOOD`

## 3. Snapshot vs Live Data

Snapshot data should include:
- location code;
- location public name/address/city;
- category/media type;
- dimensions;
- selected photos or main photo URL;
- public display coordinates if shown;
- price at offer time;
- public/commercial notes shown to client.

Live data should remain referenced by:
- `locationId`;
- current availability;
- current public visibility;
- current internal notes/costs, only in admin.

Why snapshot:
- Offers must not change silently when location data changes later.
- Client should see the offer exactly as sent.
- Sales can compare "offered" vs "current" before converting.

## 4. Availability Check Rules

Check availability:

1. When adding items to media plan.
2. Before sending offer link.
3. When client accepts.
4. Before converting accepted items to HOLD.

Rules:
- HOLD / RESERVED / BOOKED active overlaps block availability.
- CANCELLED / EXPIRED / LOST / ARCHIVED do not block unless future business rules change.
- Multi-location conversion must be atomic: if one location conflicts, do not partially create holds without explicit user choice.

## 5. Offer Link Flow

Offer link statuses:

- `DRAFT`
- `SENT`
- `VIEWED`
- `ACCEPTED`
- `CHANGE_REQUESTED`
- `EXPIRED`
- `CONVERTED_TO_HOLD`
- `CANCELLED`

Recommended public flow:

1. Sales creates MediaPlan.
2. Sales clicks "Trimite oferta".
3. App generates secure token.
4. Client opens `/oferta/[token]`.
5. App records VIEWED event.
6. Client chooses:
   - "Accept oferta"
   - "Solicit modificari"
7. App notifies sales/admin.
8. Sales reviews and converts to HOLD after availability recheck.

## 6. Public Offer Page Sections

Offer page should include:

- Focus Media branding.
- Client/campaign name.
- Intro message from seller.
- Validity date.
- Selected locations:
  - image;
  - code/name/address;
  - city/area;
  - media type;
  - dimensions;
  - map/area if public-safe;
  - selected period;
  - price line.
- Pricing summary:
  - subtotal;
  - discount;
  - TVA;
  - total;
  - currency.
- Terms:
  - offer validity;
  - availability subject to confirmation;
  - production/montaj assumptions.
- Buttons:
  - "Accept oferta";
  - "Solicit modificari".

## 7. Offer Link Security

Requirements:

- Token must be random and unguessable.
- Store token hash, not plain token, if possible.
- Expire after `validUntil`.
- Viewing does not require login.
- Accept/change request must be CSRF-safe enough for tokenized public flow.
- Rate-limit token actions.
- Never expose:
  - internal notes;
  - supplier/internal cost;
  - private coordinates;
  - other reservations;
  - seller/admin data beyond intended contact;
  - SmartBill/finance records;
  - documents not explicitly attached to the offer.

## 8. Events And Audit

Recommended events:

- MediaPlan created.
- MediaPlan item added/removed.
- Availability checked.
- Offer sent.
- Offer viewed.
- Client accepted.
- Client requested changes.
- Offer expired.
- Converted to HOLD.
- Conversion failed because conflict.

Use `AuditLog` for internal actor events. For public token events, consider a future `OfferEvent` table.

## 9. API / Service Plan

Future service functions:

- `createMediaPlan(input, actor)`
- `updateMediaPlan(id, patch, actor)`
- `addMediaPlanItem(mediaPlanId, locationId, period, pricing, actor)`
- `removeMediaPlanItem(itemId, actor)`
- `checkMediaPlanAvailability(mediaPlanId)`
- `sendMediaPlanOffer(mediaPlanId, actor)`
- `getPublicOfferByToken(token)`
- `recordOfferViewed(token)`
- `acceptOffer(token, input)`
- `requestOfferChanges(token, message)`
- `convertAcceptedOfferToHold(mediaPlanId, actor)`

## 10. Tests Required

- MediaPlan draft creation.
- Item snapshot is preserved after location changes.
- Price visibility and internal cost privacy.
- Availability check before send.
- Offer token expiry.
- Public offer page does not expose internal fields.
- Client accept creates pending action, not BOOKED.
- Convert to HOLD rechecks conflicts transactionally.
- Multi-location conversion rolls back on conflict.
- Sales agent can access own media plan; unrelated sales agent cannot.
- COO/SUPER_ADMIN can access all.

## 11. Implementation Order

1. Internal MediaPlan model and draft CRUD.
2. Add from public shortlist/admin location detail into MediaPlan.
3. MediaPlan detail page.
4. Availability check and pricing summary.
5. Secure offer token and read-only offer page.
6. Accept/change request actions.
7. Convert accepted offer to HOLD.


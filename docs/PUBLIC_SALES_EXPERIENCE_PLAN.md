# Public Sales Experience Plan

Date: 2026-06-29

Goal: make the public Focus Media experience feel like a premium outdoor media catalog while preserving strict privacy boundaries.

## 1. Current Public Flow

Current flow:

```text
/locatii
  -> filters + map
  -> location cards
  -> mini preview modal
  -> presentation overlay or /locatii/[id]
  -> shortlist drawer
  -> Excel export / print / contact / offer request
```

Strengths:
- Public inventory is live and no-store.
- Shortlist exists and persists in localStorage.
- Users can export a shortlist and submit an offer request.
- Cards and presentation pages already use public-safe DTOs.
- Public API leak tests exist.

Weaknesses:
- Page feels partly like an operational selector, not a polished sales catalog.
- Cards are functional but could be more premium and image-led.
- The shortlist is called "media plan", but it is still client-side only.
- Period selection is missing from public shortlist.
- Public presentation has a strong visual style, but sections are not yet structured as a sales proposal.
- Mobile shortlist and map/card interaction can become heavy.

## 2. Public `/locatii` Redesign

Recommended structure:

1. Hero / catalog entry
   - Strong Focus Media positioning.
   - Clear CTA: "Exploreaza locatii" and "Cere oferta".
   - No admin-like metrics.

2. Search and filters
   - Search by code, city, area, type.
   - Filters: city/area, media type, availability, premium.
   - Make filters compact on mobile.

3. Map and cards
   - Map remains useful, but cards should be the main sales surface on mobile.
   - Desktop can keep map beside filters or as a collapsible view.

4. Location grid
   - Cards should prioritize image, code, city/area, type, size and availability.
   - Price appears only when public visibility allows it.
   - Each card has:
     - "Prezentare"
     - "Adauga in media plan"

5. Shortlist drawer
   - Sales basket with selected period and summary.

## 3. Public Location Card

Recommended card content:

- Large image.
- Location code.
- City / area.
- Address or public display name.
- Media type.
- Dimensions and sqm.
- Availability label.
- Price/rate only if public.
- Small premium/featured marker if applicable.
- Actions:
  - "Prezentare"
  - "Adauga in media plan"

Avoid:
- Internal status names like raw `AVAILABLE_FROM`.
- Raw GPS values.
- Administrative visibility labels.
- Internal cost, supplier, seller, reservations.

## 4. Location Presentation Page

Ideal public sections for each location:

1. Hero image
   - Main image full-width or dominant.
   - Code/name/city/area visible above the fold.

2. Gallery
   - Thumbnails.
   - Clear main image.
   - Graceful placeholder if no photos exist.

3. Location identity
   - Code.
   - Name/address/area.
   - City.
   - Media type/category.

4. Technical media specs
   - Dimensions.
   - Surface.
   - Lighting/visibility if available.
   - Format notes.

5. Commercial highlights
   - Visibility.
   - Traffic/context.
   - Premium placement.
   - Campaign suitability.

6. Map / area preview
   - Use display/public coordinates only.
   - If no public coordinates, show an area note instead of exact map.

7. Availability note
   - Public availability label.
   - Avoid exposing exact reservations.
   - Example: "Disponibilitate la cerere" or "Disponibil din luna X" if safe.

8. CTA block
   - "Adauga in media plan".
   - "Cere oferta".
   - "Contacteaza Focus Media".

## 5. Gallery And Photos

Current state:
- Locations have `mainPhotoUrl`, `photoOriginalUrl`, and `Image[]`.
- Public components already fallback to `/samples/location-placeholder.svg`.

Future improvements:
- Public gallery should use only public/display URLs.
- Admin should choose main image in the editor.
- Cards should crop consistently.
- Presentation page should support image zoom/lightbox later.

MVP rules:
- Do not add upload system in public redesign.
- Do not expose `photoOriginalUrl` publicly unless it is intentionally public.

## 6. Map / Area Preview

Rules:
- Use `latDisplay` / `lngDisplay`.
- Never expose `latReal` / `lngReal`.
- If public display coordinates are not available, show city/area text.
- Maps should be optional on mobile, because location cards and shortlist matter more.

## 7. Shortlist Redesign

Shortlist should behave like a sales basket.

Each selected item should show:

- Thumbnail.
- Location code/name.
- City/area.
- Media type.
- Dimensions.
- Estimated price only if public/allowed.
- Selected period.
- Remove action.
- Reorder action later.

Shortlist actions:

- "Cere oferta".
- "Exporta Excel".
- "Printeaza / salveaza PDF".
- Future: "Salveaza ca media plan".

Public user behavior:
- No login.
- Shortlist stays in localStorage for MVP.
- User can submit contact/request details.
- Offer request creates internal sales lead, not a reservation.

Admin/sales behavior:
- Future admin action can import public shortlist into a saved MediaPlan.
- Sales can create a MediaPlan from selected locations and client/lead.

Persisted vs client-side:

| Data | MVP storage | Future storage |
|---|---|---|
| Public anonymous shortlist | localStorage | optional anonymous token/session |
| Submitted request | `OfferRequest` | `OfferRequest` linked to `MediaPlan` |
| Sales proposal draft | none today | `MediaPlan` |
| Client acceptance | none today | `Offer` / `MediaPlan` status/event |

## 8. CTA Language

Recommended CTAs:

- "Adauga in media plan" for adding to shortlist.
- "Cere oferta" for lead submission.
- "Contacteaza Focus Media" for direct WhatsApp/email.

Avoid for now:
- "Accepta oferta" until secure offer links exist.
- "Rezerva acum" because availability must be checked internally before HOLD.
- "Cumpara" or direct booking language.

## 9. Privacy Rules

Public pages and public API must never expose:

- internal notes;
- real/private coordinates;
- internal monthly cost;
- supplier costs;
- seller/admin data;
- reservations;
- contracts;
- documents;
- SmartBill/finance fields;
- private operational data;
- productionNotes;
- audit data.

Public can expose only:

- location identity and public presentation data;
- display coordinates;
- public images;
- public availability label;
- rate card only if `showPricePublic`;
- install/removal cost only if `showInstallationCostPublic`.

## 10. Public Redesign Acceptance Criteria

- `/locatii` remains fast and mobile-friendly.
- Public location cards do not contain private/internal fields.
- Location presentation page has clear sections and CTAs.
- Shortlist is visually understandable as a basket.
- Price/install cost visibility follows existing flags.
- Public API leak tests keep passing.
- No database migration required.


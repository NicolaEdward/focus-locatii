# Admin Detail Pages Plan

Date: 2026-06-29

Goal: replace "giant workspace hunting" with direct pages that answer: what is this, who owns it, what is current status, what happened, what needs action, and what is connected?

## 1. Shared Detail Page Principles

Every detail page should include:

- Header with identity, status and owner.
- Primary next action.
- Linked records.
- Timeline/audit.
- Documents.
- Permission-aware fields.
- Direct links to related pages.
- Clear empty states.

Do not move all edit workflows at once. Start read-only, then migrate actions safely.

## 2. `/admin/locatii/[id]`

Purpose:
- Full inventory detail for one location.
- Permanent destination for "Vezi detalii" and future media plan selection.

Sections:
- Overview: code, address, city, category, type, size, public visibility.
- Presentation: public-style image/gallery preview.
- Availability: active/future HOLD / RESERVED / BOOKED timeline.
- Commercial: rate card, public price flag, installation/removal cost flag.
- Operations: blocked state, GPS audit, display vs real coordinates by role.
- Finance: monthly internal cost, supplier cost, margin hints by location.
- Documents: permits, images, location docs.
- History: audit/import changes.

Actions:
- Edit location.
- Create reservation for this location.
- Add to MediaPlan.
- Copy public link.
- Export location factsheet.
- Duplicate/archive in advanced menu.

RBAC:
- Sales can view public/commercial availability, not internal costs unless allowed.
- COO/SUPER_ADMIN can view full operational/internal details.
- Finance can see finance/cost fields if granted.

Related records:
- Reservations.
- Campaigns.
- OperationTask / productionNotes tasks.
- Billing/receivable/payable rows linked later.

## 3. `/admin/clienti/[id]`

Purpose:
- One client account source of truth.

Sections:
- Overview: company name, CUI/CIF, owner, status, type.
- Contacts: people, email, phone, roles.
- Campanii: active/history.
- Rezervari: all reservations grouped by campaign/status.
- Financiar: receivables, overdue, payment history.
- Documente: contracts, invoices, docs.
- CRM: leads and activities.
- History: audit, merge history, ownership changes.

Actions:
- Edit client.
- Add contact.
- Create campaign.
- Create MediaPlan.
- Upload document.
- Merge duplicate, restricted to COO/SUPER_ADMIN.

RBAC:
- Sales Agent sees own clients.
- Sales Director sees team/all sales data depending policy.
- Finance sees financial/client data needed for receivables.
- COO/SUPER_ADMIN see all.

Related records:
- Campaigns.
- Reservations.
- Receivables.
- Documents.
- CRM leads.
- Offer requests.

## 4. `/admin/campanii/[id]`

Purpose:
- Campaign/contract overview across locations, operations and finance.

Sections:
- Overview: campaign name, client, seller, company entity, status, period.
- Locatii: selected/reserved/booked locations.
- Rezervari: reservation rows and status.
- Operational: decoration, neutralization, redecoration tasks.
- Financiar: billing items, invoices, payments, supplier costs, margin.
- Documente: contract, annexes, client files.
- Offer/media plan: source proposal if any.
- History: audit and status transitions.

Actions:
- Edit campaign.
- Add reservation/location.
- Create redecoration task.
- Upload document.
- Generate final report.
- Archive campaign with validation.

RBAC:
- Sales sees own/team campaigns.
- COO sees all and operations.
- Finance sees financial tabs.
- Operations sees operational tab.

Related records:
- Client.
- Reservations.
- Locations.
- Operation tasks.
- Billing items/receivables/payables.
- Documents.
- MediaPlan/Offer.

## 5. `/admin/rezervari/[id]`

Purpose:
- Exact reservation/HOLD/BOOKED detail and lifecycle actions.

Sections:
- Overview: location, client, campaign, seller, status, period.
- Availability: conflict status and nearby periods on same location.
- Lifecycle: hold expiry, conversion, release/lost/cancel history.
- Commercial: rent, currency, contract company/number.
- Operations: decoration/neutralization/redecoration status and cost.
- Finance: billing items, receivables, montaj cost billing.
- Documents: reservation/contract docs.
- History: audit and change logs.

Actions:
- Change period with conflict preview.
- Convert HOLD/RESERVED to BOOKED.
- Release hold.
- Mark lost/cancel where valid.
- Reassign seller where allowed.
- Update operations where `campaigns.operate`.
- Upload document.

RBAC:
- Sales Agent can manage own reservations within allowed lifecycle.
- Sales Director/COO/SUPER_ADMIN can manage broader reservations.
- Operation buttons require `campaigns.operate`.
- Finance can view finance links, not lifecycle actions.

Related records:
- Location.
- Client.
- Campaign.
- Billing items.
- Financial rows.
- Operation tasks.
- Audit/change logs.

## 6. `/admin/media-plan/[id]`

Purpose:
- Internal proposal draft workspace.

Sections:
- Overview: client/lead, seller, status, validity, company entity.
- Items: locations, snapshots, selected period, pricing.
- Availability: current conflicts vs snapshot availability.
- Pricing: subtotal, discount, TVA, total.
- Notes: commercial/public notes and internal notes.
- Offer link: sent/viewed/accepted/change requested.
- History: events and audit.

Actions:
- Add/remove/reorder locations.
- Edit price/discount.
- Check availability.
- Send offer.
- Duplicate plan.
- Cancel/expire.
- Convert accepted plan to HOLD.

RBAC:
- Sales Agent sees own.
- Sales Director can approve/send if policy requires.
- COO/SUPER_ADMIN can see all.
- Finance may view pricing after offer/campaign, but not necessarily drafts.

Related records:
- Client/lead.
- Locations.
- Offer link.
- Reservations after conversion.
- Campaign after booking.

## 7. `/admin/oferte/[id]`

Purpose:
- Internal offer-link status and client response management.

Sections:
- Overview: linked media plan, status, validity.
- Public preview: what the client sees.
- Client activity: viewed/accepted/change requested.
- Availability after response.
- Conversion actions.
- History/audit.

Actions:
- Resend/copy link.
- Expire/cancel link.
- Review change request.
- Convert to HOLD.

RBAC:
- Sales owner and sales director can manage.
- COO/SUPER_ADMIN can manage all.
- Public client accesses only token route, not admin route.

Related records:
- MediaPlan.
- Client/lead.
- Reservations after conversion.

## 8. Implementation Strategy

1. Add read-only detail pages with existing data loaders.
2. Update route helpers to use real detail routes.
3. Move one action at a time from large panels to detail pages.
4. Keep old workspace pages as list/search hubs.
5. Add audit/timeline component shared across pages.
6. Add documents component shared across client/campaign/reservation/location.

## 9. Tests Required

- Detail page auth redirects.
- Sales own vs foreign access.
- Finance tab visibility.
- Internal field privacy by role.
- Public/private coordinate handling.
- Route helper outputs.
- Deep links from dashboards and drawers.
- Empty states for no documents/no finance/no operations.


import assert from "node:assert/strict";
import { validateQuoteSelectionDraft } from "../src/lib/quote-selection-bridge";

const now = Date.now();
const valid = { ownerUserId: "seller-a", createdAt: now, clientName: "Synthetic", campaignName: "Synthetic campaign", companyEntity: "Focus Media", periodStart: "2090-01-01", periodEnd: "2090-01-31", locationIds: ["loc-a", "loc-a", "loc-b"] };
assert.deepEqual(validateQuoteSelectionDraft(valid, "seller-a", now)?.locationIds, ["loc-a", "loc-b"]);
assert.equal(validateQuoteSelectionDraft(valid, "seller-b", now), null, "Another account must not inherit this tab's commercial selection.");
assert.equal(validateQuoteSelectionDraft({ ...valid, createdAt: now - 30 * 60 * 1000 - 1 }, "seller-a", now), null, "Expired selection must be revalidated, never silently treated as fresh.");
assert.equal(validateQuoteSelectionDraft({ ...valid, createdAt: now + 60000 }, "seller-a", now), null);
assert.equal(validateQuoteSelectionDraft({ ...valid, createdAt: NaN }, "seller-a", now), null);
assert.equal(validateQuoteSelectionDraft({ ...valid, periodStart: "2090-02-30" }, "seller-a", now), null);
assert.equal(validateQuoteSelectionDraft({ ...valid, periodEnd: "2089-12-01" }, "seller-a", now), null);
assert.equal(validateQuoteSelectionDraft({ ...valid, locationIds: [] }, "seller-a", now), null);
assert.equal(validateQuoteSelectionDraft({ ...valid, locationIds: Array.from({ length: 51 }, (_, i) => "loc-" + i) }, "seller-a", now), null);
assert.equal(validateQuoteSelectionDraft({ ...valid, locationIds: ["https://foreign.invalid"] }, "seller-a", now), null);
assert.equal(validateQuoteSelectionDraft({ ...valid, campaignId: "../foreign" }, "seller-a", now), null);
console.log("Quote selection handoff: 11 account isolation, expiry, calendar and bounded-payload checks passed.");

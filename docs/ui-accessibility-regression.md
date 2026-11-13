# UI regression coverage

The shared `EscapeCloseHandler` manages dialog focus as well as Escape. Mount it
inside a visible `role="dialog" aria-modal="true"` shell. Prefer an explicit
`aria-labelledby` connected to the title; legacy shells receive a name from the
first heading. The helper keeps focus in the top dialog, makes its background
inert, locks body scrolling, and restores the opener. `enabled={false}` prevents
Escape from closing a busy dialog while retaining its focus boundary; Escape
does not fall through to a parent dialog. Do not add a competing document key
listener to a migrated shell.

Admin navigation disclosures render outside the horizontal navigation scroller.
Popup geometry is clamped to the viewport and updates on scroll/resize. Keyboard
activation focuses the first option; Escape restores the trigger. Link selection
closes the disclosure. Export dialogs can remain mounted inside an open menu.

Theme-aware `--status-*-text` and `--status-*-surface` variables define semantic
success, danger, warning and information colors. Legacy pale status utilities
use the same light palette. Intentional dark sections must use
`theme-dark-panel`; secondary controls in them use `theme-secondary-control`.
Do not restore a rule that turns all `.text-white` descendants of an alert white:
that makes a nested light button unreadable.

## Browser checks

Run only against a fresh isolated synthetic database and local app:

```sh
node scripts/release/run-with-env.cjs .env.preview.local node scripts/release/smoke-ui-regressions.cjs
```

Set `UI_SMOKE_BASE_URL` when the app is on another loopback port. The runner
requires a loopback MySQL `focus_preview*` database, a synthetic environment and
`ALLOW_SYNTHETIC_SEED=true`. It signs in as the synthetic COO account and does
not submit a business mutation.

Coverage includes all admin disclosure groups at 320, 390, 768, 1024, 1279, 1280,
1366 and 1440 pixels; structural reflow at 320/390/768/1366/1440; CRM snapshots
at loading/error/valid zero/24 long records, in both themes; measured semantic
contrast; dialog naming, Tab/Shift+Tab, opener restoration, nested dialogs and a
busy child. The nested fixture mounts the actual shared component in a temporary
local server, with no application test route shipped to production. A deliberately
unreadable and overflowing fixture must be rejected, proving the gate detects
those defects. Export dialogs launched from navigation are also exercised.

`UI_TEST_BROWSER_BYPASS_CSP=true` is available only for local Next development
hydration. Release checks against a production build must leave it unset. The
manifest records this distinction. No security conclusion about production CSP
can be drawn from a browser that bypassed it.

The capture matrix now includes light and dark for admin views (public pages
retain their product theme). `CAPTURE_THEMES=light` may narrow a local spot check;
the default release matrix uses both. Capture manifests include targeted contrast
and structural bounds, and identify unmeasurable gradient/transparency cases.

These checks are not full WCAG certification. Contrast over photographs and
unknown gradients, screen-reader behavior, physical devices and complete user
journeys still require appropriate review. Wide tables may use an explicit
internal horizontal scroller; structural cards and headings must fit the window.

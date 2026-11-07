---
target: both table and card views of Cashout
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
target_identity: "file:C:\\Users\\Carl\\Desktop\\Projects\\profit tracker\\profit-tracker-app\\src\\pages\\Cashout.jsx"
target_fingerprint: "sha256:2d1a531a9f20def17e12087d5146b13f84d9524c8cf05909c71a202b379e038e"
target_path: "C:\\Users\\Carl\\Desktop\\Projects\\profit tracker\\profit-tracker-app\\src\\pages\\Cashout.jsx"
timestamp: 2026-11-07T05-40-52Z
slug: profit-tracker-app-src-pages-cashout-jsx
---
Method: dual-agent (A: general-purpose design review · B: general-purpose detector/browser evidence)

## Design Health Score: 27/40 (Acceptable)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Sync status, cooldown, last-synced time all present; toggle's aria-pressed state is functional but visually subtle |
| 2 | Match system / real world | 4 | "Limit 100," "before tax," coupon codes -- genuinely domain-accurate |
| 3 | User control & freedom | 2 | No dismiss/hide for a deal; Log Purchase looks actionable but is a dead end |
| 4 | Consistency & standards | 2 | Expired deals keep a "--" placeholder in the table but lose the whole footer block in card view |
| 5 | Error prevention | 3 | Disabled Log Purchase, search-clear, sync cooldown guard |
| 6 | Recognition over recall | 3 | Store logos and profit coloring aid fast scanning |
| 7 | Flexibility & efficiency | 2 | Toggle vanishes below 1280px with no explanation, offers no real efficiency gain |
| 8 | Aesthetic & minimalism | 3 | Table appropriately dense; card view's fixed-footer rows create dead space |
| 9 | Error recovery | 3 | Sync failures toast with retry, LoadError on fetch failure |
| 10 | Help & documentation | 2 | "Coming soon" tooltip is the only inline help; no onboarding for the toggle |

## Design specificity verdict
Specific in vocabulary, generic in card composition. Both views pull from the same DealSummary/EstProfit/StoreLinks building blocks, so content stays reseller-specific in both, but the card's layout (3-stat grid, fixed two-line footer) is a bolted-on generic product-card template.

Deterministic scan: CLI/static detector found nothing (exit 0, empty array). The live-DOM detector found 22 tiny-text anti-patterns in table view, the identical 22 in card view, and 23 at mobile width (375px) -- the extra one is a real text-occlusion finding (a note line overlapping the UPC/mono line on a narrow card). 11 of the 22 are deal titles at 11.4px; the other 11 are ambiguous but likely the same pattern on labels/badges.

Visual overlays: the overlay ran and captured real console findings, but the tab was closed after collection rather than left open/labeled -- no live [Human] overlay remains. Findings reported as text instead.

## Overall impression
The table view is the real page -- dense, scannable, built for sorting by profit all day. The card view reuses the right data but none of the right judgment about what a card needs; it reads as "the view you get below 1280px" wearing a toggle that makes it look like a deliberate peer choice above that width.

## What's working
1. Every data point renders identically in both views -- no copy-paste drift between them.
2. Forcing cards below 1280px instead of cramming a 7-column table into a laptop width was the right structural call.
3. Expiry color-coding and the profit caveat prevent mistaking an estimate for guaranteed take-home.

## Priority issues

[P0] A note line overlaps the UPC line on mobile cards. Confirmed by the live detector at 375px: a real sibling element sits on top of another. A genuine rendering bug, not a detector artifact.
-> /impeccable harden cashout mobile card

[P0] Card footer has a long dead stretch when a deal has only one store. The footer is fixed at date-row-then-store-row with justify-between; one logo against a far-right button leaves a gap that reads as a layout bug.
-> /impeccable layout cashout card footer

[P1] 22 instances of sub-12px text in both views, concentrated in truncated deal titles at 11.4px. Repeats a pattern flagged in this page's first review.
-> /impeccable typeset cashout

[P1] The view toggle is too quiet to register as a feature. Two 14px unlabeled icons behind a thin divider; a first-time user is unlikely to ever notice it.
-> /impeccable polish cashout view toggle

[P2] Card view has no advantage for the page's actual task. Default sort is "Highest Profit," which rewards column-scanning -- exactly what card view makes harder, with no compensating benefit.
-> /impeccable distill cashout card view

[P2] Expired deals aren't treated the same way in both views -- table keeps a "--" for store links, card view drops the whole footer.
-> /impeccable harden cashout expired-deal consistency

[P3] Cards with more tags push their stat row down unevenly, breaking row alignment across the grid.
-> /impeccable layout cashout card tags

## Persona red flags
Jordan (first-timer): will likely never discover the toggle -- no text label, low-contrast zone. First and probably only experience is table view, forever, unless their window happens to be narrow.

Alex (power user): defaults to table and has no reason to switch -- card view offers no speed gain for profit-scanning, the thing Alex actually wants.

Casey (mobile-equivalent): there's no real mobile-specific card -- same desktop card reflowed to fewer columns, confirmed in source (one DealCard component). The P0 text-overlap bug is the direct cost of that.

## Minor observations
- py-0.2 on the connection-count badge isn't a real Tailwind step (recurring from the first review).
- StoreLink's fallback letter is hardcoded text-gray-800, not a --dp- token -- won't adapt to a future light theme.
- The two-line "Est. Profit / before tax" table header is slightly taller than its neighbors.
- 11 of the 22 tiny-text findings couldn't be positively identified (overlay masks their own attributes) -- likely real but unconfirmed.

## Questions to consider
1. If table view can show everything card view shows, with better scanability, what is card view actually for above 1280px -- and would it be more honest to only offer it below that width?
2. The page defaults to sorting by profit, which assumes column-scanning. Why build toggle UI and persistence around a view that works against that model?
3. Does a disabled, tooltip-only Log Purchase button train users to start ignoring buttons on this page generally, regardless of which view they're in?

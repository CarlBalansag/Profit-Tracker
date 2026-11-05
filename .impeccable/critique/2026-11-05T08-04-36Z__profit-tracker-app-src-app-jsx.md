---
target: phone view of the app
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:C:\\Users\\Carl\\Desktop\\Projects\\profit tracker\\profit-tracker-app\\src\\App.jsx"
target_fingerprint: "sha256:16c60ef56662750672c0cf7b8d48c0235861d17488c808422cb74d27ac5bc1eb"
target_path: "C:\\Users\\Carl\\Desktop\\Projects\\profit tracker\\profit-tracker-app\\src\\App.jsx"
timestamp: 2026-11-05T08-04-36Z
slug: profit-tracker-app-src-app-jsx
---
Method: dual-agent (A: design review · B: detector and browser evidence)

Target: phone view (375x812) of the app, default dark theme, seeded test data, branch feat/phone-bottom-nav.

## Design Health Score: 22/40 (Acceptable)

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | System status | 2 | Picking a sale item only highlights it; the form appears 2,379px below |
| 2 | Real-world match | 3 | Strong reseller terms; some developer wording |
| 3 | User control | 2 | No undo; Add Transaction drafts help |
| 4 | Consistency | 1 | Same money and status differ across screens |
| 5 | Error prevention | 2 | Quantity capped; Delete arms in place; sale checkbox does nothing |
| 6 | Recognition | 3 | Bottom nav labeled; many pages only in a long drawer |
| 7 | Flexibility | 2 | Quick add and search; no repeat purchase or scan |
| 8 | Minimalism | 2 | Transactions' first row is about 750px down |
| 9 | Error recovery | 2 | Retry and toasts exist; not exercised live |
| 10 | Help | 3 | Info icons, hints, Guide and tutorial |

## Design specificity

Mixed. Credit Card, return windows, batch aging and Est. Profit are product-specific. The phone composition is mostly a reflowed desktop page.

Detector: 17 source findings (ai-color-palette 9, side-tab 6, overused-font 2). Most are false positives or inert in the default theme. Real: Net Profit card label 2.3:1 and note 2.4:1, zero-count pipeline cards 3.5:1, h1 to h3 skips on Dashboard and Add Transaction, nested pipeline cards, heavy use of 11px text.

## Priority issues

1. [P0] Record Sale form opens off-screen. handleSelect (pages/AddSale.jsx:68) doesn't scroll or focus; the form starts below every batch. Fix: two steps on phones, or at minimum scroll to the form. Command: adapt.
2. [P1] Same fact differs across screens: AirPods sale $378.65 vs $449.74, Profit that doesn't add up on Transactions cards, on hand 6, 44 and 0, Analytics formula gap of $147.62, Sony dates a day apart. Some may come from seeded data. Command: clarify, then a logic and date fix.
3. [P1] Inventory dead and misleading controls: Add Inventory and Export Report have no onClick (pages/Inventory.jsx:106-112), View Sales opens eBay, no Sell action. Command: harden.
4. [P1] Phone Delete has no consequence text or cancel (pages/Transactions.jsx:1008-1024; source only). Use ConfirmDialog. Command: harden.
5. [P2] Add Transaction is a desk form: 2,502px, 22 inputs, Save at the end, receipt says Click. Command: distill.

## Persona red flags

- Reseller in a store: full form with Save far down; off-screen sale form; no Sell action on Inventory; fees hidden on cards.
- Distracted mobile user: 32px targets dominate; Record Sale may not keep a draft (untested).
- Accessibility user: Net Profit card contrast; screen reader flow untested.

## Minor observations

Mixed negative money formats, status wording, profit wording, export wording; Analytics tabs clip; chart legend faint; sale per-unit checkbox does nothing; Statuses empty boards push records down; "on the left" copy on phones; Transactions search only 128px wide.

## Questions

What if the phone app were only log a buy, log a sale, check a number? Why does Record Sale start from a list when the item is in hand? Which single number is profit?

---
target: Cashout page
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\Carl\\Desktop\\Projects\\profit tracker\\profit-tracker-app\\src\\pages\\Cashout.jsx"
target_fingerprint: "sha256:1b28b13c396f6e125b9443842a4143637968d1bffa3f3ed763eb0cf39d1b389f"
target_path: "C:\\Users\\Carl\\Desktop\\Projects\\profit tracker\\profit-tracker-app\\src\\pages\\Cashout.jsx"
timestamp: 2026-11-06T20-38-29Z
slug: profit-tracker-app-src-pages-cashout-jsx
---
Method: dual-agent (A and B, isolated)

## Design Health Score: 22/40 (Acceptable)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Last synced and cooldown are good; Live Deals count ignores filters |
| 2 | Match System / Real World | 3 | Good trade vocabulary; "Categories" is a margin band, "EB" unexplained |
| 3 | User Control and Freedom | 2 | No clear-all for filters; modal ignores Esc |
| 4 | Consistency and Standards | 2 | Three names for one job; Data Setup uses green, deals page purple |
| 5 | Error Prevention | 2 | Expired rows keep live links and green profit; tax caveat is hover-only |
| 6 | Recognition Rather Than Recall | 2 | Logos have no names; notes truncate; two Switch 2 rows look alike |
| 7 | Flexibility and Efficiency | 2 | No column sort, sticky header, saved filters or shortcuts |
| 8 | Aesthetic and Minimalist Design | 3 | Clean, but 17 dead buttons and an EB column add noise |
| 9 | Error Recovery | 2 | Sync failures only toast; Sync locks 60s after failure |
| 10 | Help and Documentation | 1 | One hover tooltip; nothing explains estimates or the flow |

## Design Specificity Verdict
Half-authored. Content is specific to resellers (Buy At logos, Limit, Delaware Only, Copy Address, Damaged Box, days left). The form is a generic dark SaaS table; every row has the same weight whether it earns $240 or loses $24.

Deterministic scan: CLI 0 findings on Cashout.jsx and CashoutIntegrations.jsx. Browser scan: 150 at desktop, 175 at phone: undersized-ui-text 124/149, tiny-text 23, plus one each of overused-font, ai-color-palette, dark-glow. dark-glow is a false positive for this page; the font and palette findings are app-wide.

## What's Working
- Default sort by Est. Profit with no-estimate deals last.
- Notes parsed into chips and Copy Address.
- Real phone cards with no horizontal overflow.

## Priority Issues
1. [P1] Buy At and Log Purchase are clipped on small laptops and tablets. At 1024 the table is 901px in a 728px scroller, 173px hidden. Fix: hide the Cashout column with one connection, min-width on Buy At, sticky actions, or cards up to about 1200px. Command: adapt.
2. [P1] Hierarchy is upside down. Manage Connections and 17 disabled purple buttons are loudest, store logos are 26.6px, Est. Profit is the same size as everything else. 10px text is 125 of 275 elements. Fix: quiet Manage Connections and Log Purchase, raise Est. Profit, raise the 10px floor to 11px. Commands: quieter, typeset.
3. [P1] Est. Profit overstates its certainty. Excludes tax and cashback, stated only in a hover tooltip. "+$0.00 0%" has a plus sign. Close to Retail lumps $0 with -$24.22. Fix: visible "before tax" label, unsigned zero. Command: clarify.
4. [P2] What you need after buying is the least visible information. Copy Address is 19px tall, coupon codes sit in truncated 10px notes that can't be opened on touch, chips swing row height 75-111px. Fix: copyable coupon chip, expandable notes, one-line chips. Command: layout.
5. [P2] Expired rows and accessibility gaps. Expired rows stay full strength with live links. Modal has no dialog role, focus move or Esc. Unnamed X, search clear and cashout select; selects have no focus indicator. Fix: dim and sink expired rows, remove their links, use a real dialog. Command: harden.

## Persona Red Flags
Alex: headers not sortable, header scrolls away, filters don't persist, Sync locked 60s after failure, no profit times limit view.
Sam: modal X unnamed and no focus move, selects have no focus indicator, tooltips unreachable by keyboard, 125 elements at 10px.
Casey: first card at y=426 of 812, logos 26.6px with 5.7px gaps, Micro Center logo illegible, white Show expired checkbox is the brightest thing, notes can't expand, no Cashout name on cards.

## Minor Observations
Manage Connections wraps on phone; alt repeats title; py-0.2 isn't a standard Tailwind step; logos depend on Google's favicon service; native confirm for removal; two Switch 2 rows share title, image and UPC.

## Questions to Consider
Should losing deals be hidden by default? Should a row show total opportunity (profit times limit)? Does the page need its own connection modal? Could Buy be one step showing store, code, address and limit together? Why does Log Purchase show before it works?

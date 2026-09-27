# Phase 2 — research QA: the eighteen checklist items and their checks

*Written 28 September 2026 for EQ-215 (docs/phase2-plan.md). Each item of the
brief's research QA checklist is listed with the automated check that covers
it — the file, and the phrase that opens the check's `ok` line, so a search
for the phrase finds the check — or with the reason no check can exist yet.
Nothing here is marked covered because the code looks right; an item is
covered when a check that would fail on the defect runs in CI.*

## How to run them

Offline, no browser (the CI `static` job):

```bash
node syntax.mjs && node build.mjs --check && node wording-check.mjs \
  && node scanner-test.mjs && node ingest-test.mjs && node register-check.mjs
```

In a browser, against a local server (the CI `runtime` job). One harness at a
time; `CDP_PORT` pins the Chrome debugging port so parallel worktrees do not
collide:

```bash
node serve.mjs --port 8123 &
node equity-test.mjs http://localhost:8123      # the checklist, ~40s
node mobile.mjs http://localhost:8123           # 360–1440px, focus walks, ~10 min
node sweep.mjs http://localhost:8123            # every route renders
node coverage-frames.mjs http://localhost:8123  # no page contradicts itself while loading
```

Two flags are for a person, not for CI:

- `node equity-test.mjs http://localhost:8123 --links` follows a sample of the
  SEC source links. SEC refuses a request without a contact address in the
  User-Agent, so it only runs with `SEC_UA="Name email@example.com"` set, and
  otherwise says it skipped. A 404 fails; a timeout does not (offline is not
  a broken link).
- `node register-check.mjs --release` also fails while any P0 row of the
  capability register is partial — the mechanical meaning of "Phase 2 is
  complete". It fails today, by design: every P0 item is partial.

## The eighteen items

| # | Item | Status | Check (file — phrase) or blocker |
|---|---|---|---|
| 1 | Canonical ids across exchanges | covered | equity-test.mjs — *canonical ids are one per instrument* (every instrument id of the MARKET:SYMBOL form, one per company row, naming the row back); *one identity per listed thing* |
| 2 | Ticker aliases resolve | covered | equity-test.mjs — *canonical ids are one per instrument* (every filer by ticker, -SEC id and CIK; every Bursa row by code, short name, .KL and MY: forms); *one identity per listed thing*; *every written form of a CIK resolves*; *the shell: all … company paths resolve back* |
| 3 | Duplicate instruments rejected | covered | equity-test.mjs — *a duplicate instrument is refused* (the shipped file, the registry, the universe, a watchlist); *watchlists are one service* |
| 4 | Source records reconcile with stored figures | covered for the shipped file | equity-test.mjs — *every filed company’s statement table reconciles with data/us.json* (13,920 cells, all 119 filers: each figure equals the file at the printed precision, absent and withheld cells print no number); the three goldens (*… revenue … match the filing, found under its own label*); *no share count read from the issued tag* (the withheld figures). **Blocked beyond that:** reconciling against SEC's current companyfacts rather than the file needs `data/us.json` regenerated, which needs the SEC contact address (docs/platform-plan.md §12.2). |
| 5 | Annual and quarterly periods handled | annual covered; quarterly blocked | equity-test.mjs — *a filed company shows no invented quarters*; ingest-test.mjs — the quarter-end-versus-year-end rules (*all … ingest rules hold*). **Blocked:** no quarterly figure is held for any filer; the ingest reads annual durations only, and 10-Q data needs an ingest change and a regeneration. |
| 6 | Missing is never zero | covered | equity-test.mjs — *no absent line becomes a figure*; *free cash flow is null exactly where*; *… reads n/a where its input is absent*; *every absent figure names its reason and every present one its kind*; *every filed company’s statement table reconciles* (absent cells print no number) |
| 7 | Illustrative data visibly separated | covered | equity-test.mjs — *an illustrative company's identity header says "illustrative figures"*; coverage-frames.mjs — the illustrative-count and banner questions; *a failed load paints the sample, labelled* |
| 8 | Search and navigation | covered | equity-test.mjs — *the keyboard reaches the search, its results and the page*; *the search finds a Bursa code*; *tabs live in the address*; *… /app/equities and /app/watchlists paths open the existing pages*; sweep.mjs visits every route |
| 9 | Tables show the correct periods and units | covered | equity-test.mjs — *every filed company’s statement table reconciles* (columns are the company's own fiscal years; both captions state USD billions); *MSFT-SEC statement columns run …*; *every research tab labels MSFT-SEC with its own fiscal years* |
| 10 | Ratios match independently recalculated values | covered for a US sample; Bursa blocked | equity-test.mjs — *ratios match figures recomputed by hand from the filings* (operating, net and FCF margin, ROE on average equity and cash conversion for Apple FY2024 and Microsoft FY2025, from figures typed from the 10-Ks). **Blocked:** Bursa ratios — the Bursa figures are synthetic and there is no licensed Bursa financial source to reconcile to. |
| 11 | Source links resolve | well-formedness covered; resolution manual | equity-test.mjs — *source links are well-formed for every filer* (https, an SEC host, the filer's own ten-digit CIK, for all 119); `--links` with `SEC_UA` follows a sample. **Blocked in CI:** SEC answers 403 to an anonymous runner. |
| 12 | Watchlists persist | covered | equity-test.mjs — *a watchlist survives a reload* (members, creation date and dates added read back after the page boots from nothing; the page shows it) |
| 13 | No cross-user access | **blocked** | There are no users. Everything is stored in one browser's localStorage and the privacy page says so; there is no identity to separate and nothing to test until accounts exist (the operating-entity gate, docs/phase2-plan.md §0). |
| 14 | Saved models preserve assumptions | covered for saved runs | equity-test.mjs — *a saved valuation run keeps its assumptions across a reload* (inputs byte-equal, model version stamped, replay equal to the saved bear/base/bull, carried by the export); *the Valuation Studio states what it computed*. Unsaved Studio edits do not survive a reload — the register's "Valuation models" row is feature-flagged and says so. |
| 15 | Exports reproduce the displayed figures | covered for the screener CSV and the backup | equity-test.mjs — *exports reproduce the figures on the page* (CSV rows, order and every score, metric and coverage cell against the table; Export everything → clear → import → export byte for byte); *the screener filters money … exports in the table's order with units and the definition*. **Not yet:** no company report exists to export (EQ-213 is queued in the register). |
| 16 | A stable scanner identifier per instrument | covered, with a stated limit | equity-test.mjs — *every instrument has one scanner identifier* (no symbol shared across markets; fails the day one is); scanner-test.mjs — the `setup|symbol|daily|bar` dedupe key. **Limit:** the scanner keys on the bare symbol, not MARKET:SYMBOL; the check guards the ambiguity rather than removing it. |
| 17 | Watchlist handoff for Phase 3 | covered as a file contract | equity-test.mjs — *the watchlist handoff keeps its contract* (below); scanner-test.mjs — *a watchlist universe evaluates the symbols it snapshotted*, *… without its symbol snapshot is refused*. **Blocked:** a server API (`/api/v1/*`) — there is no server; the export file is the contract. |
| 18 | Exchange metadata exposed | covered, with a data gap | equity-test.mjs — *every instrument states its exchange metadata and where it came from*. **Blocked:** a filer's listing venue — SEC companyfacts carries none and `data/us.json` has `exch: null` for all 119; the ingest can record it only on regeneration. Until then every filer says "unknown" rather than naming a venue. |

## Beyond the eighteen: responsive, keyboard, loading and error states

| Area | Check |
|---|---|
| Phone widths | mobile.mjs at 360, **375**, 390, 430, 768, 1024 and 1440 on 33 routes, now including /my/watchlists, /compare, /app/equities/explore, /app/equities/compare, /app/equities/aapl/valuation and /status. Horizontal overflow fails; tap targets under 44px are reported. |
| Keyboard | mobile.mjs focus walk (every Tab and Shift+Tab stop visible) on the calculator, screener, a company page, watchlists, and now the explorer and compare; equity-test.mjs — *the keyboard reaches the search, its results and the page* (skip link first, `/`, ArrowDown, Enter, Escape, as real key events) |
| Loading | equity-test.mjs — *the skeleton holds the page while the filings load* (the us.json request is held by the browser; the screener shows the skeleton and no sample row, then its rows when the file lands) |
| Error | equity-test.mjs — *a failed load paints the sample, labelled* (us.json answered 404: realStatus carries the reason, the banner says the filings did not load, the illustrative rows are painted, nothing throws) |

## The release condition

The capability register (src/js/80-registers.js, rendered at /status) now
carries, for every row that answers an item of the Phase 2 brief, the item
(`brief`), its priority from docs/phase2-plan.md §1 (`priority`), whether it
is `complete`, and the checks that cover it (`checks`). A seventh state,
**Feature-flagged**, is for a P1 surface that exists but lacks what the brief
requires: the page carries a notice drawn from the register row itself, and
/status lists it as not operational.

`register-check.mjs` runs in the static job and fails when:

1. a row in an operational state (active-core, maintenance, beta) has no
   path, or a path that does not resolve through the app's route table to a
   view that exists — or names a company or tab that does not;
2. a row's priority disagrees with the plan's for the item it cites, or an
   item of the brief is answered by no row;
3. a prioritised operational row, a flagged row or a complete one names no
   check, or names one that is not in the file it names;
4. a P1 row that is not complete and has a surface is not flagged, or a
   flagged row does not say what it lacks;
5. `complete` is claimed without checks or outside an operational state.

Today: seven P0 rows and four P1 rows. Company comparison and Valuation
models are flagged; Research workspace and the research report have no
surface and are queued. No row is complete.

## Watchlist contract v2

What `watchlistsExport()` writes, and what equity-test pins field by field.
A later scanner or server takes a watchlist in this shape; the shape changes
only with `WATCHLIST_SCHEMA`.

```text
{ kind: 'quantum-tradeworks-watchlists', schema: 2, exportedAt: ISO string,
  owner: string  — "this browser"; there are no accounts, so no ownerId
  watchlists: [ { id: string, name: string,
                  createdAt: ISO string | null, updatedAt: ISO string | null,
                  items: [ { id: '<watchlistId>:<companyId>', watchlistId, companyId,
                             instrumentId: 'US:MSFT' | 'MY:1155' | …, symbol, market,
                             name, coverage, addedAt: ISO string | null,
                             resolves: boolean } ] } ] }
```

`instrumentId` resolves to an instrument whose `symbol` and `market` are the
item's; `symbol` is what the scanner's watchlist universe reads (a setup
snapshots the symbols, because the Node worker cannot read browser storage);
`watchlistsImport` accepts this document and the older `{ id, name, ids }`.

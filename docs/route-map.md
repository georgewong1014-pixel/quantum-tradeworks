# Route map — Release A (navigation and clarity)

Every address the router answers, which chrome it wears, which product or
workspace item it belongs to, and whether it is the page's canonical address
or an alias of one; the sitemap; the navigation map; and the redirect map.

Release A consolidates the information architecture: it reorganises,
relabels and regroups, and removes nothing. Every address that opened a page
before Release A still opens that page. The source of truth is
`src/js/35-ui.js` — `ROUTES`, `PRODUCTS`, `PUBLIC_VIEWS`, `SECTION_OF`,
`PRODUCT_TABS`, `RESOURCES`, `APP_NAV_WORKSPACE`, `APP_NAV_FOOT`. The route
table below was generated from those tables when Release A was built
(2026-09-29); if this file and the code disagree, the code is right and this
file is stale.

## The two chromes

A view wears one of two chromes, decided by `chromeOf(view)` and written to
`<html data-chrome>`:

- **public** — the views in `PUBLIC_VIEWS`: `marketing` (`/`), `howItWorks`,
  `plans`, `about`, `contact`, `privacy`, `terms`, `learn` and its tabs,
  `boundaries`, `status`, `ips`, and `notfound`. They wear the public header.
- **app** — every other view. They wear the sidebar at 1024px and wider, and
  below that a slim bar whose menu button opens the same sidebar as a drawer.

The beta/demo disclosure bar is on both chromes, its words unchanged, and
on both it is one compact line. Its first sentence is written at boot by
`refreshDisclosure()` (95-boot.js) from what actually loaded — with the
filings in, "Beta preview — mixed sources. Do not use figures here for
investment decisions." — and "Which sources?" opens the rest at every
width: the source breakdown and the two research-mode chips ("Research
mode", "No advice · No recommendations"). Every word of it is one press away
on every page. Inside the app it used to run the whole breakdown and the
chips at every width above 760px, which put a workspace page's heading a
third to two-thirds of the way down a phone.

## Routes

"Product or section" is the sidebar item marked current (`SECTION_OF`); a
public page shows no sidebar. "Canonical" is what `canonicalPath()` writes
into `<link rel="canonical">`: a route is canonical when it is the first
non-alias route for its view and tab, and otherwise an alias of that route.
A company page's canonical is the company's own path (`companyPath`),
whichever address opened it — and since Release B that address is served a
page of its own, with the company's own head (see Company pages, below).

| Path | View | Chrome | Product or section | Canonical |
|---|---|---|---|---|
| `/` | marketing | public | — (public header) | canonical |
| `/app` | home | app | My Dashboard (workspace) | canonical |
| `/how-it-works` | howItWorks | public | — (public header) | canonical |
| `/research/queue` | researchQueue | app | Equities Research (product) | canonical |
| `/welcome` | onboarding | app | My Dashboard (reached from its "Other ways in") | canonical |
| `/discover` | discover | app | Equities Research (product) | the tab on screen: `/discover/screener` with no `?tab=`, else `/discover?tab=<tab>` |
| `/discover/screener` | discover · tab screener | app | Equities Research (product) | canonical |
| `/discover/value-map` | discover · tab radar | app | Equities Research (product) | canonical |
| `/research` | researchHome | app | Equities Research (product) | canonical |
| `/company/:id` | research | app | Equities Research (product) | the company page: `/company/<code>-<name>` (companyPath), its tab as `?tab=` |
| `/company/:id/report` | researchReport | app | Equities Research (product) | the company report: `/company/<code>-<name>/report` |
| `/app/equities` | researchHome | app | Equities Research (product) | alias of `/research` |
| `/app/equities/explore` | researchHome | app | Equities Research (product) | alias of `/research` |
| `/app/equities/compare` | compare | app | Equities Research (product) | alias of `/compare` |
| `/app/equities/:id` | research | app | Equities Research (product) | the company page: `/company/<code>-<name>` (companyPath), its tab as `?tab=` |
| `/app/equities/:id/report` | researchReport | app | Equities Research (product) | the company report: `/company/<code>-<name>/report` |
| `/app/equities/:id/:tab` | research | app | Equities Research (product) | the company page: `/company/<code>-<name>` (companyPath), its tab as `?tab=` |
| `/app/watchlists` | watchlists | app | Watchlists (workspace) | alias of `/my/watchlists` |
| `/equities/methodology` | learn · tab models | public | — (public header) | alias of `/methodology` |
| `/compare` | compare | app | Equities Research (product) | canonical |
| `/my/portfolio` | portfolio | app | Saved Models (workspace) | canonical |
| `/my/watchlists` | watchlists | app | Watchlists (workspace) | canonical |
| `/my/theses` | thesis | app | Saved Models (workspace) | canonical |
| `/my/alerts` | alerts | app | My Alerts (workspace) | canonical |
| `/my/reports` | reports | app | Reports (workspace) | canonical |
| `/my/tracked` | tracked | app | Watchlists (workspace) | canonical |
| `/app/scanner` | scannerDashboard | app | Quantum Scanner (product) | canonical |
| `/app/scanner/market` | scannerMarket | app | Quantum Scanner (product) | canonical |
| `/app/scanner/backtest` | scannerBacktest | app | Quantum Scanner (product) | canonical |
| `/admin/scanner` | scannerAdmin | app | Quantum Scanner (product) | canonical |
| `/admin/scanner/data` | scannerAdminData | app | Quantum Scanner (product) | canonical |
| `/admin/scanner/jobs` | scannerAdminJobs | app | Quantum Scanner (product) | canonical |
| `/admin/scanner/delivery` | scannerAdminDelivery | app | Quantum Scanner (product) | canonical |
| `/my/scanner` | scannerDashboard | app | Quantum Scanner (product) | alias of `/app/scanner` |
| `/app/scanner/setups` | scannerSetups | app | Quantum Scanner (product) | canonical |
| `/app/scanner/setups/new` | scannerSetupNew | app | Quantum Scanner (product) | canonical |
| `/app/scanner/setups/:setup` | scannerSetup | app | Quantum Scanner (product) | its own address |
| `/app/scanner/setups/:setup/edit` | scannerSetupEdit | app | Quantum Scanner (product) | its own address |
| `/app/scanner/watchlists` | scannerWatchlists | app | Quantum Scanner (product) | canonical |
| `/app/scanner/alerts` | scannerAlerts | app | Quantum Scanner (product) | canonical |
| `/app/scanner/alerts/:alert` | scannerAlert | app | Quantum Scanner (product) | its own address |
| `/app/scanner/settings` | scannerSettings | app | Quantum Scanner (product) | canonical |
| `/start` | launcher | app | My Dashboard (reached from its "Other ways in") | canonical |
| `/my/data` | userdata | app | Your data & settings (workspace) | canonical |
| `/my/workspace` | workspace | app | Saved Models (workspace) | canonical |
| `/app/workspace` | workspace | app | Saved Models (workspace) | alias of `/my/workspace` |
| `/discover/sarawak` | sarawak | app | Equities Research (product) | canonical |
| `/property` | property | app | Property Intelligence (product) | canonical |
| `/property/calculator` | property | app | Property Intelligence (product) | alias of `/property` |
| `/property/models` | propertyModels | app | Property Intelligence (product) | canonical — My properties, the reader's saved properties (audit #1, 30 Sep 2026) |
| `/property/opportunities` | opportunities | app | Property Intelligence (product) | canonical |
| `/property/comparables` | comparables | app | Property Intelligence (product) | canonical |
| `/property/areas` | areas | app | Property Intelligence (product) | canonical |
| `/us-options/wheel` | wheel | app | Equities Research (product) | canonical |
| `/wheel` | wheel | app | Equities Research (product) | alias of `/us-options/wheel` |
| `/cash-wheel` | wheel | app | Equities Research (product) | alias of `/us-options/wheel` |
| `/options` | wheel | app | Equities Research (product) | alias of `/us-options/wheel` |
| `/my/wheel` | wheel | app | Equities Research (product) | alias of `/us-options/wheel` |
| `/my/options` | wheel | app | Equities Research (product) | alias of `/us-options/wheel` |
| `/trading-index` | tradingIndex | app | Quantum Scanner (product) | alias of `/research/trading-index` |
| `/research/trading-index` | tradingIndex | app | Quantum Scanner (product) | canonical |
| `/learn/trading-index` | tradingIndex | app | Quantum Scanner (product) | alias of `/research/trading-index` |
| `/learn` | learn | public | — (public header) | the tab on screen: `/learn/glossary` with no `?tab=`, `/learn?tab=scoring`, else the tab's own path |
| `/learn/glossary` | learn · tab glossary | public | — (public header) | canonical |
| `/methodology` | learn · tab models | public | — (public header) | canonical |
| `/data-sources` | learn · tab data | public | — (public header) | canonical |
| `/learn/product-boundaries` | boundaries | public | — (public header) | canonical |
| `/status` | status | public | — (public header) | canonical |
| `/decision-record` | decisionRecord | app | the product of the record on screen: Property Intelligence (a property deal), Equities Research (the Cash Wheel) or Quantum Scanner (the Trading Index) | canonical |
| `/methodology/ips` | ips | public | — (public header) | canonical |
| `/corrections` | learn · tab trust | public | — (public header) | canonical |
| `/pricing` | plans | public | — (public header) | canonical |
| `/about` | about | public | — (public header) | canonical |
| `/contact` | contact | public | — (public header) | canonical |
| `/privacy` | privacy | public | — (public header) | canonical |
| `/terms` | terms | public | — (public header) | canonical |

75 routes. Any other path renders the not-found card (public chrome), and
the host answers it with status 404 (see the redirect map below). A
route whose view is not defined in the build would also render the
not-found card, never a blank page or a throw (`applyRoute`); since the
three Release A branches merged, every route above has its view
(`howItWorks` in 55-views-public.js, `researchQueue` in 40-views-discover.js).

Two tabs of the discover view have no path of their own and ride on
`/discover` as `?tab=ideas` and `?tab=heatmap`; Learn's scoring tab is
`/learn?tab=scoring`. Each of those is its own canonical. `/discover` and
`/learn` with no tab show the screener and the metric dictionary, and name
`/discover/screener` and `/learn/glossary` as their canonical, so the sitemap
lists those two and not the bare addresses.

## Company pages

Release B (D1, D2). `/company/:id` is a parameter route, and every company
address used to be served `index.html`, whose head is the homepage's — so a
link to a company previewed (WhatsApp, Slack, Facebook, LinkedIn) as the
homepage, and a crawler reading the HTML was told its canonical was the site
root. The address each company is linked at is known when the site is
built, so that one address now has a page of its own.

- **Which addresses.** Each company's canonical address, as `companyPath`
  writes it — `/company/<ticker>-<two words of the name>`, or on Bursa
  `/company/<listing code>-<two words>` (`/company/aapl-apple-inc`,
  `/company/brk-b-berkshire-hathaway`, `/company/1155-malayan-banking`) —
  for every company in the universe the page assembles once its filings
  load: the illustrative set in `src/js/10-dataset.js` (the Bursa companies,
  and PGR, the one US listing no filer replaces) and every SEC filer in
  `data/us.json`. `build.mjs` reads that universe out of the page's own code
  (`RAW`, the naming `addCompany` gives it, `realToCompany`,
  `retireIllustrativeTwin`) rather than restating it. With the data at the
  time of writing: 138 companies, 119 filed with the SEC and 19 illustrative
  (18 Bursa, 1 US). Nothing from the owner's machine: the personal lane is
  never deployed.
- **What each is served.** `pages/company/<slug>.html`: the shell and the two
  app files, like a route page, with the company's own head — the title the
  page's `setDocumentMeta` writes for it (`AAPL — Apple Inc. · Quantum
  Tradeworks`), its own address as canonical and `og:url`, and a description
  that says what the company is ahead of the company page's own line:
  "Apple Inc. (AAPL), listed in the US. Figures from its audited annual
  statements filed with the SEC (CIK 320193). A company report where every
  number shows its formula, its period and its source." — or, for a
  synthetic one, "Malayan Banking Berhad (MAYBANK, 1155), listed on Bursa
  Malaysia. Illustrative figures — synthetic, created for interface
  demonstration. Not filed, and not real. …" (the app's own words for
  illustrative figures). `og:`/`twitter:` tags repeat the title and the
  description. Once the script runs, the page sets the same title and
  canonical, and the generic research line as its description.
- **Rewrites.** One exact rewrite per company, generated from that list,
  after the static routes' and before the parameter routes', so
  `/company/:id` never answers a company's own address.
- **What keeps the generic page.** Every other form of a company address is
  still answered by its parameter route with `index.html`, where the router
  resolves the company: a ticker or code (`/company/aapl`, `/company/1155`),
  an id (`/company/AAPL-SEC`), a CIK or registry alias (`/company/1155.KL`),
  a shorter, longer or differently-cased tail, the report
  (`/company/<…>/report`) and the brief's `/app/equities/…` forms. An unknown
  company is the generic page too, on which the router draws the not-found
  card with `noindex`, as before.
- **Weight.** Each page is 22–23kB (the shell's markup); the 138 are 3.03MB
  together. A company's own address now transfers 23kB of HTML plus the
  app's two files, which every page shares and a browser keeps for a year,
  where it transferred the 3.4MB `index.html` with the app inline.
- **Checks.** `node build.mjs --check` fails on a company page that is
  missing, stale (a company that left the universe, or an address that moved
  with a name), edited or carrying the app, and on `vercel.json` out of step;
  the build itself refuses two companies at one address, an address the
  router does not open as the company page, a market it cannot name and an
  `addCompany` it cannot read. `served-check.mjs` (group 11) holds every
  company address to its head as served, the descriptions to `data/us.json`
  itself (filed exactly where the file says so), the rewrites' order, and the
  other forms to the generic page. `sweep.mjs` (company heads) holds the
  served heads to the page running in a browser with its filings loaded: the
  same companies, each address read back to its own company by the page's
  resolver, and the title and canonical the page sets there.

## Sitemap

`sitemap.xml` lists canonical, crawlable pages only: `/`, `/how-it-works`,
`/research/queue`, `/property`, `/property/opportunities`,
`/property/comparables`, `/research`, `/research/trading-index`,
`/us-options/wheel`, `/discover/screener`, `/discover/value-map`,
`/discover/sarawak`, `/compare`, `/methodology`, `/learn/glossary`,
`/learn/product-boundaries`, `/data-sources`, `/corrections`, `/status`,
`/pricing`, `/about`, `/contact`, `/privacy`, `/terms`.

Left out on purpose: every alias above; `/my/*`, `/app/watchlists`,
`/app/workspace`, `/property/models`, `/app/scanner/*` and `/admin/*`, which
`robots.txt` disallows (personal or one machine's); `/app` — My Dashboard, the visitor's
own counts and saved work — which `robots.txt` also disallows, by that
address alone (`Disallow: /app$`); `/welcome` and `/start`, which are
application shells rather than destinations; parameterised pages. The
company pages above are not listed either: whether search engines should be
invited to index them — 19 of them show synthetic figures under a real
listed company's name — is the owner's decision, not the build's, and
`build.mjs --check` still holds the sitemap to the routes' own pages.

## Navigation map

### Public header (public chrome)

Brand (→ `/`) · **Products** (menu) · **How it works** (`/how-it-works`) ·
**Pricing** (`/pricing`) · **Resources** (menu) · theme toggle ·
**Open workspace** (→ `/app`, the one primary action). No Sign In — there are
no accounts, and everything a visitor saves lives in their browser. No
search box: `/` and Ctrl/Cmd+K open the search from every page.

- **Products** — the four `PRODUCTS`, each with its status badge and blurb:
  Equities Research (Beta, → `/research`), Quantum Scanner (Beta, →
  `/app/scanner`), Property Intelligence (Live, → `/property`), Business
  Intelligence (Coming soon — a row of text, not a link).
- **Resources** — Methodology (`/methodology`), Data sources
  (`/data-sources`), Glossary (`/learn/glossary`), Learn (`/learn`),
  Corrections (`/corrections`), What this product will not do
  (`/learn/product-boundaries`) · Build status (`/status`), About (`/about`),
  Contact (`/contact`), Privacy (`/privacy`), Terms (`/terms`).
- Both menus are disclosure menus: a button with `aria-expanded`; Escape
  closes and returns focus to it; ArrowDown opens onto the first link and the
  arrows walk the links; Tab out of the panel, or a click outside, closes it.
- Below 1024px the header is brand · **Open workspace** · a menu button that
  opens a sheet holding the same items (the theme toggle among them).

### App sidebar (app chrome)

At 1024px and wider it is persistent on the left; below that it is a drawer
from the slim bar (brand, search, menu button): a modal dialog while open —
focus on its close button, Tab kept inside it, Escape and the scrim close it.

1. Brand (→ `/`)
2. **Search** (shows the `/` hint; one box over companies, pages and tools,
   and the reader's saved work, grouped under headings, with Recent — what
   was last opened in this browser — when nothing is typed; the count of
   companies joins its accessible name once the filings have loaded)
3. **My workspace** — My Dashboard (`/app`) · Watchlists (`/my/watchlists`)
   · My Alerts (`/my/alerts`) · Saved Models (`/my/workspace`) · Reports (`/my/reports`)
4. **Products** — Equities Research · Quantum Scanner · Property
   Intelligence, each with its badge. Business Intelligence is not listed
   (`SHOW_UNBUILT = false`).
5. Your data & settings (`/my/data`) · Plans (`/pricing`) · theme toggle

The item marked current is the one `SECTION_OF` names for the view. The
other personal pages wear My workspace's header (below) and mark the item
they fit: portfolio and investment cases mark Saved Models, tracked
instruments mark Watchlists.

My Alerts carries one unread count, inside its own link ("My Alerts, N
unread"): the unread among the kinds of alert that keep a read state — the
scanner's matches, by the scanner's own rule (scanUnreadCount; none when its
record is not visible here or the in-app count is off, never 0). `/my/alerts`
lists both kinds, each labelled — Research and Scanner matches — so the count
opens the page that shows what it counts. `/app/scanner/alerts` stays the
scanner's full history, linked from the Scanner matches section.

**Reports** (`/my/reports`, `SHOW_REPORTS = true`) sits in My workspace after
Saved Models: what the reader's own work can print — a company's research
report, each saved property's investor report and decision record, the Cash
Wheel's and the Trading Index's decision records — each opening the real
report.

### Product tabs

One row above every product page (a nav landmark named "<Product>
sections"), read from the tool registry (`TOOLS`, 35-ui.js; `PRODUCT_TABS` is
a view over it), under one product header — the product's name, its status
badge and the page's one primary action (`pageHead`, 36-layouts.js):

- **Equities Research** — Overview (`/research`) · Screener
  (`/discover/screener`) · Compare (`/compare`) · Research queue
  (`/research/queue`) · Sarawak watch (`/discover/sarawak`) · Cash Wheel
  (`/us-options/wheel`). The Screener tab is current on every tab of the
  screener's page (the `discover` view), whose own strip is the Screener's
  sub-tabs: Stock Screener (`/discover/screener`) · Quality vs Value Map
  (`/discover/value-map`) · Screening Strategies (`/discover?tab=ideas`) ·
  Heatmap (`/discover?tab=heatmap`). One row of navigation per level: the
  Value map is not a product tab as well, where it repeated the strip
  beneath it, and it stays one click away.
- **Property Intelligence** — My properties (`/property/models`) · Calculator
  (`/property/calculator`, current on `/property` too) · Area screen
  (`/property/areas`) · Comparables (`/property/comparables`) · Opportunities
  (`/property/opportunities`). The calculator's five sections (Acquisition,
  Financing, Rental & expenses, Scenarios, Report) are anchors on its page,
  not routes: `/property/calculator#scenarios` opens at Scenarios.
  There is no Overview tab: `/property` and `/property/calculator` are one
  view (the calculator; its canonical is `/property`), so an Overview tab
  would be a second name for the same page. The row gains it when a Property
  overview view is built.
- The company page (`research`) and its report keep their own tabs and get
  no product row.
- **Quantum Scanner** — since Release B its sections are TOOLS rows like the
  others' and it wears the same product header (its own strip,
  `SCANNER_SUBNAV`, is gone): Dashboard, Market (your series), Setups,
  Watchlists, Alerts (carrying the unread count, "Alerts, N unread"),
  Historical, Settings, **Trading Index** (`/research/trading-index`). The
  Trading Index's page shows the row with itself current.
- **My workspace** — every personal page (`/my/*` and the dashboard) wears
  one workspace header with one tab row read from the registry's workspace
  tools (`workspaceTabs`, 36-layouts.js): My Dashboard, Watchlists, My Alerts, Saved Models,
  Reports, Portfolio, Investment cases, Tracked, Your data & settings.
- **Start here.** The first time a reader opens Equities, the Scanner or
  Property, a labelled region at the top of its pages says what the product
  does, its one action and what they get, with a labelled example; "Hide" is
  remembered per product (`vl.startHere`) and Your data & settings brings it
  back.

### Footer

Products (the four; Business Intelligence as text with its badge) ·
Resources (Methodology, Data sources, Glossary, Learn, Corrections, What this
product will not do, Build status, Report a data error) · Company (About,
Contact, Plans & pricing, Privacy, Terms). Tagline "Research · Monitor ·
Model · Plan"; the legal paragraph is unchanged. That is the public
chrome's footer. Under an app page the footer is the slim one — Resources,
Company and the legal paragraph — since the sidebar already carries the
brand and the products.

## Redirect map

Release A renames and removes no address, so **no redirect between routes is
needed** and none is configured. What changed is where pages are reached
from, not where they live.

What the host serves at each address (since the launch audit, 2026-09-29) is
generated by `build.mjs` from `ROUTES`, not written by hand: each route
without a parameter has an exact rewrite to its own page (`pages/<route>.html`,
the site root to `index.html`), whose `<head>` is the one the router sets
there; each company's own address has an exact rewrite to its own page
(`pages/company/<slug>.html`, Company pages above), listed before the
parameter routes; the parameter routes rewrite to `index.html`; there is no
catch-all, and any other address is served `404.html` with status 404, where
the app draws the not-found card. Every page but `index.html` — the route pages and
`404.html` — carries only its head and the shell's markup, and loads the app's
script and stylesheet from `assets/app.<hash>.js` and `.css`, which are
`index.html's` inline ones byte for byte, cached for a year under a name that
changes with their content. `vercel.json` has two redirects of its own, both
308 with the query kept: a trailing slash comes off (`trailingSlash: false`),
and an address ending in `/index.html` goes to its folder. `serve.mjs` answers
from the same `vercel.json` by the same rules, and `served-check.mjs` checks
what either one serves.

Aliases that already existed, and still open the same page under their own
address (the canonical link names the target):

| Alias | Opens |
|---|---|
| `/app/equities`, `/app/equities/explore` | `/research` |
| `/app/equities/compare` | `/compare` |
| `/app/equities/:id`, `/app/equities/:id/:tab` | the company page (`/company/<code>-<name>`) |
| `/app/equities/:id/report` | the company report |
| `/app/watchlists` | `/my/watchlists` |
| `/equities/methodology` | `/methodology` |
| `/my/scanner` (a `?symbol=` link still opens the builder) | `/app/scanner` |
| `/app/workspace` | `/my/workspace` |
| `/property/calculator` | `/property` |
| `/wheel`, `/cash-wheel`, `/options`, `/my/wheel`, `/my/options` | `/us-options/wheel` |
| `/trading-index`, `/learn/trading-index` | `/research/trading-index` |

Two behaviours changed without an address changing:

- `/app` is no longer intercepted by onboarding (it used to replace the
  address with `/welcome` until the questions were answered). My Dashboard's
  first-time state is the onboarding now; `/welcome` is still a page anyone
  can open.
- Legacy fragment links (`#research/AAPL/valuation`, `#home`, …) are still
  translated to their paths at boot (`fromHash`, 95-boot.js), unchanged.

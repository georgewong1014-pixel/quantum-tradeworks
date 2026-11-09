# 09 — Test coverage and false-confidence review

Audit of 9 November 2026. Drafted read-only by a survey agent, then **tested by the auditor with negative controls in an isolated copy of the commit** (`git archive HEAD` into a scratch folder; built and served there on port 8141; nothing in the repository touched). Results, which settle the draft's CONFIRM items:

| Negative control | Expected | Observed | Conclusion |
|---|---|---|---|
| Repayment formula × 1.001 (RM2.37/month on the sample) → `model-test` | the suite fails | **2 of 324 invariants failed** (the two "worked by hand" break-even/reserve checks); the repayment figure and every yield on it passed | **Confirmed High (risk 6):** the suite proves internal consistency, not independent correctness. The independent known-answer scripts of this audit (02) do catch it. **Fixed in this audit:** check 3b "known answers" pins 20 figures over 3 deals to values worked outside the app; on the perturbed copy it now fails ("6 figure(s) differ from the independently worked known answers": the repayment 2375.33 vs 2372.96 and what rests on it); on HEAD it passes |
| "Guaranteed returns every year." planted on the homepage → `claims-review`, `wording-check` | both flag it | `claims-review`: **Tier 1: 1** (caught; but CI runs it `continue-on-error` without `--strict`, so CI would still be green). `wording-check`: **not flagged** (its marketing-claim test is scoped to /property-investing) | **Confirmed Medium (risks 7, 11):** the only net that catches a Tier-1 claim does not fail CI |
| `submission` journey against a non-local address | DEGRADED | the draft's prediction was **right: it would have FAILED** ("declares an outcome step and never took it"). **Fixed during this audit**: the outcome steps are now taken as gated steps with the reason; production run → DEGRADED, 0 fail; local → PASS | Confirmed and corrected before any push (risk 2 closed) |
| Six invalid POSTs from one sender through the dev server → `/api/report` | 5 × 400 then 429, no record | 400 400 400 400 400 429 429; store directory unchanged | Verified (04 §2 item 11) |
| Production served-check from an archive of `origin/main` | 68/68 | 68 passed, 0 failed | The served site is the committed build |

Other points verified: `DEGRADED` is non-fatal (journeys.mjs exit rule); four browser suites default to the production URL when run without an argument (model-test:68, equity-test:49, register-test:57, coverage-frames:43) — an auditor's hazard, not a CI one (CI always passes a localhost URL); `checks-record` never turns NOT RUN into PASS, but a suite exiting 0 with no tally reads PASS; seven CI steps (syntax, journeys self-test, report-api-test, checks-record self-test, CSP, wording-check, claims-review) never reach /status.

**Auditor's ranking of what to fix before relying on green:** (1) Deployment Checks (07 R-01); (2) independent known-answer constants in model-test; (3) `claims-review --strict` for Tier 1 in CI; (4) require an explicit URL for the browser suites or refuse a production target in checks-record. None of these is a product defect; none was changed in this audit except the `submission` journey.

---

## Survey draft (read-only, 9 Nov 2026)

Method: grep and read only. Nothing in the repository was run, built, served or modified. Line numbers are from the working tree at HEAD 83d415ce0 (clean). Items marked CONFIRM are inferences from code that the auditor should settle with a negative control (section 4).

## 0. Headline

The suites are unusually honest about what they prove: most state their own purpose, several guard against vacuity (model-test:1781, :1909, :8432; equity-test:183), and `checks-record.mjs` is built so that a suite that did not run never reads PASS. The main false-confidence risks are therefore not inside the suites. They are (a) the gate does not gate release, (b) several browser suites default to PRODUCTION when run without a URL, (c) the served-commit attribution is by home-page blob only, (d) a new local-only journey (`submission`) looks as if it will FAIL against production when pushed, (e) DEGRADED is non-fatal and absorbs console errors and slowness, (f) a number of checks are snapshots or share logic with the code they test, and (g) a few things (tap targets, NAPIC reconciliation, claims-review, contrast) are reported or skipped rather than enforced in CI.

## 1. Per-suite table

Column key: P = proves, N = does NOT prove, S = skipped/conditional, M = mocks/fixtures, H = hard-coded vs derived, C = circularity, T = targets current build?, F = failure propagation, R = reruns/flake, J = could pass with a broken customer journey.

### model-test.mjs (13,556 lines, browser, ~321 `ok(` sites)
- P: property-model arithmetic stated as DEFINITIONS (header :9-30): NPV at published IRR is zero (:180-192), break-even rent is a true zero (:199-216), tornado sort, State not mutated, paywall lock on net proceeds (L12, :5360-5378), plus hundreds of per-feature blocks.
- N: that the inputs (rent, price, rates, fee schedules) are right; that figures are fit for a user's decision; behaviour on a real device. No count floor: dropping a block lowers the total silently (no `passes >=` anywhere; grep found none).
- S: `skip` returns are all converted to `fail()` (:190, :215, :334, :361, :1456, :2013, :2039) - good. One quiet pass: exit-year comparisons "not compared" are `ok()` (:540). `lStep` turns a thrown check into a FAIL (:4872-4874).
- M: seeded `State.deal` objects and localStorage inside a fresh temp Chrome profile (`profile` = tmpdir, :88); no network except the app's own data files.
- H vs derived: mixed. Definitional checks use the app's OWN helpers (`npvAt`, `dealModel`, `propertyBreakPoint`, :183-216) so the "second formula" is partly the app's own; independent hand-worked cases exist (M/S/G/T deals at :~228-262, "worked by hand" appears 210 times). Fingerprint snapshots are hard-coded hashes (`'403db6fd:31593'` at :6757, :7795, :13529) - these are golden masters, which fail on any legitimate change and are re-blessed by editing the constant.
- C: yes for the NPV/IRR and break-even identities (the function that computes the figure also computes the check's residual); not circular for the hand-worked deals.
- T: loads `${BASE}/property/calculator?view=full` (:150-ish). CI passes `http://localhost:8123` served by `serve.mjs` from the committed tree. Default BASE is PRODUCTION (:68: `https://quantum-tradeworks.vercel.app`) if no URL is given.
- F: `process.exitCode = failures ? 1 : 0` (:13556); harness errors are caught into `fail('harness error')` (:13538). CI wraps it in `checks-record run model-test` with `if: !cancelled() && steps.serve.outcome == 'success'` (checks.yml runtime job).
- R: L13 flake - see section 3.
- J: yes in principle - it exercises the page, not a customer's path through the product; the journeys cover paths.

### equity-test.mjs (12,692 lines, browser, 276 `ok(` sites; header says ~286-302 checks)
- P: filed-statement labelling and derivations: definitions, a GOLDEN set (3 filings, hard-coded, looked up by FY label, :95-101), and rendered surfaces (735 `innerText`/`textContent` reads).
- N: that the 119 filers' data is right beyond three revenue/two equity figures; that SEC data is current; links resolve (`--links` is opt-in and needs `SEC_UA`, :2786-2796, not run in CI; a network error is "not a broken link", :2793).
- S: `--links` conditional; `skip:` returns converted to failures (:9725 is a `p6.push` = fail). Sets `State.plan = 'pro'` (:192) so the Free-plan gating is NOT exercised here.
- M: seeded plan, temp scanner dirs (:7042-7043), forced storage.
- H vs derived: heavily copy-string asserting (regexes on rendered text), so copy edits break it (brittleness) and passing proves the words, not the figure's correctness; some checks recompute from the data (`expected = us.json results.length`, :172) - the same file the engine loads, so "all N loaded" is circular for data content.
- C: partially (the engine's own formulas are re-derived in page context for margins/CAGR, :1768, using fixtures of the same data).
- T: served URL; default PRODUCTION (:49).
- F: exit code from `failures`; 660s watchdog `process.exit(1)` (:117-118) and browser-exit trap (:119). Timing: 660s is ~2x measured 316s (:104-115), flaky under load by the file's own comment.
- J: could pass with a broken journey (page-state checks, not paths).

### register-test.mjs (1,024 lines, browser + a static pre-check)
- P: record/edit/undo/replay invariants across every logged entity; static check that every `logRegister('x'` has a handler (:62-70).
- N: that the static regex finds every writer (it greps `index.html` for `logRegister('...'` only); data loss across browsers/devices.
- S: none found. M: seeded storage in temp profile. H: invariants, mostly derived. C: low. T: static part reads committed `index.html` from disk (:60-63); the browser part uses the served URL; default PRODUCTION (:57). F: `process.exitCode`, catch sets 1 (:1010-1013); parsed by checks-record from "register holds"/"N invariants broken" (checks-record.mjs:146-151). R: none noted. J: no.

### scanner-test.mjs (5,425 lines, node, no browser)
- P: scanner engine (sliced out of committed `index.html` via `loadEngine`, :35) on hand-worked series (SMA/EMA/RSI, :40-60) plus the worker CLI and locking on temp copies.
- N: real market data, real timeframes beyond daily, the personal lane, schedulers.
- S: none. M: temp dirs (`tmpdir()` :173, :327, :1037, :1246...), STUB child scripts for `daily.mjs` orchestration (:1250-1255, :1676-1678), synthetic history. 12 `new Date()`/`Date.now()` uses - clock-dependent (staleness/calendar tests, ~:806). Process-lock tests depend on PIDs and `hostname()` (:1181-1193).
- H vs derived: hand-worked constants (good). C: it imports the engine it tests, but expectations are hand-worked. T: committed `index.html`. F: `process.exit(1)` on engine load; exit from `failures`. R: lock/PID tests are environment-sensitive. J: n/a.

### ingest-test.mjs (485 lines, node)
- P: which fact wins in `annualSeries`, restatement/unit/period rules, replacement gate, `--from-raw`, CLI - all on INVENTED facts "shaped like the real thing" (header :5-18).
- N: that real SEC responses still have this shape (no live or recorded real payloads). The 119-company network verification is explicitly not run here.
- S: autoshot test is skipped with `console.log('skip ...')` and exit 0 when no Chrome/Edge is found (:449). ubuntu-latest has Chrome, so probably runs in CI - CONFIRM. M: all fixtures. H: derived per case. C: imports the same `ingest/sec.mjs` but expectations are explicit. T: source file, not a build. F: `process.exitCode` (:485). J: n/a.

### history-store-test.mjs (1,946 lines, node)
- P: price-history store validate/rank/trim/date logic and the daily orchestrator with STUB children (:771-780). "No network".
- N: that Yahoo/Twelve Data payloads match `yahooProvider`/`twelveDataProvider` reality (fixtures only). Requires `node build.mjs` first (:41 message) - it loads the committed `index.html`.
- S: none. M: temp files, stubbed ingest scripts (`STUB_*` env). T: committed `index.html`. F: `process.exit(failures ? 1 : 0)` (:1946). J: n/a.

### data-check.mjs (286 lines, node)
- P: the shipped `data/us.json` obeys the ingest's own `validateCompany`; plus header and cross-file checks.
- N: that the figures are the true filed figures. A `KNOWN` allow-list accepts two real defects (EMR dividend unit, CI share counts, :40-45), and it fails if a KNOWN item disappears, so the list stays honest.
- C: yes by design (same function the ingest uses to write the file, header :19-21). S: none. M: a stubbed fetch for the Sarawak geo case (:194). T: the committed file. F: `process.exitCode`/`exit(1)` on parse (:57, :65, :286).

### register-check.mjs (496 lines, node, no browser)
- P: the capability register's rows resolve to routes, named checks exist, P2 rows are not operational, robots rules.
- N: that the named checks PASS - rule 3 only verifies the file exists and the phrase is in it (header :35-41). `--release` (all P0 complete) is NOT run in CI "because every row is honestly partial today" (:43-46), so "Phase 2 complete" is never asserted.
- F: `process.exitCode` (:496).

### served-check.mjs (5,094 lines, HTTP only)
- P: every route is served 200 with its own head, byte-identical to the committed page (but for tags); company addresses; 404s; redirects; headers from `vercel.json`; CSP hash; sitemap; data files; `/status` renders the two health records faithfully, including "same/earlier/unknown build" wording (:1500-1545).
- N: that Vercel serves the same as `serve.mjs`. In CI it runs against `serve.mjs` (checks.yml static job, port 8124). Production mode (`--url`) is only run by hand; header :75-77.
- C: strongly circular by design: expected heads come from `build.mjs`/`clientRouter` (imports at :64-69), i.e. the code that generates the pages also produces the expectation. It proves committed output == generator output, not that either is right.
- T: ties pages to the checkout (reads files from disk; compares to served bytes). F: `process.exit(failures ? 1 : 0)` (:5094); `FAIL nothing answered` exits 1 (:263). Data-block tally is split for `/status` (checks-record.mjs:151-157).
- S: none noticed.

### build.mjs --check (2,664 lines)
- P: committed `index.html`, `404.html`, `pages/`, `assets/`, `vercel.json`, `prerender/` equal what the source would generate (hash compare, :2605-2612); stale pages detected; plus embedded content rules (map assets, CSP, kind badges, fee rulebook, home budgets).
- N: that the source is correct; that a deploy equals the commit. T: yes - compares the tree to its own source. F: `process.exit(1)` with a message (:2632); recorded via `checks-record run build-check`. CI checkout is one commit with no history; the code states renders keep dates in a manifest for this reason (prerender.mjs comment ~1060).

### prerender.mjs --check (1,129 lines, browser)
- P: each served page's markup equals the committed render drawn by the app in a headless browser (fixed viewport, reduced motion, fixed clock, empty storage, personal lane 404, prerender.mjs:~1062 manifest).
- N: that the render is correct; a bug baked into the committed render passes. Circular by construction (app vs. its own earlier output).
- S: `--only` exists for the WRITE mode only; `--check` runs full scope. M: fixed clock/locale/zone. T: served URL + committed renders, `asLive()` rewrites origin to draw "as production serves it". F: `process.exit(failed ? 1 : 0)` (:1128). CI prints committed-side diff only off CI (:1004).

### sweep.mjs (3,052 lines, browser)
- P: 108 hard-listed routes (:12-~110) each: no console error, no page exception, no `RM undefined`/`NaN`/`[object Object]`, page > 200 chars, no horizontal overflow, no metric card without kind badge; plus served-head, not-found, slim-load, `/status` honesty and `/pricing` boundary blocks.
- N: correctness; behaviour after the 2.6s wait. Route list is hand-maintained; blocks read the page's own `ROUTES` with floors (>=40 static, >=8 params, :240, :420) so a new route is not covered unless added to the list.
- Timing: fixed `sleep(2600)` per route (:175) - a slow render is read half-drawn (false pass or false fail).
- F: `process.exit(bad ? 1 : 0)` (:3052). Browser/ws cleanup is not in a `finally` (:3044) - an exception leaves Chrome running (CI: harmless; local: leaks profile).
- T: served URL, default `http://localhost:8123` (:11).

### coverage-frames.mjs (1,820 lines, browser)
- P: across sampled early frames a route never gives two answers to one question; no skeleton drawn; no filings-waiting state.
- N: correctness of any answer; Timing-based sampling (ms-keyed observations :144-186) is load sensitive. S: `--only` (:47). F: `process.exitCode` (:1809); parsed by counting `ok`/`FAIL` lines (checks-record.mjs:163-164), i.e. no printed tally to cross-check. T: served URL; default PRODUCTION (:43).

### mobile.mjs (6,335 lines, browser)
- P: no horizontal overflow 360-1440, no hidden focus stop, market-pulse-phone checks, text cut-off.
- N: tap targets: "under 44px ... (reported, not failed)" (:6329-6334) - CLAUDE.md section 10 minimum 44px is not enforced except inside market-pulse (:6300). Headless Linux fonts differ from user fonts (Verdana runs in some blocks only). No colour-contrast assertion found (grep: no "contrast" in sweep/mobile/coverage/model/journeys).
- F: `process.exitCode = bad ? 1 : 0` (:6335); harness error counted (:6318). T: served URL; default `http://localhost:8123` (:21).

### journeys.mjs (4,408 lines, real Chrome; 28 journeys now incl. `submission`; health record holds 27)
- P: end-to-end paths with outcome steps (`outcomes: [...]`, each declared outcome must be taken else the journey FAILS, :4376-4377).
- N: that paid/real-money, email, or live store paths work; production store (`submission` does not submit on non-local addresses, :4126-4130).
- S: `--only` (:14, :4357); a local-only step "Prepare a synthetic price history (local run only)" (:3025) and the scanner evaluate step is "gated" (a refusal is the pass, :302-303, :3088); `JOURNEY_FONT/TZ/LOCALE` env (:922-929); personal-lane `/data/*` requests are answered 404 inside the browser on localhost (:918).
- M: synthetic histories, seeded storage (`def.storage()`), temp dirs for import/export (:2530, :3633, :3947).
- T: local serve.mjs in CI (checks.yml:478); production via journeys.yml. Served commit identified from the home-page blob only (see risk 3).
- F: exit 0 unless a journey FAILs; 2 if the check cannot run (:4404, :4408); DEGRADED is non-fatal (:31, :4404).
- J: the `ctas` journey has `outcomes: []` by design (:4177) - "Landings only: a press that reaches a working page proves the link, not the tool behind it". It is honest, but a green `ctas` says nothing about the tools. Every other journey declares outcome steps.

### wording-check.mjs (726 lines)
- P: six banned phrases in `index.html` plus scoped phrase checks on named `src/js` files (e.g. :71, :140, :173, :206, :237, :264).
- N: copy elsewhere; served `prerender/`/`pages/` text (claims-review reads those). Exemption 2: any of ~15 denial words (`not available`, `cannot`, `never`, `does not`, `is not`... :31-35) within +/-260 chars silences the match, so a real claim near a disclaimer passes.
- F: `process.exitCode` (:726). Not recorded on /status (not in SUITES).

### claims-review.mjs (357 lines) + claims-reviewed.json
- P: lists tiered claims for a person; `--self-test` checks the fixtures and exit codes.
- N: it does not block. CI step has `continue-on-error: true` (checks.yml:230) and runs without `--strict`, so even a Tier 1 "guaranteed returns" hit does not fail CI (exit 0 unless `--strict`, :357). The allow-list is keyed by hash of sentence text, so reviewed sentences are exempt until reworded.

### syntax.mjs (51 lines)
- P: every inline `<script>` of `index.html` parses (`node --check`). N: runtime errors; `.mjs` files; `api/report.mjs`; the served `assets/app.*.js` (tied to `index.html` by build/served-check). F: `process.exit(bad ? 1 : 0)`.

### report-api-test.mjs (188 lines, offline, 52 checks)
- P: validation, file store, GitHub store behaviour, rate limit and daily cap, handler on a real local port.
- N: the real GitHub API contract (search/issues response, auth, issue creation) - all via a FAKE `fetchImpl` (:19-24, :83-102, :174-177); that production env variables are set (production store is unconfigured per owner memory and `docs/report-submission.md`); that Vercel serverless honours the in-process rate-limit buckets across instances (per-process "in this process" limit, api/report.mjs:55).
- S: none. T: source `api/report.mjs`. F: `process.exit(failed ? 1 : 0)` (:188). NOT in `checks-record` SUITES, so it never appears on /status (only in the Actions log). CI step has `if: !cancelled()` (checks.yml:156).

### checks-record.mjs (886 lines; `--self-test`)
- See section 5.

### deploy-check.mjs (188 lines)
- P: whole-file hash of the production home page vs the repo's (:1-40); exit 0 only on MATCH; exit 1 on STALE/timeout (:164-182). N: anything but the home-page file; fetch errors yield STALE not PASS. Manual tool, not in CI.

### journeys.mjs --self-test (offline)
- P: commit rule, result shape, table, `journeysServed`, workflow text assertions (e.g. :597, :617). N: that journeys work. Static regex assertions on workflow YAML (:584-617) fail when YAML is reworded and pass when the YAML is wrong but worded as expected.

## 2. Cross-cutting findings

- Browser suites default to PRODUCTION: model-test:68, equity-test:49, register-test:57, coverage-frames:43. Only sweep and mobile default to localhost. A bare `node model-test.mjs` run by an auditor or on a laptop tests the live site, not the commit. The suites print `target <url>` (model-test:150) but nothing forces a localhost target.
- Network/offline: journeys against production, `deploy-check`, `checks-record collect` (GitHub API, :476-488), `ctas` journey's Node `fetch` (journeys.mjs:4190), `equity-test --links`, the `submission` probe fetch (:4125). Offline: `collect` catches errors and writes every suite NOT RUN (:858-862); journeys returns "the site could not be fetched" (:766); deploy-check reports STALE and exits 1. None of these turn into PASS offline.
- Writes: all suites use `tmpdir()`/temp Chrome profiles; `prerender.mjs` (write mode), `build.mjs` (without --check), and `journeys.mjs --json/--markdown` write to the repo or a path you give. `journeys.yml` runs `build.mjs` and commits (journeys.yml:~297-307). `serve.mjs` sets `QT_REPORTS_DIR` to a temp directory unless tokens are set (serve.mjs:40). No suite writes to production storage; `submission` refuses to POST to non-local addresses.
- Timing/performance assertions (flaky by nature): model-test L13 (section 3); journeys `BUDGET` load 10s / action 4s (DEGRADED only) and `STEP_LIMIT` 45s (FAIL, :724-727, :1104); equity-test watchdog 660s (:116-118); sweep 2.6s fixed wait (:175); coverage-frames ms sampling.
- CI runs `chrome-version: stable` (checks.yml:310, :449): the browser version floats between runs; actions are pinned by major tag, not SHA.
- CI cannot see the personal lane (git-ignored data, checks.yml "no licensed data is committed" step), so CI differs from the owner's machine (owner memory "CI differs from local"). The converse also holds: suites on the owner's machine hit the personal lane unless journeys' 404 interception is on (:918).

## 3. model-test "scenario-lab L13" (load-sensitive)
- Where: model-test.mjs:5376-5408 (header at :4860 "a paint takes under a frame on a 4x slower processor").
- Measures: `performance` entries named `lab-paint` for 200 slider `input` events, each followed by a `requestAnimationFrame`, with CDP `Emulation.setCPUThrottlingRate` rate 4. Reports n, median, p95, max.
- Thresholds: n >= 150; at a 10-year hold, median <= 8ms and p95 <= 16ms; at a 30-year hold, p95 <= 33ms (:5398-5400).
- Reruns: a single measurement, no retry, no best-of. A busy runner can fail it; and a failure shows up as `FAIL` inside the otherwise-green model-test; checks-record has no retry logic either (judgeSuite, checks-record.mjs:187-201). Whether a human reruns the whole suite until green is an audit-trail question (workflow history), not visible in code. Related comment at :5763 shows prior tuning ("a paint's median sat within 10% of L13's limit").
- The check measures the app's own instrumentation (`lab-paint` marks emitted by the page); if the page stopped emitting marks, `n` would be < 150 and it would FAIL, which is the correct direction.

## 4. DEGRADED vs FAIL in journeys.mjs
- DEGRADED is set by `Journey.degrade()` (:1088) which only downgrades PASS to DEGRADED and records a note. Callers: a step slower than its budget (:1107), console errors logged along the way unless the journey sets `errorsJudged` (:4380-4383, the expected-absence list at :845), a missing XBRL concept (:1269), source-page errors in `ctas` (comment :4245 "DEGRADED ... rather than failing a press"), and the `submission` journey on non-local addresses (:4126-4130).
- FAIL is set by `Journey.fail()` (:1089) via `StepError` (:848), a step not finishing in 45s (:1104), an uncaught exception ("the check itself broke", :1111, :4373), or a declared outcome step never taken (:4376-4377).
- Exit code: `process.exit(n('FAIL') ? 1 : 0)` (:4404). Header :31 states "a DEGRADED one is reported, not fatal". CONFIRMED: DEGRADED does not fail the CI job (checks.yml:478 runs the bare command) nor `journeys.yml` (the run step does `set +e` and records the exit code, journeys.yml:~160-173). The issue "Production journeys failing" opens only when `fails > 0` (journeys.yml "open, update or close the issue", `FAILS`); a DEGRADED run never opens it, and `all_pass` is true only if every journey is PASS.
- A homepage that throws on every load is DEGRADED, not FAIL (journeys.mjs comment ~:4244-4250).
- No journey-count floor: `resultProblem` (:131-151) accepts any non-empty list, so a subset run (`--only`) would pass shape validation. The workflows never use `--only`.

## 5. checks-record.mjs: can /status or health/checks.json show PASS for a suite that did not run?
- Rules (judgeSuite :187-201): no log file -> NOT RUN; log but no exit file -> FAIL; PASS only if exit === 0 and not `failed > 0`. `collect` marks any suite with no annotation NOT RUN (`record()` :239-247) and its note says so (:529-531); a cancelled or skipped run is excluded by `pickRun` (:491-495); an unreadable GitHub API gives every suite NOT RUN (:858-862); `checksProblem` rejects a PASS with failures (:250-262); `--self-test` and served-check enforce "Pass with N of M suites ... never a pass" (served-check.mjs:1500-1507).
- So: the design does prevent NOT RUN -> PASS. Residual gaps:
  1. A suite that exits 0 while printing no tally is PASS ("exited 0, printing no tally", :198-200). A suite that exits 0 early (a swallowed error, an early `process.exit(0)`) gets PASS with null counts. No check demands a tally.
  2. `coverage-frames` and `mobile` counts come from counting `^ok`/`^FAIL` lines (:163-169): a change in their output format silently changes "N of M".
  3. Seven things run in CI and never reach /status: `syntax`, `journeys --self-test`, `report-api-test`, `checks-record --self-test`, the CSP step, `wording-check`, `claims-review`, `napic-ingest --check`, and the `journeys` job of checks.yml itself. A green /status therefore does not mean the release gate was green.
  4. The record identifies the build by the hashed app file (`app`, :75-83): same-app/different-data or api/vercel.json is treated as the same build.
  5. Recording is only after the fact: health/checks.json is written by the journeys bot for the commit the site serves (journeys.yml "collect the checks of the served commit"), so /status can be "Not run"/"earlier build" for new commits; this is handled correctly (served-check :1537) but means users see stale PASS from the last recorded commit.
- Cancellation: `concurrency.cancel-in-progress: true` (checks.yml:41) cancels the previous push's run; `gate` then fails ("cancelled" is not `success`); `pickRun` skips it; the previous commit is recorded NOT RUN. Good.

## 6. Ranked false-confidence risks

| # | Sev | Risk | Evidence | Minimum corrective action |
|---|-----|------|----------|---------------------------|
| 1 | High | Gate does not gate release: production deploys before CI finishes; "checks pass" does not mean "the deployed build was checked". | docs/release-gate.md:7 (deploy succeeded 6s after checks.yml started, gate passed 84 min later; Deployment Checks "still off"); :18 no branch protection. | Turn on Vercel Deployment Checks for "release gate" (docs/release-gate.md:60-61), or state plainly in certification that post-deploy journeys are the only live protection. |
| 2 | High (CONFIRM) | New `submission` journey declares three outcome steps but on a non-local address it degrades and `return`s before taking them; main() then fails any non-FAIL journey that lacks a declared outcome (:4376-4377), so the first production run after it is pushed would FAIL "the check itself broke". (This is a false ALARM, but it will turn the live record red and may hide a real failure under a known-red issue; the journey is in HEAD, not on origin: `git branch -r --contains 4dc4dd7d7` returned nothing; owner memory says "local NOT pushed".) | journeys.mjs:4108 (outcomes), :4126-4131 (`return` after degrade), :4376-4377. | Before pushing: run `node journeys.mjs --url <preview>` for `--only submission` and confirm; if it FAILs, make outcome enforcement skip journeys that degrade by design on non-local, or move the non-local probe into a separate step. |
| 3 | High | Browser suites default to production: a bare run tests the live site and can be mistaken for a test of the commit. | model-test.mjs:68, equity-test.mjs:49, register-test.mjs:57, coverage-frames.mjs:43. | Require an explicit URL (exit 2 when none) or print `PRODUCTION` prominently and have checks-record refuse a log whose `target` is not localhost. |
| 4 | Medium | Served-commit attribution uses the home-page blob only; data-only, api-only, vercel.json-only or non-home-page commits leave the blob unchanged, so a production journeys PASS is attributed to the newest commit that changed the home page (or to HEAD on a scheduled run when blobs match) and CI results are collected for that sha. | journeys.mjs:745-781, deploy-check.mjs:60-62, :133-150; journeys.yml `--commit "$DEPLOY_SHA"` only on deployment events. | Serve a build stamp (commit sha) in a header or in `/status`, and match on it; or hash the served `assets/app.*.js` and `/api/report` probe too. |
| 5 | Medium | DEGRADED absorbs real defects: slow steps, console errors on every load, the missing-evidence note, and an unexercised submission all stay green in CI and in the issue logic. | journeys.mjs:31, :1088, :1107, :4380-4383, :4404; journeys.yml issue rule uses `fails` only. | Treat DEGRADED caused by console errors (not slowness) as FAIL, or add a daily summary of DEGRADED causes to the certification evidence. |
| 6 | Medium | Many assertions are snapshots or share code with the thing tested: fingerprint hashes (model-test:6757, :7795, :13529); IRR/break-even identities using the app's own `npvAt`/`dealModel` (:183-216); `served-check` expectations built from `build.mjs` (:64-69); `prerender --check` compares the app to its own earlier render; `data-check` uses the ingest's own `validateCompany` (header :19-21); `equity-test` golden set is only 3 filers (:95-101). | as cited | Add a small independent second-source set: 5-10 hand-computed deals in a separate file, 10 more filed figures against EDGAR facts, recorded rather than re-derived. |
| 7 | Medium | Not enforced in CI: tap targets under 44px (mobile.mjs:6329-6334 "reported, not failed"); contrast (no test found); NAPIC reconciliation (always skipped in CI because the raw sources are git-ignored, checks.yml:238-239); claims-review (continue-on-error, no `--strict`, checks.yml:230); `register-check --release` (register-check.mjs:43-46). | as cited | Either add enforcement (a tap-target ceiling per route, a contrast check, `--strict` for Tier 1) or list these as known non-gating checks in the certification. |
| 8 | Medium | Real external contracts are never tested: SEC XBRL, Yahoo/Twelve Data, GitHub issues API are all fixtures/fakes. A provider shape change passes CI. | ingest-test.mjs:5-18, history-store-test.mjs:15-17, report-api-test.mjs:19-24; production report store unconfigured. | Keep one recorded real payload per provider as a fixture refreshed on a schedule, and run a daily live-contract check outside the gate. |
| 9 | Medium | Suite could exit 0 with no tally and read PASS on /status; /status omits seven CI steps. | checks-record.mjs:198-200, :163-169; SUITES list :89-111 lacks syntax/report-api/wording/CSP/claims. | Make a missing tally FAIL for suites that print one; add `report-api-test` and `wording-check` to SUITES. |
| 10 | Low-Med | Timing-based checks can flip: model-test L13 (single measurement, 4x CPU throttle on a shared runner), sweep's fixed 2.6s wait, equity-test 660s watchdog, coverage-frames ms sampling, journeys budgets; `chrome-version: stable` floats. | model-test.mjs:5398-5400, sweep.mjs:175, equity-test.mjs:116-118, checks.yml:310 | Take median of 3 for L13 or relax to a ratio against a baseline paint; pin a Chrome version. |
| 11 | Low-Med | `wording-check` can be defeated by an adjacent denial word; claims-review allow-list hides reviewed sentences by hash. | wording-check.mjs:31-35, :60-62; claims-review.mjs header | Scope the denial exemption to the same sentence. |
| 12 | Low | No count floors: a removed or conditionally skipped block lowers the count silently (model-test/equity-test), and `/status` shows counts, not a baseline. | grep: no minimum-count rule anywhere | Record the expected totals in `checks-record` SUITES and fail on a drop of more than N. |
| 13 | Low | `ctas` journey proves links land on working pages only; a green record for "Primary calls to action land on working pages" says nothing about the tools. | journeys.mjs:4175-4180 | Fine as stated; keep the label honest in /status. |
| 14 | Low | `equity-test` runs as a Pro user, so Free-plan limits are not checked there (model-test L12 does check the report paywall). | equity-test.mjs:192 | Cover plan limits in a journey. |

## 7. Safe negative controls (propose only - do not run in the repository)

All in a scratch COPY (`git worktree add` or `git archive` into a temp folder), never in `D:\Download\quantum-tradeworks`, and not while the release check is running.

1. model-test (figure mislabel): in the copy, change one figure's definition in `src/js/70-property.js` (e.g. add 1 to `breakEvenRent`), run `node build.mjs`, serve with `node serve.mjs --port 8211`, run `node model-test.mjs http://localhost:8211`. Expect FAIL at check 3 and exit 1. This tests the app's own helper circularity: also alter `npvAt` in the same copy and confirm check 1 still fails or note that it passes (this measures circularity).
2. equity-test golden set: in the copy, edit one Apple revenue figure in `data/us.json` (391.035 -> 391.000), rebuild, run equity-test; expect the GOLDEN failure and exit 1.
3. Fingerprint snapshot: change a default (e.g. sample price) and confirm only the fingerprint checks (model-test:6757) fail, i.e. snapshots, not definitions, are the detector.
4. served-check/build --check: edit one rendered word in `pages/about.html` in the copy; `node build.mjs --check` and `node served-check.mjs http://localhost:8124` must both fail; also touch a file under `prerender/` and run `prerender.mjs --check`.
5. wording-check bypass: add "The median price does not rise" next to a real claim in the copy's `index.html` and confirm the exemption (DENIAL) swallows it; then add the claim alone and confirm FAIL.
6. claims-review: in the copy, add "Returns are guaranteed." to a page and run `node claims-review.mjs` (expect exit 0) and `--strict` (exit 1); confirms the CI step cannot fail on it.
7. checks-record NOT RUN: with a scratch `QT_CHECKS_DIR`, create `model-test.log` with a passing tally but no `.exit` file and run `node checks-record.mjs summarize --job runtime --dir <dir>`: expect FAIL. Delete the log: expect NOT RUN. Create log + `.exit` 0 with no tally text: expect PASS "exited 0, printing no tally" (confirms gap 1).
8. Journeys DEGRADED: run `node journeys.mjs http://localhost:<port> --only ctas` with a throwing `console.error` injected into the copy's home page; expect DEGRADED and exit 0. Then repeat with a broken CTA href; expect FAIL and exit 1.
9. Submission journey (risk 2): `node journeys.mjs --url <any non-local preview> --only submission` (read-only for the owner's store because it refuses to POST); expect FAIL from the outcome-step rule at :4376-4377, or DEGRADED if I am wrong.
10. L13 flake: run model-test twice back to back with a CPU hog running in a scratch process (stress the machine), record how often L13 fails; this measures sensitivity without changing code.
11. Route list drift: in the copy, add a new route to `src/js` router and not to `sweep.mjs` ROUTES; confirm sweep still passes (the `statics >= 40` floor does not catch an unlisted route).
12. Offline behaviour: disable network and run `node checks-record.mjs collect --commit <sha> --out x.json`; expect every suite NOT RUN, exit 0 (workflow does not fail, but /status shows Not run).
13. Production-default hazard: in a scratch shell without a URL argument, run `node register-test.mjs --verbose` and read the `target` line; (read-only against production; it only loads pages).

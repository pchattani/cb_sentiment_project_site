# Handoff

> ## ✅ 2026-09-20 local session — the calendar branch is merged and five scrapers were repaired
>
> **Start from `BACKLOG.md`; the banners below this one are history.** Everything
> in §2 and the `calendar/dead-parsers` branch has landed on `main`. CI run 28
> green. **471 tests pass, ruff 75** (unchanged — no findings added).
>
> What changed, and what it means for anyone reading the rest of this document:
>
> | | |
> |---|---|
> | **D9/D10 merged and verified live** | The six repaired parsers were only ever proven against snapshots. Checked against the real pages: FED, ECB, BOE, RBA and CBRT all read the decision column. 46 dates written, **horizon 2026-12-23 → 2028-12-07, so D5 is closed.** |
> | **Three scrapers were broken, and only one of them for the reason on file** | **RBNZ** (B5) had failed twice and had no discovery fallback at all. **BOI** collapsed 131 → 1 intermittently — *not* the WAF it was filed as, but two broken UI interactions. **CBRT** was discovering ten ordinary press releases as policy statements, daily. All three rebuilt; see BACKLOG. |
> | **A real statement was unreachable and nobody knew** | CBRT's junk discovery auto-blocked a press release dated 2026-09-17, and statement ids are date-derived, so the genuine MPC summary published that day was blocked too. Recovered: 21,715 characters, ensemble -0.84. That mechanism is **B11** and it is still live. |
> | **`build_site.py` could not run on Windows at all** | It died on the first line of its own `main()`. The local-backfill procedure in §2.3 therefore could not publish what it fetched. Fixed, with a contract test. |
> | **NBP backfilled, and it will need doing again** | 2026-09-09 collected with `PLAYWRIGHT_HEADLESS=0`. NBP fails on the hosted runner every day by design; **every NBP meeting needs a local headed run** until R4 exists. |
> | **BCR: I7 stands, checked rather than assumed** | Re-tested from a residential IP with headed Chromium and stealth. Still the ShieldSquare CAPTCHA. Its probe was reporting a phantom find every run and now honestly reports a MISS. |
>
> **The threat list is in [`SCRAPERS.md` § What we cannot guarantee](SCRAPERS.md#what-we-cannot-guarantee)**, rewritten from a live sweep of all 23 sites rather than from code reading. The sharpest item is **B15**: 18 of 23 scrapers report a 60-day window rather than a back-catalogue, so NORGESBANK, ECB and BCR have **no partial-failure detection at all**.
>
> Two new operator tools worth knowing about: `update.py --reset-baseline CB`
> (for when you narrow a scraper on purpose — the baseline only ratchets up) and
> `suspected_missing_meetings` in `last_run.json` (gap check for estimated
> calendar dates, which is all the 14 manual-refresh banks have).

> ## ⚠️ Section 2 is DONE — and three of its diagnoses were wrong
>
> Worked through on the maintainer's machine, 2026-08-22. Everything in §2 has
> landed on `main` (CI run 20 green, 328 passed). **Read the corrections below
> before trusting anything else in this document**, and treat `BACKLOG.md` as
> the current state — §3 (traps) and §4 (remaining work) are still accurate
> except where noted.
>
> | § | Claim in this doc | What was actually true |
> |---|---|---|
> | 2.3 | NBP is blocked by datacenter IPs; a residential IP walks through | **Wrong.** A residential IP alone changes nothing. Needs headed Chromium **plus** stealth (`PLAYWRIGHT_HEADLESS=0`), and PDFs additionally need fetching through the browser context — the WAF cookie is fingerprint-bound and does not transfer to `requests`. Fixed; NBP current. |
> | 2.4 | SNB/BCR just need their blocks lifted; expect them to recover | **Half wrong.** SNB needed a real fix: `_GARBAGE_PERMANENT` matched valid SNB content, so the unblocked statement was re-discarded on the same run. Fixed; SNB current after 156 days. |
> | 2.4 | BCR should recover once unblocked | **Wrong.** BCR is hard-blocked by a ShieldSquare CAPTCHA that a headed browser does **not** defeat. Still stale — the only stale CB. Now **I7 (P1)**, and it needs your decision. |
> | 4.2 | A self-hosted runner fixes all four WAF CBs | **Scope is smaller.** It helps NBP only with a real display, and does not fix BCR at all. |
>
> Also found and fixed: the Claude scorer had been failing on **every** call
> since `anthropic` 1.0.0 removed `temperature` (logged as the 1-of-3 flake
> I3; it was total), and every text file I/O in the repo assumed the platform
> encoding, so the §2 tooling crashed on Windows. Both in *Fixed this cycle*.
>
> **One open decision blocks nothing else: I7 (BCR).** See BACKLOG.

> ## 🌿 A cloud session added work on an UNMERGED branch — 2026-08-23
>
> **`calendar/dead-parsers`**, three commits, CI runs 24–26 all green, **423
> passed / 1 skipped**, ruff **75** (down from 78). **None of it is on `main`,
> so none of it is live.** Merging it is the first thing to do — §2.0 below.
>
> It fixes **D9**: six of the ten auto-refresh calendar fetchers (FED, ECB,
> CBRT, RBA, BOE, BOT) had been parsing **zero** dates from healthy pages, and
> nothing detected it because each swallows its exception, returns `[]`, and
> the monthly job still exits 0. Also **D10**: that job can now actually fail.
>
> Three things a reader of this document needs to know:
>
> | | |
> |---|---|
> | **The parsers are proven against snapshots, not live sites** | They were written offline against `tests/fixtures/calendars/*.html`. One `refresh_calendars.py --dry-run` on your machine confirms them — **the expected dates per CB are tabulated at the top of *Outstanding work* in `BACKLOG.md`.** This is §2.6. |
> | **`forward_dates.json` was deliberately not edited** | `_merge_dates` never deletes (trap 3.3), so a wrong date from a stale snapshot would be permanent. Adding the dates is the job of that live run, not of a session that cannot see the pages. |
> | **BOI was misfiled as a dead parser** | Its page is a Radware challenge — HTTP 200, 118 KB, 106 characters of visible text. No parser change touches it. Now **I9**, in the WAF group needing the NBP recipe (R4), *not* the BCR one (I7). Its statement scraper is unaffected. |
>
> **D5 is unblocked but not closed.** The repaired parsers read to 2028-12-07
> (ECB), 2027-12-08 (FED), 2027-12-16 (BOE, provisional), 2027-12-14 (RBA),
> 2027-06-10 (CBRT). The horizon only actually moves once that live run stores
> them, so D5 is downgraded to P3 rather than struck out.
>
> A new trap came out of it — **3.7, reading the wrong column** — which was a
> bigger risk than the bug itself. Read it before touching any calendar parser.

Written for a fresh Claude session picking this up **on the maintainer's own
machine** (Cursor). That environment change is the point of this document: the
previous sessions ran in a cloud container that **could not reach any
central-bank website** (93-byte 403s from the egress proxy,
`ERR_CERT_AUTHORITY_INVALID` for Playwright) and had no API keys. Several items
were blocked purely on that. On a local machine with a residential IP and a
populated `.env`, they are the easiest wins available.

**Read [`BACKLOG.md`](BACKLOG.md) first** — it is the canonical register of every
open bug and outstanding item, with severities. This document is the *ordering*
and the traps; the backlog is the *inventory*. Don't duplicate them.

---

## 1. State of the repo

| | |
|---|---|
| `main` | `f3c1145`. Phases 1–4 landed; 22 of 23 CBs current, BCR the only stale one (I7). |
| **Unmerged** | **`calendar/dead-parsers`** — `c05a22e` (D9), `089200e` (D10), `95d78d0` (notes). CI 24–26 green. **Merge this first.** |
| Tests | **423 passed, 1 skipped** on the branch; **336** on `main`. (The 328 in the banner above was true at CI run 20 and has since moved — this row is the current figure.) |
| Ruff | **75** findings, down from 78. Lint is `continue-on-error` (I4). |

~~Branch `phase1/scraper-reliability`, 9 commits ahead.~~ **Merged to `main`**
on 2026-08-22. The commit list below is kept for provenance.

```
b273ae2  Mark Phases 1-4 complete in the backlog
56893a6  Add the model bake-off harness
88b67f3  Add a model registry; collapse the three scorers onto a shared base
d67a2ca  Add version dimension to the scored store
1f8a3a2  Add the standing backlog register; fix the Fed charset bug
75edf56  Add Statement Explorer tab; fix the dead Dash drill-down it ports
7c2c9b7  Add README, ARCHITECTURE and METHODOLOGY
350ef2d  Correct the SNB/BCR diagnosis in PHASE1_REMAINING
9e2323a  Never auto-block a scheduled meeting; unblock SNB and BCR
38491fd  Phase 1: detect broken scrapers in ~3 days instead of 45-136
```

Phases 1–4 of the production-hardening plan are complete: scraper reliability,
documentation, the Statement Explorer tab, and ensemble versioning + the model
bake-off framework. What remains is listed below.

### Setup

On Windows use `.venv\Scripts\python.exe` throughout — every `.venv/bin/...`
command in this document is POSIX-only. `uv` is what is installed on the
maintainer's machine and there is no system Python:

```bash
uv venv --python 3.11 .venv          # matches CI
uv pip install --python .venv/Scripts/python.exe -r requirements.lock
uv pip install --python .venv/Scripts/python.exe pytest ruff
.venv/Scripts/python.exe -m playwright install chromium
# then, for NBP or any WAF-blocked CB:  set PLAYWRIGHT_HEADLESS=0
```

Original POSIX instructions:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.lock
.venv/bin/playwright install chromium
cp .env.example .env    # ANTHROPIC_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY
                        # OPENAI_API_KEY only if running a bake-off with the GPT candidate
.venv/bin/python -m pytest tests/ -m "not network"   # 336 on main, 423 on calendar/dead-parsers
```

Install from **`requirements.lock`**, not `requirements.txt` — the floors in
the latter are what let `anthropic` 1.0.0 into production and silently disable
the Claude scorer (I1). CI installs the lock too, so all three environments
now resolve identically.

`scripts/update.py` **hard-exits at import** if not run from inside `.venv`.
That is why pure logic lives in `src/pipeline_health.py` — anything testable
belongs in `src/`, not `scripts/`.

---

## 2. Do these in order

**§2.1–2.5 are done** (see the banner). What is live for you is **§2.0 then
§2.6** — merge the calendar branch, then verify its parsers against the real
pages. The rest is kept for provenance.

### 2.0 ▶ Merge `calendar/dead-parsers` — START HERE

Three commits, CI runs 24–26 green, 423 tests, **zero data files touched**.
Nothing in D9 or D10 is live until this lands.

```bash
git fetch origin
git checkout main && git merge --no-ff origin/calendar/dead-parsers
```

Ordinary fast merge — it branches from `f3c1145` and touches no parquet.

### 2.1 Merge the branch <sub>(done 2026-08-22)</sub>

Nine commits, CI green, **zero production data files touched** (deliberately —
see the trap in §3.1).

> ⚠️ Do **not** merge `claude/cbrt-llm-meeting-dates-CdG0a`. It has an unrelated
> git root and carries stale June-18 data files. `phase1/scraper-reliability`
> supersedes it and was re-landed by patch onto current `main`.

### 2.2 Run the versioning migration — once, on `main`, after the merge

```bash
.venv/bin/python scripts/migrate_add_versioning.py --dry-run
.venv/bin/python scripts/migrate_add_versioning.py
```

It backfills `model_version` / `prompt_version` onto the existing 13,151
model-score and 601,600 sentence rows, and seeds `ensemble_scores.parquet` from
today's published `doc_score` as ensemble 1.0.

It fingerprints `doc_score` before and after and **exits 1 if a single published
number moved**. Verified already: 4,291 scores, checksum `1916.6433413417`,
identical. Commit the migrated parquets in their own commit, immediately, before
the daily job runs.

**Why it wasn't run already:** the daily job rewrites those 39 MB parquets every
day. Committing migrated copies from a branch would have guaranteed an
unrecoverable binary merge conflict. The code tolerates unmigrated data (there
is a test for it), so this ordering is safe either way — but do not skip it, or
the version dimension stays empty for all history.

### 2.3 NBP backfill — **now unblocked by running locally**

The one genuine outage. NBP sits behind Incapsula, which blocks GitHub Actions'
datacenter IPs. A residential IP should pass straight through.

```bash
.venv/bin/python scripts/update.py --cb nbp --since 2026-06-01
```

Expect two missed meetings: **2026-06-10** and **2026-07-08**. Then:

```bash
git add data/ docs/data/ logs/ && git commit -m "Local backfill: NBP" && git push
```

Tracked as GitHub issue **#14**. Close it when this lands.

### 2.4 Confirm SNB and BCR actually recovered

Both were stale for months not because their scrapers were broken but because
their statement IDs had been **permanently auto-blocked** (`SNB_..._20260618` on
2026-07-05, `BCR_..._20260710` on 2026-07-12). A blocked ID is rejected before
any scraper fix can matter. The branch unblocks them and makes it impossible to
auto-block a calendar-listed meeting.

```bash
.venv/bin/python scripts/update.py --cb snb --since 2026-06-01
.venv/bin/python scripts/update.py --cb bcr --since 2026-06-01
.venv/bin/python scripts/staleness_matrix.py | head -20
```

If they still don't fetch, *then* the scrapers need live diagnosis — and you now
have the network access to do it.

### 2.5 Issue housekeeping

Nine issues are open; most are stale duplicates. The auto-alert dedupe keys off
`active_alerts` in `logs/last_run.json`, which is git-committed, so a merge that
reverts that file re-opens closed issues (tracked as I2).

| Issue | Action |
|---|---|
| #5 CBRT, #6 BOI, #7 BCCH | **Close** — these CBs are current today |
| #8, #11, #13 BCR | **Close two**, keep one — same alert fired three times |
| #10 NBP, #12 SNB | Close once §2.3 / §2.4 land |
| #14 | Close once NBP is backfilled |

### 2.6 ▶ Verify the six repaired calendar parsers, then let them store dates

The one piece of D9 that a cloud session could not finish. The parsers were
written against captured pages, so they are proven against a **snapshot**, not
against what the sites serve today.

```bash
.venv/Scripts/python.exe scripts/refresh_calendars.py --dry-run
```

Check the output against the per-CB table at the top of *Outstanding work* in
[`BACKLOG.md`](BACKLOG.md) — it lists every date each parser produced from the
fixtures. Then drop `--dry-run` to store them.

What to expect, and how to read it:

- **Six fetchers should now return dates**; before this they returned nothing.
  A count roughly matching the CB's meetings-per-year is the signal.
- **BOI will still return nothing** — that is I9, a WAF block, and it now says
  so explicitly instead of looking like a parse failure.
- **NBP needs `PLAYWRIGHT_HEADLESS=0`** and a display, as before.
- **The script now exits non-zero** when a fetcher returns nothing usable
  (D10). NBP and BOI are on an expected-blocked list and do *not* fail the run.
- If a parser disagrees with the table, **the live page has changed since the
  fixture was captured** — recapture into `tests/fixtures/calendars/` and the
  existing tests will tell you exactly which assertion moved.

> **Do not hand-edit `forward_dates.json` to make it match.** `_merge_dates`
> is append/upgrade-only (trap 3.3), so anything wrong you add is permanent.
> Fix the parser and re-run.

---

## 3. Traps specific to this repo

These have each caused a real incident. Read before touching the relevant area.

### 3.1 Never commit the production parquets from a feature branch

`data/scored/*.parquet` (39 MB) are rewritten by the daily job. A binary merge
conflict on them is unrecoverable. Check `git status --porcelain data/` before
every commit. Every branch commit so far touches zero of them.

### 3.2 Scorer imports must stay lazy

`MODEL_REGISTRY` references scorer classes by dotted path
(`"src.scoring.claude_scorer:ClaudeScorer"`), resolved on first use.
**This is load-bearing, not stylistic.** Importing `google-genai` installs an
asyncio event loop on the calling thread, and the Playwright sync API refuses to
run on a thread that has one — so an eager import in `config/settings.py` breaks
all eight Playwright scrapers in the fetch phase. There is a test
(`test_settings_import_does_not_pull_in_scorer_modules`) that fails if this
regresses.

### 3.3 `_merge_dates` is append/upgrade-only

`scripts/refresh_calendars.py` never deletes a calendar date. Deleting a bad
date from `forward_dates.json` does **not** fix it — the next monthly refresh
re-adds it. This exact thing happened with MNB's non-decision Wednesdays. Fix
recurring pollution in the *fetcher*, not the data file.

### 3.4 The blocklist is permanent and silent

`data/blocked_ids.json` is checked before any scraper runs. A wrongly-blocked ID
can never be recovered by fixing the scraper — that is what cost SNB and BCR
several months. The branch adds a veto so a calendar-listed meeting can never be
auto-blocked, plus a test asserting the invariant. Don't weaken either.

### 3.5 CI reporting green locally is not CI reporting green

The CI gate silently ran **zero tests for twelve consecutive runs** because its
hand-picked dependency list omitted `requests`, `filelock`, `pdfplumber` and the
three model SDKs — five test modules failed at *collection*, which reads as a
build failure but was never checked. Local runs were green the whole time.
It now installs `requirements.txt`. **Check the actual CI conclusion after
pushing, not just the local suite.**

### 3.6 Resilience posture is not current breakage

`docs/SCRAPERS.md` marks 12 CBs "Manual fix required". All 12 are **working**;
that column describes what would happen *if* the site changed. Read the
**Status today** column for actual breakage. This distinction was previously
misreported and made the pipeline look far worse than it is.

### 3.7 On a calendar page, the wrong column looks exactly like the right one

The most dangerous thing about D9 was not the six dead parsers — it was how
easy the wrong fix was. Every one of these pages prints minutes, report or
second-board dates in the same format, in the table right next to the
decisions. Nothing distinguishes them to a regex.

Simply making the old patterns match again would have written, as if they were
rate decisions:

- ~14 CBRT minutes and Inflation/Financial-Stability Report dates
- up to 8 RBA **Payments System Board** dates a year — a different board that
  sets no rate
- 7 BOT minutes and report dates, three of them in 2027
- 5 FED minutes-release dates per year ("Released May 20, 2026")

The calendar drives the missing-meeting check, so each of those becomes a
recurring false alarm on a date no meeting was ever scheduled for — and
`_merge_dates` never deletes, so they would be permanent.

**So: select the decision column by header name, never by scanning cells.** And
when you write the test, assert the neighbouring dates are *not* produced —
then confirm those dates really are on the page, or the assertion proves
nothing. Two more of the same family, both pinned by tests:

- A **FED asterisk** marks a Summary of Economic Projections, **not** a
  cancellation. The old docstring said the opposite; believing it drops four of
  the eight meetings a year, all of them press-conference meetings.
- The **ECB** page has a Day-1 entry with no `(Day 1)` label (11/10/2028), so
  filtering on the label invents a meeting. The parser takes the last day of
  each consecutive run instead, which does not depend on labelling.

---

## 4. Remaining work

Full inventory with severities is in [`BACKLOG.md`](BACKLOG.md). Ranked here by
value, with what changes now that you're running locally.

### 4.1 R8 → R9: HTML fixtures, then harden the single-path scrapers

**The highest-value remaining engineering work, and R8 needs live network — so
it is newly unblocked.**

R8: capture one real HTML/PDF listing page per CB into `tests/fixtures/`, and
add parser regression tests asserting `discover_urls()` finds ≥1 ref and
`fetch_text()` returns non-empty. **Partly started:** eight fixtures exist —
`tests/fixtures/nbp_schedule_2026.html` and seven **calendar** pages under
`tests/fixtures/calendars/` — and D9 proved the approach works, since all six
parsers were repaired offline from them alone. But those are *calendar* pages;
R8 proper wants the **statement listing** page per CB, which is a different
page for every one of the 23. R9 stays blocked until they exist: **changing
selectors blind is worse than leaving them detected-but-manual.**

When you capture them, keep the D9 shape — split parsing from fetching into a
pure `parse_*(html, today)` so the test needs no network, and read trap **3.7**
first.

R9: then harden the 12 single-path scrapers — BANXICO, BCB, BOK, BOT, CBC, CNB,
ECB, MNB, NORGESBANK, RBA, RBI, SARB. Add layered discovery selectors and a
calendar probe where a calendar exists, and **raise rather than swallow** so
`fetch_cb` records a real error. Templates to copy: `cnb.py:167-170` and
`cnb.py:191` (layered selector fallbacks, plus a documented JS-render fallback
at `cnb.py:180`), `banxico.py:94` and `ecb.py:88` (explicit `raise` rather than
a silent empty result), `rbnz.py:236-267` (Wayback CDX — worth extending to
*discovery*, not just fetch).

Worst offenders to start with: `ecb.py:83-88` is a regex over a JS array literal
— the most brittle line in the repo — and `fed.py:92-93,108-113` has *illusory*
redundancy, where `skip_historical` is always True on daily runs so three
strategies collapse to one page inside a swallowing `try/except`.

### 4.2 R4: self-hosted runner

~~Fixes all four WAF-exposed CBs.~~ **Scope is narrower than this document
originally claimed** — see the first banner. What a runner actually buys:

| CB | Does a runner help? |
|---|---|
| **NBP** | Yes, **but only with a real display** — headed Chromium plus stealth. A headless runner gets the Incapsula challenge. |
| **BOI** | Its *calendar* page needs the same treatment (**I9**, found 2026-08-23). Its statement scraper is fine. |
| **BCCH** | Untested — currently current, so the value is unproven. |
| **BCR** | **No.** Hard-blocked by a ShieldSquare CAPTCHA that headed Chromium plus stealth does not defeat (**I7**). Needs a different answer entirely. |

Setup steps are in [`RUNBOOK.md`](RUNBOOK.md#self-hosted-runner-for-waf-blocked-cbs).
Route only the WAF CBs to it, keep the other 19 hosted, and alert rather than
silently skip when the runner is offline.

### 4.3 Spend decisions — need the maintainer's explicit go-ahead

Both are now technically unblocked (you have API keys) but cost money. **Ask
before running either.**

- **A real bake-off.** ~$2–4 for 200 statements × 4 models. The harness is fully
  built and exercised end-to-end against a stub scorer, but has **never touched
  a live API**. Use `--replicates 2` or the test–retest metric reports as
  unmeasured and the verdict refuses to pass the candidate.
  ```bash
  .venv/bin/python scripts/model_bakeoff.py score --models claude,gemini,deepseek
  .venv/bin/python scripts/model_bakeoff.py score --models openai --replicates 2
  .venv/bin/python scripts/model_bakeoff.py report --candidate openai
  ```
  The sample is already drawn and committed at `data/bakeoff/sample.json`.
  **Do not redraw it** — that breaks comparability with every future scorecard.
- **Backfill the 54 charset-corrupted FED statements.** `requests` defaults
  `text/*` to ISO-8859-1 when no charset is declared; the Fed declares none, so
  every en-dash and curly quote in 54 statements (2007–2026) became mojibake —
  **and the models scored the corrupted text.** Fixed forward in
  `BaseScraper._get`; the stored 54 need a re-fetch and re-score across 3
  models, which also trips `COST_GUARD_MAX = 20`.
  `src/scrapers/utils.repair_mojibake()` exists for this.

### 4.4 The open decision that needs a human

**D2 — three divergent "ensemble" definitions** live in the code:
the sentence-level mean in `parquet_store.compute_ensemble_scores` (the
published series), a mean-of-doc-scores in `build_methodology_data.py:126`, and
a third per-sentence recomputation in `build_site.py:1005-1009` that also drops
sentences under 10 characters and so can disagree with `doc_score`.

This is documented rather than fixed **on purpose**: reconciling them moves
published numbers. That is the maintainer's call, not a silent refactor. The
recommendation is to make `compute_ensemble_scores()` the single implementation
and have the other two call it — but get agreement first.

### 4.5 Smaller open bugs

Each is a contained fix; `BACKLOG.md` has the evidence and severity. Items that
were on this list and are now **fixed** — D3 (BOK's Sunday), D8/D9 (calendar
parsers), D10, I1/I8 (lockfile), I3 (Claude scorer) — have been removed rather
than struck through; the backlog keeps their history.

Safe to do without network, roughly in value order:

- **B5** — `rbnz.py:187` catches only `RuntimeError`, so a Playwright timeout
  bypasses the Wayback fallback entirely. The fallback exists but is
  unreachable for the most likely failure. Small, worth a test.
- **B6** — `fed.py:92-93,108-113` illusory redundancy: `skip_historical` is
  always True on daily runs, so three discovery strategies collapse to one page
  inside a swallowing `try/except`. **Same shape as D9** — something that looks
  layered but has exactly one live path — so the D9 approach applies directly.
- **B10** — BCR's listing discovery returns 0 refs across 67 pages and is
  masked by the calendar probe keeping discovery non-zero. Illusory redundancy
  again, and detection cannot fire.
- **B2/B3** — `build_methodology_data.py` is not in the daily workflow so
  `methodology.json` drifts; its input CSV was deleted, so it takes a skip
  branch and ships figures from a removed notebook. CSV recoverable at
  `b139b91^`, which works offline.
- **B8** — `snapshot.json` built every run and never fetched; `v.json` written
  and never read (`app.js` cache-busts with `Date.now()`).
- **B9** — `python-bcb` and `scikit-learn` declared but unused. Dropping them
  means regenerating the lock:
  `uv pip compile requirements.txt --universal --python-version 3.11 -o requirements.lock`.
- **I4** — 75 ruff findings, many mechanical `B904` (`raise ... from err`).
  Lint is `continue-on-error`, so this is safe chipping — keep it separate from
  behaviour changes.

Needs your machine or your decision:

- **D4** — BCR's calendar is **0 of 7 confirmed** while its WAF bypass probe
  depends on those dates. Transcribe from
  <https://www.banrep.gov.co/es/calendario-junta-directiva>.
- **D5** — no longer a deadline, but **not closed**: the repaired parsers read
  years past the old 2026-12-23 cliff and only need §2.6's live run to store
  them.
- **I2** — alert dedupe state lives in a git-committed file, so a revert
  re-opens closed issues. Cause of the duplicate BCR issues in §2.5.
- **I9** — BOI's calendar page is a Radware challenge (see the banner). Wants
  R4's runner with a display, like NBP.
- **B7** — stray `gemini_thinking` rows in `sentences.parquet`. **Touches
  `data/scored/`, so it is a machine-only job** (trap 3.1).

---

## 5. Conventions worth keeping

- **Add to `BACKLOG.md` the moment something is found**, even unfixed. A known
  issue with no owner still beats an unknown one. Move it to *Fixed this cycle*
  with a one-line note on **why it mattered**, not just what changed.
- **Testable logic goes in `src/`, not `scripts/`** — `scripts/update.py`
  hard-exits at import outside `.venv`.
- **Verify against reality, not intent.** Several bugs in this codebase survived
  because a fix was deployed and never confirmed to have taken effect. Check the
  data, check CI, check the live page.
- Run `.venv/bin/python -m pytest tests/ -m "not network"` and
  `.venv/bin/ruff check src/ scripts/ tests/` before pushing. Lint is
  `continue-on-error` in CI until the 75 pre-existing findings clear (I4), so
  it will not block you — but don't add to the pile.

---

## 6. Kickoff prompt

Paste this into a fresh Claude session in Cursor with the repo open. **Updated
2026-08-23** — the previous version pointed at §2.1–2.5, which are done.

```
You're picking up the cb_sentiment_project pipeline. Read docs/HANDOFF.md
first, then docs/BACKLOG.md — HANDOFF has the ordering and the traps, BACKLOG
is the full inventory of open issues. Read both banners at the top of HANDOFF
before trusting the body: several of its original diagnoses turned out wrong
and are corrected there.

You're on the maintainer's Windows machine with network, a display and API
keys, so use .venv\Scripts\python.exe and install from requirements.lock.
Cloud sessions could not reach central-bank sites, which is why some work is
snapshot-verified rather than live-verified.

Two things are waiting:
  2.0 merge the calendar/dead-parsers branch — three commits, CI green, not
      on main yet, so none of it is live
  2.6 run `scripts/refresh_calendars.py --dry-run` and check the output
      against the per-CB table in BACKLOG.md's "Outstanding work", then drop
      --dry-run to store the dates. This is the live confirmation the cloud
      session could not do, and it closes D5.

Then propose a plan for section 4 and check with me before starting. Do not
run anything that costs money (section 4.3) without asking first, and do not
touch data/scored/ (trap 3.1) or D2.

Section 3 lists traps that have each caused a real incident. 3.7 is the newest
and the least obvious: on a calendar page the wrong column is indistinguishable
from the right one, and the naive fix silently invents meetings.

Three standing rules:
- Verify against reality, not intent. Several bugs here survived because a fix
  was deployed and never confirmed to have taken effect — check the data,
  check CI's actual conclusion, check the live page.
- Never delete a date from forward_dates.json to fix it. _merge_dates is
  append/upgrade-only, so a working fetcher re-adds it next month. Fix the
  fetcher.
- Add anything you find to docs/BACKLOG.md immediately, even if you don't fix
  it, and move fixed items to "Fixed this cycle" with a note on why it
  mattered.
```

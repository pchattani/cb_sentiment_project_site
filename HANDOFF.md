# Handoff

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

~~Branch `phase1/scraper-reliability`, 9 commits ahead.~~ **Merged to `main`**
on 2026-08-22 (plus two later commits). CI run 20 green, 328 tests pass. The
commit list below is kept for provenance.

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
uv pip install --python .venv/Scripts/python.exe -r requirements.txt pytest ruff
.venv/Scripts/python.exe -m playwright install chromium
# then, for NBP or any WAF-blocked CB:  set PLAYWRIGHT_HEADLESS=0
```

Original POSIX instructions:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/playwright install chromium
cp .env.example .env    # ANTHROPIC_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY
                        # OPENAI_API_KEY only if running a bake-off with the GPT candidate
.venv/bin/python -m pytest tests/ -m "not network"   # expect 322 passed, 1 skipped
```

`scripts/update.py` **hard-exits at import** if not run from inside `.venv`.
That is why pure logic lives in `src/pipeline_health.py` — anything testable
belongs in `src/`, not `scripts/`.

---

## 2. Do these in order

The first two are ordered dependencies. Everything after is independent.

### 2.1 Merge the branch

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

---

## 4. Remaining work

Full inventory with severities is in [`BACKLOG.md`](BACKLOG.md). Ranked here by
value, with what changes now that you're running locally.

### 4.1 R8 → R9: HTML fixtures, then harden the single-path scrapers

**The highest-value remaining engineering work, and R8 needs live network — so
it is newly unblocked.**

R8: capture one real HTML/PDF listing page per CB into `tests/fixtures/`, and
add parser regression tests asserting `discover_urls()` finds ≥1 ref and
`fetch_text()` returns non-empty. No fixtures exist today, which is why R9 is
blocked: **changing selectors blind is worse than leaving them
detected-but-manual.**

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

Once §2.3 confirms a residential IP defeats Incapsula, a self-hosted runner on
that machine permanently fixes all four WAF-exposed CBs (NBP, BCR, BCCH, BOI) at
no recurring cost. Setup steps are in [`RUNBOOK.md`](RUNBOOK.md#self-hosted-runner-for-waf-blocked-cbs).
Route only those four to it; keep the other 19 on hosted, and alert rather than
silently skip if the runner is offline.

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

Each is a contained fix; see `BACKLOG.md` for evidence and severity.

- **B2/B3** — `build_methodology_data.py` isn't in the daily workflow, so
  `methodology.json` drifts indefinitely; its input CSV was deleted so it takes
  a skip branch and ships figures from a removed notebook (recoverable at
  `b139b91^`).
- **B5** — `rbnz.py:187` catches only `RuntimeError`, so a Playwright timeout
  bypasses the Wayback fallback entirely — unreachable for the most likely
  failure.
- **B7/B8/B9** — stray `gemini_thinking` rows in `sentences.parquet`;
  `snapshot.json` built and never fetched, `v.json` written and never read;
  `python-bcb` and `scikit-learn` declared but unused.
- **D3** — BOK 2026-06-28 is a **Sunday** marked `confirmed: true`. The gap
  check now ignores weekends, but BOK is manual-refresh only so it will never
  self-correct. Delete the row.
- **D4** — BCR's calendar is **0 of 7 confirmed** while its WAF bypass probe
  depends on those dates. Transcribe the real ones from
  <https://www.banrep.gov.co/es/calendario-junta-directiva>.
- **D5** — ⏰ **Calendar horizon ends 2026-12-23.** From November, 15 CBs fall
  below two future meetings, at which point the probe fallback and the gap check
  both become silent no-ops. `scripts/check_calendar_health.py` warns ahead of
  it. This one has a deadline.
- **I1** — `requirements.txt` is all floors with no lockfile, re-resolved
  against PyPI latest on every daily run. Now that CI installs the same tree, CI
  will catch a breaking release first — but a lockfile is the real fix.
- **I3** — Claude scorer errored once on the 2026-08-21 run (counter 1 of 3).
  Below threshold, but worth watching.

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
  `continue-on-error` in CI until the ~79 pre-existing findings clear (I4), so
  it will not block you — but don't add to the pile.

---

## 6. Kickoff prompt

Paste this into a fresh Claude session in Cursor with the repo open.

```
You're picking up the cb_sentiment_project pipeline. Read docs/HANDOFF.md
first, then docs/BACKLOG.md — HANDOFF has the ordering and the traps, BACKLOG
is the full inventory of open issues.

Important context: previous sessions ran in a cloud container with no network
access to central-bank websites and no API keys. You're on the maintainer's
machine, so several blocked items are now actionable. Section 3 of HANDOFF
lists traps that have each caused a real incident — read them before touching
the relevant area.

Start with HANDOFF section 2, in order:
  2.1 merge phase1/scraper-reliability (NOT the claude/cbrt-* branch)
  2.2 run scripts/migrate_add_versioning.py once on main, commit immediately
  2.3 backfill NBP locally — this is the one real outage
  2.4 confirm SNB and BCR recovered
  2.5 close the stale GitHub issues

Then propose a plan for section 4 and check with me before starting. Do not
run anything that costs money (section 4.3) without asking first.

Two standing rules:
- Verify against reality, not intent. Several bugs here survived because a fix
  was deployed and never confirmed to have taken effect — check the data,
  check CI's actual conclusion, check the live page.
- Add anything you find to docs/BACKLOG.md immediately, even if you don't fix
  it, and move fixed items to "Fixed this cycle" with a note on why it
  mattered.
```

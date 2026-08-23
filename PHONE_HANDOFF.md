# Phone handoff — work that needs no machine access

Written 2026-08-22 for a Claude Code session on **mobile / cloud**, picking up
while the maintainer is away from their computer.

Read this instead of `HANDOFF.md`. That document is written for the
maintainer's Windows machine and most of its instructions cannot run here.
`BACKLOG.md` is still the canonical inventory — cross-reference it by ID.

---

## 1. What this environment can and cannot do

You are **not** on the maintainer's machine. Assume:

| | |
|---|---|
| ❌ **No network to central-bank sites** | Previous cloud sessions got 93-byte 403s from the egress proxy and `ERR_CERT_AUTHORITY_INVALID` for Playwright. Do not plan around fetching a CB page. |
| ❌ **No display** | The NBP fix depends on *headed* Chromium (`PLAYWRIGHT_HEADLESS=0`). Headless gets an Incapsula challenge. Anything WAF-related is off the table. |
| ❌ **No API keys** | No scoring, no bake-off, no `scripts/llm_calendar_check.py`. |
| ❌ **Do not run `scripts/update.py`** | It hard-exits outside `.venv`, needs Playwright and keys, and writes the production parquets. |
| ✅ **Full repo, git history, test suite** | Everything below is verifiable with `pytest` alone. |
| ✅ **Real captured pages** | `tests/fixtures/calendars/` — committed today precisely so this work needs no network. |

### Three rules that will cost real data if broken

1. **Never touch `data/scored/*.parquet`.** They are 39 MB binaries the daily
   job rewrites, and a binary merge conflict is unrecoverable. Run
   `git status --porcelain data/` before every commit and stop if anything
   under `data/scored/` appears. This rules out **B7** (stray `gemini_thinking`
   rows) entirely — leave it for the computer.
2. **Nothing testable goes in `scripts/`.** `scripts/update.py` hard-exits at
   import outside `.venv`, so a test importing it passes locally and takes CI
   down at *collection* (this happened on run 19). Pure logic belongs in
   `src/` — that is what `src/pipeline_health.py` is for.
   `tests/test_scraper_contract.py::test_no_test_imports_a_venv_guarded_script`
   enforces it.
3. **Never delete a date from `data/calendars/forward_dates.json` to fix it.**
   `_merge_dates` is append/upgrade-only, so a working fetcher re-adds it next
   month. Fix the *fetcher*. (Deleting is only correct when the fetcher provably
   cannot produce it — that is why the two NBP rows could be removed today.)

### Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.lock     # the lock, not requirements.txt
.venv/bin/python -m pytest tests/ -m "not network"   # expect 336 passed, 1 skipped
.venv/bin/ruff check src/ scripts/ tests/            # 78 pre-existing findings (I4)
```

No `playwright install` needed — nothing here drives a browser.

---

## 2. Start here: D9 — six dead calendar parsers

**This is the highest-value work available and it is fully unblocked.**

`refresh_calendars.py` has 10 auto-fetchers. Six parse **zero** dates from
pages that return HTTP 200 with real content, and BOE returns 1 date for a CB
with ~8 meetings a year:

| Fetcher | Page bytes | Dates parsed | Expected |
|---|---|---|---|
| FED | 164 KB | **0** | ~8/yr |
| ECB | 106 KB | **0** | ~8/yr, **page includes 2027** |
| RBA | 23 KB | **0** | ~8/yr |
| BOT | 173 KB | **0** | ~6/yr |
| BOI | 118 KB | **0** | ~8/yr |
| CBRT | 32 KB | **0** | ~8/yr, **page includes 2027** |
| BOE | 78 KB | **1** | ~8/yr |

The pages changed shape and the regexes stopped matching. Nothing detected it,
because every fetcher swallows its exception, returns `[]`, and the run logs
`no dates returned — page may have changed` at WARNING and still **exits 0**.

Why it matters: the calendar drives the missing-meeting check *and* the WAF
probe fallback that recovered NBP, SNB and BCR. It also cannot extend — which
is the real cause of **D5**, the horizon frozen at 2026-12-23. **The ECB and
CBRT fixtures already contain 2027 dates, so fixing those two parsers is what
actually moves D5.**

### Everything you need is committed

- `tests/fixtures/calendars/*.html` — the real unmodified pages.
- `tests/fixtures/calendars/DATES_SEEN.md` — date strings visible in each page.
  These are **raw regex matches, not verified meeting dates**: several pages
  list press-conference and minutes dates next to decision dates. Confirm
  against the fixture before asserting.
- **A worked example of exactly this fix**, done today for NBP:
  - `scripts/refresh_calendars.py::parse_nbp_schedule` — parsing split out from
    fetching so it is testable with no network. Copy this shape.
  - `tests/test_calendar_fetchers.py` — the test style, including asserting the
    specific wrong dates are *not* produced.
  - Commit `9f5f1e1` for the reasoning.

### Suggested approach per fetcher

1. Open the fixture, find the real structure (NBP's turned out to be a table
   whose year lived in an `<h2>` above it, not text in one tag).
2. Split parsing into `parse_<cb>_schedule(html, today=None)` so it is testable.
3. Write tests against the fixture asserting the full expected list, not a count.
4. Leave the network-facing `fetch_<cb>()` a thin wrapper.
5. **Do not edit `data/calendars/forward_dates.json`.** Adding correct dates is
   the computer's job — it needs a live run to confirm the parser works against
   the real page, not just the snapshot. Note in your commit which dates the
   fixed parser produces so that run can be checked against it.

Watch for: dates already past (filter on `today`), non-decision meetings (NBP
marks a one-day meeting with `*`; CBRT and ECB list press conferences), and
two-day meetings where the **end** date is the decision (NBP dates its own
release "held on 1-2 June 2026" → `2026-06-02`).

---

## 3. Also safe from here

Roughly in value order. All verifiable with the test suite.

- **D10 — make `refresh_calendars.py` able to fail.** Right now a monthly job
  that silently stopped refreshing is indistinguishable from one where nothing
  changed. Give it a real exit code and a summary (e.g. non-zero when a fetcher
  that previously returned dates now returns none). Note `check_calendar_health.py`
  validates the stored *file*, not whether the refresh worked — it reported
  "All active CBs have adequate forward coverage" while six fetchers were dead.
  Pure logic; put it in `src/` with tests.
- **B5 — `rbnz.py:187` catches only `RuntimeError`**, so a Playwright timeout
  bypasses the Wayback fallback entirely; the fallback is unreachable for the
  most likely failure. Small fix, worth a test.
- **B6 — `fed.py:92-93,108-113` illusory redundancy.** `skip_historical` is
  always True on daily runs, so three discovery strategies collapse to one page
  inside a swallowing `try/except`. Same *shape* as D9: something that looks
  redundant but isn't. Diagnosis and a written-up plan are useful even if the
  fix wants live verification.
- **B2/B3 — `methodology.json` drift.** Not in the daily workflow, so it drifts
  indefinitely; its input CSV was deleted so it takes a skip branch and ships
  figures from a removed notebook. The CSV is recoverable from git at `b139b91^`
  — available offline.
- **B8 — dead artefacts.** `snapshot.json` is built every run and never fetched;
  `v.json` is written and never read (`app.js` cache-busts with `Date.now()`).
- **B9 — `python-bcb` and `scikit-learn`** are declared but unused. If you drop
  them, regenerate the lock: `uv pip compile requirements.txt --universal -o requirements.lock`
  (a contract test asserts the lock covers every declared dependency).
- **I4 — 78 ruff findings.** CI lint is `continue-on-error`, so this is safe
  chipping. Many are `B904` (`raise ... from err`). Keep it mechanical and
  separate from behaviour changes.

### Do not attempt from the phone

**I7 (BCR)**, any scraper fix needing a live page, anything under
`data/scored/`, the bake-off or the FED charset backfill (both cost money and
need the maintainer's explicit go-ahead), and **D2** — the maintainer decided
today to leave the three divergent ensemble definitions documented rather than
reconciled, because fixing it moves published numbers.

---

## 4. Before you finish

- `.venv/bin/python -m pytest tests/ -m "not network"` and
  `.venv/bin/ruff check src/ scripts/ tests/` (don't add to the 78).
- `git status --porcelain data/` — must show nothing under `data/scored/`.
- **Check CI's actual conclusion after pushing, not just the local suite.** This
  repo's CI once ran zero tests for twelve consecutive runs while local was
  green, and a test broke collection today for the same family of reason. Green
  locally is not green in CI.
- Add anything you find to `BACKLOG.md` immediately, even unfixed, and move
  fixed items to *Fixed this cycle* with a line on **why it mattered**.
- Leave a short note here or in `BACKLOG.md` saying which fetchers you fixed and
  what dates they now produce, so the computer session can verify them against
  the live pages.

---

## 5. State as of this handoff

- `main` @ `2434538`, CI run 22 green, **336 passed, 1 skipped**, ruff 78.
- Pipeline **22 of 23 CBs current**, zero missing meetings. NBP and SNB were
  recovered today (108 and 156 days stale). **BCR is the only stale one** and is
  hard-blocked by a ShieldSquare CAPTCHA — I7, needs a maintainer decision.
- The Claude scorer had been failing on *every* call (`anthropic` 1.0.0 removed
  `temperature`); fixed, and everything now installs from `requirements.lock`.
- The daily job runs 06:00 UTC. Expect it to report **NBP discovery failing** —
  that is correct, headless can't clear Incapsula, and NBP's data is already
  backfilled. The public site updates from that run, not from a local push.

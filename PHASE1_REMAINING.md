# Phase 1 — What's Done, What Remains

Status as of **2026-08-21**. Companion to `docs/SCRAPERS.md` (guarantees) and
`docs/RUNBOOK.md` (day-to-day operations).

> For the full standing list of open bugs and outstanding work across the whole
> project, see **[`docs/BACKLOG.md`](BACKLOG.md)**. This file covers Phase 1 only.

---

## Read this first: the pipeline is healthier than the matrix implies

`docs/SCRAPERS.md` classifies scrapers by **resilience posture** — what would
happen *if* a site redesigned. That is not a list of current failures. Twelve
CBs are marked "Manual fix required"; **all twelve are working today.**

**Actual production state:** the daily job is running and succeeding.
**20 of 23 central banks are current.** Three had gaps; two are now fixed.

| CB | Missed meetings | Days stale | Cause | Status |
|---|---|---|---|---|
| **NBP** | 2026-06-10, 2026-07-08 | 107 | Incapsula blocks GitHub Actions IP ranges | Needs a residential IP → **R3/R4** |
| **SNB** | 2026-06-18 | 155 | **Auto-blocked** 2026-07-05 — not a scraper fault | **Fixed** (unblocked + guard) |
| **BCR** | 2026-07-10 | 51 | **Auto-blocked** 2026-07-12 — not a scraper fault | **Fixed** (unblocked + guard) |

### The SNB/BCR root cause — corrected

An earlier version of this document said both needed live scraper diagnosis.
That was wrong. Both statements had been **permanently auto-blocked**:

```
SNB_MPC_STATEMENT_20260618   blocked 2026-07-05
BCR_RATE_DECISION_20260710   blocked 2026-07-12
```

A blocked `statement_id` is rejected by `validate_new_statement` *before* any
scraper improvement can take effect, so fixing `snb.py` or `bcr.py` could never
have recovered them — the scrapers may have been working the whole time.
`blocked_ids.json` grew from 33 entries on 2026-06-18 to 43, and two sat on
dates the official calendar lists as meetings.

Fixed three ways: a calendar-listed meeting can no longer be auto-blocked at
all (estimated dates included — SNB 2026-06-18 was `confirmed: false`); both
IDs are unblocked; and a test asserts no blocked ID ever lands on a scheduled
meeting. Expect both to refetch on the next daily run without intervention.

A related calendar bug surfaced once the real blocks cleared: **BOK 2026-06-28
is a Sunday marked `confirmed: true`**, which produced a false missing-meeting
report. Scheduled decisions never fall on a weekend, so the gap check now
ignores weekend entries and `check_calendar_health.py` reports them as errors.

Two related notes:

- **MNB is a false positive.** The gap check flags 2026-08-05, but that is a
  *Wednesday* — MNB rate decisions are the 4th *Tuesday* (2026-07-21 stored,
  next 2026-08-25). Non-decision Council meetings pollute the calendar, and the
  monthly refresh keeps re-adding them. Fixed at source in **R5**.
- **Claude scoring errored once** on 2026-08-21 (`errors.claude: 1`,
  `scored.claude: 0`). Below the alert threshold of 3, but new — watch it.

### Why these were not caught sooner

Before this work, `fetch_cb` returned `(0, 0)` both when a CB had published
nothing new — the normal daily outcome for 22 of 23 CBs — and when its scraper
was completely dead. The only alarm was a `1.5 × TYPICAL_INTERVAL_DAYS` clock:
**136 days for SNB**, which is exactly why SNB sat broken since June. That is
now fixed; detection is ~3 days for every CB.

---

## Done and merged

| # | Item | Effect |
|---|---|---|
| 1.1 | Per-CB discovery counter, `SCRAPER_FAILURE_*` alerts | Detection **45–136 days → ~3 days** |
| 1.1 | Three latent alerting bugs | `alert.py` now runs on failed runs; empty CBs can alert; partial model failures counted |
| 1.2 | `BaseScraper.probe_from_calendar()` | Structure-independent discovery fallback, adopted by NBP/BCR/SNB |
| 1.2 | Calendar-anchored gap check + coverage warning | Flags missing meetings directly; warns before the calendar runs dry |
| 1.5 | `src/scrapers/utils.py`, HTTP retry/backoff/session | One place to add resilience instead of 8–16 |
| 1.6 | 205 tests + CI gate on push/PR | First test suite in the repo |
| — | Generated staleness matrix | `docs/SCRAPERS.md` |

---

## Remaining — needs your machine

This container cannot reach any central-bank website (the egress proxy returns
93-byte 403s and Playwright fails TLS verification), so these cannot be
completed or verified here. All commands assume the setup in `docs/RUNBOOK.md`.

### R1 — SNB: verify the unblock worked *(probably no longer needed)*

SNB's real cause was the auto-block, now cleared, so the next daily run should
refetch it unaided. Run this **only if** it is still stale afterwards — the
`_DOWNLOAD_STUB` detection and broadened PDF-link matching are already deployed,
so this command distinguishes the remaining possibilities:

```bash
.venv/bin/python -c "
from src.scrapers.snb import SNBScraper
s = SNBScraper()
refs = s.discover_urls()
print('discovered:', len(refs))
print('June 2026 :', [r.url for r in refs if r.meeting_date.year==2026 and r.meeting_date.month==6])
t = s.fetch_text('https://www.snb.ch/en/publications/communication/press-releases/pre_20260618')
print('chars:', len(t))
print(t[:800])
"
```

| What you see | Cause | Fix |
|---|---|---|
| `discovered: 0` | listing page shape changed | repair `_PRESS_RELEASE_PATH` / pagination |
| discovered > 0 but June absent | URL slug is not `pre_YYYYMMDD` | fix `_probe_urls` |
| text is short / says "Download file now" | PDF link is JS-injected | add `snb` to `PLAYWRIGHT_CBS` |
| text looks correct | fixed already; just needs a backfill run | run R3 |

Also useful — dump the raw page so the PDF link can be inspected directly:

```bash
.venv/bin/python -c "
import requests
from config.settings import REQUEST_HEADERS
r = requests.get('https://www.snb.ch/en/publications/communication/press-releases/pre_20260618', headers=REQUEST_HEADERS, timeout=30)
print('status', r.status_code, 'len', len(r.text))
import re; print('pdf links:', re.findall(r'href=\"([^\"]*\.pdf[^\"]*)\"', r.text)[:10])
"
```

### R2 — BCR: verify the unblock worked *(probably no longer needed)*

Same story as SNB — the block was the cause and is cleared. Run only if
BCR is still stale after the next daily run:

```bash
.venv/bin/python scripts/update.py --dry-run --cb bcr --since 2026-06-01
```

Look for `BCR calendar probe: found …` versus `BCR calendar probe MISS`. Note
BCR's calendar is **0/7 confirmed** — every date is an estimate — so the probe
may be looking on the wrong day. Cross-check the real date at
<https://www.banrep.gov.co/es/calendario-junta-directiva> and, while you are
there, transcribe the confirmed 2026 dates into
`data/calendars/forward_dates.json` (set `"confirmed": true`).

### R3 — Backfill the three gaps

For NBP this doubles as the WAF test: a residential IP should sail through
Incapsula where GitHub's runners are blocked.

```bash
.venv/bin/python scripts/update.py --cb nbp --since 2026-06-01
.venv/bin/python scripts/update.py --cb bcr --since 2026-06-01
.venv/bin/python scripts/update.py --cb snb --since 2026-06-01

git add data/ docs/data/ logs/
git commit -m "Local backfill: NBP, BCR, SNB"
git push
```

Confirm afterwards:

```bash
.venv/bin/python scripts/staleness_matrix.py | head -20
```

### R4 — Self-hosted runner (the durable NBP fix)

Only worth doing once R3 confirms your IP bypasses the WAF. Setup steps are in
`docs/RUNBOOK.md`. The workflow change adds a second job pinned to
`runs-on: [self-hosted]` for `nbp`, `bcr`, `bcch`, `boi`, leaving the other 19
on hosted runners, with an alert if the runner is offline rather than a silent
skip.

---

## Remaining — no network needed (I can do these)

| # | Item | Why |
|---|---|---|
| **R5** | Filter non-Tuesday dates in the MNB fetcher in `refresh_calendars.py` | Monthly refresh keeps re-adding non-decision meetings; recurring false positive |
| **R6** | Add a live-status column to the staleness matrix | So resilience posture is never misread as breakage |
| **R7** | Re-land Phase 1 as a branch cut from current `main` | See the git note below |
| **R8** | Capture HTML/PDF fixtures per CB + parser regression tests | Prerequisite for R9 — makes selector changes testable offline |
| **R9** | Harden the 12 single-path scrapers | Only sensible after R8; changing selectors blind is worse than leaving them detected-but-manual |

---

## Git note — do not `git merge` the hardening branch

`origin/main` and `claude/cbrt-llm-meeting-dates-CdG0a` have **unrelated roots**
(`f66a7c2b` vs `fd837a76`); the remote history was rebuilt at some point and
`git merge-base` returns nothing.

- **Content is compatible** — every code file the branch touches is
  byte-identical between its base and current `main`, and the full Phase 1
  patch `git apply --check`s cleanly against `origin/main` (verified).
- Merging directly would join unrelated histories *and* drag June-18 parquet
  and `docs/data/` files over two months of newer production data.
- The safe path is a fresh branch cut from `origin/main` with the patch applied
  — that is **R7**.

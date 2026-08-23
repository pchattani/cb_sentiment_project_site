# Runbook

Day-to-day operation of the CB sentiment pipeline: local setup, what the daily
job does, how to triage each alert, and how to recover.

See also: `docs/SCRAPERS.md` (per-CB guarantees) and `docs/PHASE1_REMAINING.md`
(current known gaps and the work still outstanding).

---

## Local setup

```bash
git clone git@github.com:pchattani/cb_sentiment_project.git
cd cb_sentiment_project

python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
.venv/bin/playwright install chromium      # 8 scrapers need a browser

cp .env.example .env
# then fill in:
#   ANTHROPIC_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY
```

`scripts/update.py` refuses to run outside `.venv` — that guard is deliberate,
so a system-Python invocation cannot half-install dependencies mid-run.

Quick check that the environment is sound (no network, no API keys needed):

```bash
.venv/bin/python -m pytest tests/ -q          # 205 tests, ~1s
.venv/bin/python scripts/staleness_matrix.py  # per-CB guarantees
.venv/bin/python scripts/check_calendar_health.py
```

---

## The daily job

`.github/workflows/daily_update.yml`, cron `0 6 * * *` (06:00 UTC). GitHub
frequently delays scheduled runs by minutes to hours; that is normal and is why
several CBs are fetched a run late (BOE publishes ~12:00 UTC, CNB ~12:30).

| Step | Script | Notes |
|---|---|---|
| 1 | `scripts/update.py` | discover → fetch → score (3 models in parallel) → recompute ensemble |
| 2 | `scripts/build_site.py` | rebuild `docs/data/*.json` |
| 3 | `scripts/alert.py` | open GitHub issues (`if: always()`) |
| 4 | commit | parquets + `docs/data/` + `logs/last_run.json` (`if: always()`) |
| 5 | deploy | rsync `docs/` → the public site repo |

Steps 3 and 4 run with `if: always()` on purpose: `update.py` exits 1 on the
cost guard, and previously that meant the runs most in need of an alert sent
none, and the alert-dedupe state was never persisted.

**Manual run:** Actions → *Daily Update* → *Run workflow*.

### Useful local invocations

```bash
.venv/bin/python scripts/update.py                          # all CBs, 60-day window
.venv/bin/python scripts/update.py --cb snb                 # one CB
.venv/bin/python scripts/update.py --dry-run --cb snb       # discover only, no writes, no spend
.venv/bin/python scripts/update.py --cb nbp --since 2026-06-01
.venv/bin/python scripts/update.py --full                   # full history (bootstrapping only)
```

`--dry-run` is the right first move for any investigation: it performs discovery
and prints what *would* be fetched without writing or calling a scoring model.

---

## Reading `logs/last_run.json`

The single source of truth for pipeline health.

| Field | Meaning |
|---|---|
| `per_cb.<CB>.discovered` | refs from `discover_urls()` **before** date windowing — the health signal |
| `per_cb.<CB>.baseline` | best discovery count ever seen; only ratchets up on healthy runs |
| `per_cb.<CB>.collapsed` | discovery fell below half the baseline |
| `consecutive_scraper_failures` | per-CB run counter; alerts at 3 |
| `consecutive_model_failures` | per-model run counter; alerts at 3 |
| `missing_meetings` | confirmed calendar meetings with no stored statement |
| `date_mismatches` | calendar date disagrees with stored date — hygiene, not an outage |
| `calendar_coverage_low` | CBs running out of future meeting dates |
| `stale_cbs` | interval-clock backstop |
| `active_alerts` | dedupe state — an ID here means the issue is already open |

**Key intuition:** `discovered` counts a scraper's whole back-catalogue, so a
healthy scraper reports a large number every day even when nothing new was
published. `fetched: 0` is normal. `discovered: 0` is not.

---

## Alert triage

### `SCRAPER_FAILURE_{CB}` — discovery returned nothing for 3 runs

The scraper is broken; the CB is not merely quiet.

```bash
.venv/bin/python scripts/update.py --dry-run --cb <cb> --since 2026-01-01
```

Check in order: site redesign (selectors / URL patterns), WAF blocking the
runner IP, listing moved or paginated differently. If the CB is one of the four
WAF-exposed ones (NBP, BCR, BCCH, BOI), run the same command locally — a
residential IP usually succeeds where a hosted runner does not.

### `MISSING_MEETING_{CB}_{date}` — a confirmed meeting produced no statement

1. Did the meeting actually produce a rate decision? Several scheduled meetings
   are non-decision sessions. If so, **remove the date from the calendar** —
   this is what BCR 2026-05-29 and the MNB Wednesday entries were.
2. Is it published but not discovered? `--dry-run --cb <cb>`.
3. Is the site blocking the runner?

### `STALENESS_{CB}` — interval backstop

The slow signal (45–136 days). If this fires *without* a scraper-failure or
missing-meeting alert, the CB has genuinely not met — check its calendar before
assuming breakage.

### `MODEL_FAILURE_{model}` — 3 consecutive scoring failures

Check API key validity, quota, and recent API changes. A model counts as failed
when errors outnumber successes, so a partial outage now registers.

### `CALENDAR_COVERAGE_LOW` — forward calendar running out

This one is insidious: when the calendar runs dry the probe fallback and the
missing-meeting check both become **silent no-ops**.

```bash
.venv/bin/python scripts/refresh_calendars.py
.venv/bin/python scripts/check_calendar_health.py
```

Only 10 of 24 CBs auto-refresh. The rest are listed in `_MANUAL_REFRESH` in
`scripts/refresh_calendars.py` and must be transcribed from the CB's own site.

---

## Common operations

### Backfill a CB after fixing it

```bash
.venv/bin/python scripts/update.py --cb <cb> --since 2026-06-01
git add data/ docs/data/ logs/ && git commit -m "Backfill <cb>" && git push
```

The daily job commits the same paths, so pull before starting to avoid a
conflict on the parquets.

### Blocklist (`data/blocked_ids.json`)

Statements permanently excluded from scoring. `update.py` adds IDs
automatically when content matches a *permanent* garbage pattern, or when the
LLM gatekeeper classifies it as non-policy **and** the text is ≥300 chars
**and** the meeting is not within the last day.

Those guards exist because pre-publication stubs used to get blocked forever.
If a statement is wrongly blocked, remove the ID and re-run for that CB.

> The daily job commits this file. A git merge that reverts it silently
> re-blocks statements — this has happened before. After editing, confirm the
> pushed version matches what you intended.

### Cost guard

`COST_GUARD_MAX = 20`. If a run discovers more than 20 new statements it halts
before scoring and exits 1, on the assumption that a scraper has gone haywire.
For an intentional large batch use `--full` or `--since` locally.

### Calendar maintenance

```bash
.venv/bin/python scripts/refresh_calendars.py       # auto-refresh the 10 supported CBs
.venv/bin/python scripts/check_calendar_health.py   # coverage, staleness, % confirmed
```

`_merge_dates` is **append/upgrade-only** — it never deletes. A wrong estimated
date persists until removed by hand, and a fetcher that re-adds a bad date will
keep doing so. Fix recurring pollution in the fetcher, not the data file.

### Evaluating a new model release

When a provider ships a new build, or you want to weigh up a new candidate:

```bash
# The sample is already drawn and committed. Only redraw if you accept
# losing comparability with every earlier scorecard.
.venv/bin/python scripts/model_bakeoff.py score --models claude,gemini,deepseek
.venv/bin/python scripts/model_bakeoff.py score --models openai --replicates 2
.venv/bin/python scripts/model_bakeoff.py report --candidate openai
```

- **It cannot move a published number.** Everything is written under
  `data/bakeoff/`, never to the production parquets.
- **It costs money.** Roughly $2–4 for 200 statements across four models. A
  pre-flight estimate is printed and `--max-cost` (default $5) blocks anything
  larger without `--yes`.
- **It is resumable.** Kill it and re-run; already-scored cells are skipped.
- `--replicates 2` is what enables the test–retest measurement. Without it the
  verdict reports stability as *unmeasured* and refuses to pass the candidate.

Add a candidate by adding a `MODEL_REGISTRY` entry in `config/settings.py` with
`in_ensemble=False`. That makes it reachable by name without any risk to the
daily job. Full metric definitions are in
[`METHODOLOGY.md`](METHODOLOGY.md#the-bake-off-deciding-on-a-new-model-release).

---

## Self-hosted runner (for WAF-blocked CBs)

NBP, BCR, BCCH and BOI sit behind Incapsula/ShieldSquare, which block GitHub's
datacenter IP ranges. A runner on a residential connection removes the problem
for all four at once, with no recurring cost.

1. Repo → Settings → Actions → Runners → **New self-hosted runner**; follow the
   platform instructions.
2. Install it as a service so it survives reboot
   (`./svc.sh install && ./svc.sh start`).
3. Provide the same secrets the hosted job uses.
4. Confirm it appears **Idle** in the runners list.

The workflow then routes only the WAF-sensitive CBs to it and alerts — rather
than silently skipping — if the runner is offline.

**Interim workaround without a runner:** run the four locally when they go
stale (`--cb nbp --since …`) and push. The alerts will tell you when.

---

## Repository layout

Two repos, deliberately split:

- **`cb_sentiment_project` (private)** — all code, all data, the workflow and
  its secrets, plus `docs/` (the built dashboard).
- **`cb_sentiment_project_site` (public)** — a `--delete` rsync mirror of
  `docs/`, served by GitHub Pages.

Never edit the public repo directly; the next daily run overwrites it. Pages is
free only on public repos, which is why the split exists: the engine, raw
corpus and keys stay private while the dashboard is published.

```
config/settings.py      URLs, model IDs, thresholds, PLAYWRIGHT_CBS
src/scrapers/           one module per CB + base.py (contract, probe) + utils.py
src/scoring/            claude / gemini / deepseek scorers + shared prompt
src/storage/            parquet read/write + ensemble computation
src/pipeline_health.py  discovery health, staleness, calendar checks
scripts/update.py       the daily job
scripts/alert.py        GitHub issue alerting
scripts/build_site.py   docs/data/*.json for the dashboard
tests/                  205 offline tests
```

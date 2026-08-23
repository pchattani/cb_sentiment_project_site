# Architecture

How a central-bank statement gets from a website to the published dashboard.

```
   CB websites
        │  discover_urls() → StatementRef[]        src/scrapers/*.py
        │  fetch_text(url) → str
        ▼
   validate → statements.parquet                   src/storage/parquet_store.py
        │
        │  3 LLMs in parallel, sentence by sentence  src/scoring/*.py
        ▼
   sentences.parquet + model_scores.parquet
        │
        │  sentence-level ensemble                 compute_ensemble_scores()
        ▼
   statements.doc_score
        │
        │  scripts/build_site.py
        ▼
   docs/data/*.json ──rsync --delete──▶ public repo ──▶ GitHub Pages
```

The whole thing is driven by `scripts/update.py`, run daily by
`.github/workflows/daily_update.yml`.

---

## 1. Discovery and fetch

### The scraper contract

Every central bank is one module in `src/scrapers/`, subclassing `BaseScraper`
(`src/scrapers/base.py`) and implementing exactly two methods:

```python
discover_urls() -> list[StatementRef]   # what statements exist and where
fetch_text(url) -> str                  # clean plain text for one of them
```

A `StatementRef` carries `cb`, `doc_type`, `meeting_date`, `url`, and derives:

```python
statement_id = f"{cb}_{doc_type}_{meeting_date:%Y%m%d}"   # e.g. FED_FOMC_STATEMENT_20260729
```

That ID is the primary key for everything downstream — dedupe, blocking, and
all three parquet files key off it.

`BaseScraper` also provides:

| Member | Purpose |
|---|---|
| `_get(url)` | GET with polite delay, connection reuse, and bounded retry with backoff on transient statuses. 4xx are **not** retried — they are structural, and retrying only delays the health signal. |
| `calendar_dates(...)` | This CB's known meeting dates from `data/calendars/forward_dates.json`. |
| `probe_from_calendar(...)` | The universal discovery fallback — see below. |
| `_since_date` | The daily window hint, so scrapers can skip out-of-range pages. |

### The calendar probe

The one discovery mechanism that does not depend on a site's HTML. It builds
statement URLs from the official meeting date and fetches them with plain
`requests`, so it survives both a site redesign and the WAFs that block
headless browsers from CI. Pluggable per CB:

```python
self.probe_from_calendar(
    refs,
    url_builder=...,          # date -> candidate URLs, tried in order
    validator=...,            # response -> is this really the statement?
    key_fn=...,               # date -> dedupe key (BCR dedupes by month)
    date_from_response=...,   # page date wins over an estimated calendar date
    url_rewrite=...,          # canonicalise before storing (BCR /en/ -> /es/)
)
```

It returns a `CalendarProbeReport`. A **miss** — the calendar says a meeting
happened, the date has passed, no URL resolves — is the strongest breakage
evidence in the pipeline. Adopted by NBP, BCR and SNB; see
[`SCRAPERS.md`](SCRAPERS.md) for which CBs have what.

### Transport

Most scrapers use plain `requests`. Eight need a browser and are listed in
`PLAYWRIGHT_CBS` (`config/settings.py`); `update.py` runs their
`discover_urls()` and `fetch_text()` inside a `ThreadPoolExecutor`, because the
Playwright sync API cannot run in a thread that already has an asyncio event
loop — and `google-genai` installs one on import. Two CBs (BCB, NorgesBank) use
JSON APIs; RBI posts ASP.NET `__VIEWSTATE`.

### Validation gate

Before anything is stored, `validate_new_statement()` in `scripts/update.py`
applies five checks: the blocklist, future dates, duplicate meeting slots,
garbage-content patterns, and an LLM classifier that asks whether the text is
really a rate decision.

Rejections split into transient and permanent. Only permanent ones add the ID
to `data/blocked_ids.json`, and **never** when the meeting is in the last day
or appears on the official calendar — a blocked ID is rejected before any
future scraper fix can matter, so a wrong block is permanent data loss.

---

## 2. Scoring

Scorers live in `src/scoring/`, all sharing one prompt (`prompt.py`) and one
interface (`base.py`):

```python
score_statement(text, statement_id) -> StatementScore
    .doc_score      float | None      # mean of non-null sentence scores
    .n_sentences    int
    .n_scored       int
    .sentences      list[SentenceScore]   # idx, text, score, reasoning
```

A concrete scorer supplies **only its transport**: chunking thresholds, an
`_invoke()` that makes one raw API call, and optionally an `_is_transient()`
naming which provider errors are worth retrying. Chunking, parse-retry, the
JSON repair chain and doc-score aggregation all live in `BaseScorer`, so they
behave identically for every model. They were previously duplicated per scorer
and had drifted apart in ways that changed the data — see the B4 entry in
[`BACKLOG.md`](BACKLOG.md).

Chunk thresholds stay per-model because output limits differ sharply:
DeepSeek's 8192-token cap and Gemini's early truncation force much smaller
chunks than Claude needs.

### Model registry

`MODEL_REGISTRY` in `config/settings.py` is the single source of truth for
which models exist and which ones publish. Each entry carries the stable
`name` (the value written to the `model` column — never change it once rows
exist), the provider `model_id` (recorded as `model_version`), and
`in_ensemble`. `ENSEMBLE_MODELS` and the scoring worker count are both derived
from it; `src/scoring/registry.get_scorer(name)` resolves a name to an
instance.

Scorer classes are referenced by dotted path and imported on **first use, never
at import time**. That is load-bearing: importing google-genai installs an
asyncio event loop on the calling thread, and the Playwright sync API refuses
to run on a thread that has one, so an eager import here would break all eight
Playwright scrapers in the fetch phase. A test asserts the laziness holds.

Adding a bake-off candidate means adding a registry entry with
`in_ensemble=False` — it becomes reachable by name without touching the
published pipeline. `openai` is currently the only such entry.

Scoring is idempotent: `scored_by_model()` skips statements already done, so a
re-run costs nothing. A cost guard (`COST_GUARD_MAX = 20`) halts the run if an
unexpectedly large batch appears.

See [`METHODOLOGY.md`](METHODOLOGY.md) for the scale and the ensemble formula.

---

## 3. Storage

Three parquet files under `data/scored/`, all written through
`src/storage/parquet_store.py` under a `FileLock`.

**`statements.parquet`** — one row per statement, and the published series.

```
statement_id  cb  doc_type  meeting_date  url  raw_text
doc_score  n_sentences  n_scored  scraped_at  scored_at  model
```

`doc_score` holds the **ensemble**, and `model` is the literal `"ensemble"`
once computed.

**`sentences.parquet`** (~39 MB) — one row per sentence per model.

```
statement_id  model  sentence_idx  text  score  reasoning
```

`score` is `NaN` where a model judged the sentence to carry no policy signal.
`reasoning` is parsed if present but the prompt never asks for it, so it is
effectively always empty.

**`model_scores.parquet`** — one row per (statement, model).

```
statement_id  model  doc_score  n_sentences  n_scored  scored_at
```

> **No version dimension.** There is no `model_version`, `prompt_version` or
> `ensemble_version` column. Writes are destructive by `(statement_id, model)`,
> and `compute_ensemble_scores()` overwrites `doc_score` in place, so
> re-scoring with a newer model silently rewrites history. Addressing this is
> the first task of the model-upgrade work.

---

## 4. Publication

`scripts/build_site.py` renders `docs/data/*.json`. Most values are
pre-serialised Plotly figure dicts — the frontend calls `Plotly.react()` and
never builds traces itself.

| File | Contents |
|---|---|
| `global.json` | Cross-CB aggregates, coverage, CB metadata and groupings |
| `group_*.json` | 8 partitions (all/dm/em + 5 regions) × 12 charts |
| `cb_{CB}.json` | Per-CB charts, plus `scores`: `{date, claude, gemini, deepseek, ensemble}` |
| `cb_sentences_{CB}.json` | Per-meeting sentence rows: `{text, claude, gemini, deepseek, ens}` |
| `results.json` | PCA and inter-model agreement |
| `stats.json` | Descriptive statistics |
| `calendar.json` | Per-CB last decision, status, next meeting |

`cb_sentences_*.json` is ~45 MB of the ~46 MB total — the full statement corpus
republished sentence by sentence. `raw_text` itself is never published.

The frontend (`docs/index.html` + `docs/assets/app.js`) is vanilla JS with no
build step: Bootstrap and Plotly from CDN, tabs that lazy-load their JSON on
first click and cache it.

### Deploy

Step 10 of the workflow clones the public site repo, `rsync -av --delete`s
`docs/` into it, and pushes. One-directional: the private repo is always the
source of truth, and anything edited in the public repo is overwritten on the
next run.

---

## 5. Health and alerting

`src/pipeline_health.py` holds the pure signal logic — deliberately in `src/`
rather than `scripts/`, because `update.py` hard-exits at import time outside
the venv and so cannot be imported by tests.

| Function | Signal |
|---|---|
| `compute_scraper_health` | Per-CB discovery counter and collapse-vs-baseline |
| `compute_calendar_staleness` | Confirmed meetings with no statement (and date mismatches) |
| `compute_calendar_coverage` | Warns before the forward calendar runs dry |
| `compute_staleness` | The interval-clock backstop |
| `is_scheduled_meeting` | Vetoes auto-blocking a real meeting |

Everything lands in `logs/last_run.json`; `scripts/alert.py` turns it into
GitHub issues, deduped through `active_alerts` in that same file.

---

## Adding a central bank

1. Subclass `BaseScraper`; implement `discover_urls()` and `fetch_text()`.
2. Declare `CB` and `DOC_TYPE`. `CB` **must** match the key in
   `forward_dates.json` — a contract test enforces this.
3. Register it in `_SCRAPERS` in `scripts/update.py`.
4. Add a `TYPICAL_INTERVAL_DAYS` entry, or it can never go stale.
5. Add it to `PLAYWRIGHT_CBS` if it needs a browser.
6. Add a calendar probe if the URL is derivable from the meeting date —
   `snb.py::_probe_urls` is the simplest example.
7. Prefer raising over returning `[]` on discovery failure.
8. `pytest tests/test_scraper_contract.py`.

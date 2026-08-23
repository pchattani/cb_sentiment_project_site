# Backlog & Known Issues

The standing register of everything outstanding and every known bug. This is
the canonical list — other docs link here rather than restating.

> Picking this work up fresh? Read **[`HANDOFF.md`](HANDOFF.md)** alongside
> this. It carries the ordering, the setup, and the traps; this file is the
> inventory.

**Last reviewed:** 2026-08-22 (local session) · **Pipeline:** running daily, **22 of 23 CBs current** — only BCR stale

Severity: **P1** breaks or silently corrupts data · **P2** degrades reliability
or correctness · **P3** cleanup, cosmetics, tech debt.

---

## Open bugs

| ID | Sev | Item | Evidence |
|---|---|---|---|
| ~~B1~~ | ~~P1~~ | ~~**Fed scraper charset bug**~~ — **fixed forward**; see *Fixed this cycle*. The 54 already-stored statements remain corrupted until backfilled (spend decision, below). | Measured over `statements.parquet` with `[âÃ][\x80-\x9f]` |
| B2 | P2 | **`build_methodology_data.py` is not in the daily workflow**, so `methodology.json` drifts from the data indefinitely. | `daily_update.yml` step list |
| B3 | P2 | Its input `notebooks/scale_analysis_results.csv` was deleted, so it takes a skip branch and ships pre-built figures from a removed notebook. Recoverable at `b139b91^`. | skip branch in that script |
| ~~B4~~ | ~~P2~~ | ~~**Gemini and DeepSeek do not retry JSON-parse failures on short statements.**~~ — **fixed**; every path now goes through `BaseScorer._call_and_parse`. See *Fixed this cycle*. | `gemini_scorer.py`, `deepseek_scorer.py` |
| B5 | P2 | **`rbnz.py` catches only `RuntimeError`**, so a Playwright timeout bypasses the Wayback fallback entirely — the fallback exists but is unreachable for the most likely failure. | `rbnz.py:187` |
| B6 | P2 | **`fed.py` has illusory redundancy.** `skip_historical` is always True on daily runs (60-day window), collapsing three discovery strategies to one page inside a swallowing `try/except`. | `fed.py:92-93, 108-113` |
| B7 | P3 | Stray `gemini_thinking` rows linger in `sentences.parquet` from a removed model variant. | parquet string dictionary |
| B8 | P3 | `snapshot.json` is built every run and never fetched; `v.json` is written and never read (`app.js` cache-busts with `Date.now()`). | `build_site.py`, `app.js:41` |
| B9 | P3 | Encoding aside, `python-bcb` and `scikit-learn` are declared in `requirements.txt` but unused. | `requirements.txt` |
| B10 | P2 | **BCR's listing discovery is dead and masked by the probe.** A full scan of 67 English pages plus the Spanish fallback returns **0 refs** (`BCR listing en/pg0..66: 0 dated + 0 deferred`); only the calendar probe finds anything. The CB therefore looks "self-healing" while one of its two paths is gone — the same illusory-redundancy shape as B6. Detection can't fire because the probe keeps discovery non-zero. | `update.py --cb bcr` run 2026-08-22 |

## Data quality

| ID | Sev | Item |
|---|---|---|
| ~~D1~~ | ~~P1~~ | ~~**No version dimension**~~ — **code fixed**; version fields are now part of the write key so a new model build appends rather than overwrites. ⚠️ **`scripts/migrate_add_versioning.py` must be run once on `main` after merge** — it was deliberately not run in-branch, because the daily job rewrites those 39 MB parquets and a binary merge conflict would be unrecoverable. The code tolerates unmigrated data, so ordering is safe either way. |
| D2 | P2 | **Three divergent "ensemble" definitions**: sentence-level mean in `parquet_store.compute_ensemble_scores` (the published series); mean-of-doc-scores in `build_methodology_data.py:126`; a third per-sentence recomputation in `build_site.py:1005-1009` that also drops sentences under 10 chars and so can disagree with `doc_score`. Documented in `METHODOLOGY.md`, deliberately unreconciled — **fixing it moves published numbers, so it needs a maintainer decision.** |
| D3 | P2 | **BOK 2026-06-28 is a Sunday** marked `confirmed: true`. The gap check now ignores weekend entries, but BOK is `_MANUAL_REFRESH` only so it will never self-correct — the bad row should be deleted. |
| D4 | P2 | **BCR calendar is 0 of 7 confirmed** — every date an estimate — while its WAF bypass probe depends on those dates, and the missing-meeting check cannot run for it at all. Fix: transcribe from <https://www.banrep.gov.co/es/calendario-junta-directiva>. |
| D5 | P2 | **Calendar horizon ends 2026-12-23.** From November, 15 CBs fall below two future meetings, at which point the probe fallback and gap check both become silent no-ops. `check_calendar_health.py` warns ahead of it. |
| D6 | P3 | 14 of 24 CBs are manual calendar refresh (`_MANUAL_REFRESH`); only 10 auto-refresh. |
| D9 | **P1** | **6 of the 10 auto-refresh calendar fetchers parse zero dates from healthy pages.** Measured 2026-08-22: **FED, ECB, RBA, BOT, BOI, CBRT** each fetch HTTP 200 with 23-174 KB of real content and return `[]`; **BOE** returns 1 date for a CB with ~8 meetings a year. Only CNB (3) and MNB (10) look right. This is the NBP bug (D8) at scale — the pages changed shape and the regex/selector never matched again. **The monthly refresh reports "no changes" and exits 0**, so it has looked healthy throughout. Consequences: the calendar cannot extend (this is the real cause of **D5**'s frozen 2026-12-23 horizon), wrong dates can never be corrected because `_merge_dates` is append/upgrade-only, and the missing-meeting check plus the WAF probe fallback both depend on this data. NBP is fixed and has a fixture + tests; the other six are not. | `refresh_calendars.py --dry-run`, 2026-08-22 |
| D10 | P2 | **`refresh_calendars.py` cannot fail.** Every fetcher swallows its own exception and returns `[]`, and an empty result is logged as `no dates returned — page may have changed` at WARNING while the run still exits 0. A monthly job that silently stops refreshing is indistinguishable from one where nothing changed. There is a `check_calendar_health.py`, but it validates the stored file, not whether the refresh actually worked — it reported "All active CBs have adequate forward coverage" while 6 fetchers were dead. |
| D8 | P2 | **NBP's 2026-06-10 calendar entry is wrong and marked `confirmed: true`.** NBP's own listing says that meeting was "held on 1-2 June 2026", and the backfill stored 2026-06-02. Every *other* 2026 NBP date matches the calendar exactly, so this is a bad row, not a scraper artifact. It now shows as an 8-day `date_mismatch`. **Do not just edit `forward_dates.json`** — `_merge_dates` is append/upgrade-only and the next monthly refresh re-adds it (trap 3.3); fix it in the fetcher. Left for a maintainer decision. |
| D7 | P3 | **Six** confirmed calendar dates disagree with stored meeting dates by 6–8 days (CBRT ×2, RBNZ, NorgesBank, BCCH, **NBP** — see D8). Reported as `date_mismatches`, not alerts. |

## Infrastructure & process

| ID | Sev | Item |
|---|---|---|
| I1 | **P1** | **`requirements.txt` is all floors with no lockfile**, re-resolved against PyPI latest on every daily run. **No longer hypothetical — this reached production:** `anthropic>=0.40.0` resolved to 1.0.0, which removed `temperature` from `messages.create()`, and every Claude call had been raising `TypeError` (surfaced as I3). `anthropic` is now pinned `>=1,<2`, but **every other dependency is still an unbounded floor** — `google-genai`, `openai`, `pandas`, `pyarrow` and `playwright` can each do the same thing tomorrow. A lockfile is the real fix. Raised to P1: it has demonstrated it can silently disable a scorer in production. |
| I2 | P2 | **Alert dedupe state lives in a git-committed file** (`active_alerts` in `logs/last_run.json`), so a revert re-opens closed issues. Live consequence: **BCR is open three times (#8, #11, #13)**, and **#5 CBRT / #6 BOI / #7 BCCH** are for CBs that are current today. |
| ~~I3~~ | ~~P2~~ | ~~**Claude scorer errored on the 2026-08-21 run**~~ — **fixed**; it was not flaky, it was total. Root cause was I1. See *Fixed this cycle*. |
| I4 | P3 | ~79 pre-existing `ruff` findings; the CI lint step is `continue-on-error` until that backlog clears. |
| I5 | P3 | **BOJ is excluded** from the pipeline (format inconsistency) but retains a scraper module and calendar entries. |
| I7 | **P1** | **BCR is hard-blocked by ShieldSquare/Radware and no current approach reaches it.** `banrep.gov.co` returns an 875-byte Spanish CAPTCHA page citing *network reputation* ("comportamiento anómalo malicioso detectado previamente en su red") with an Incident ID. Measured 2026-08-22 from the maintainer's residential IP with headed Chromium **and** playwright-stealth — the combination that defeats NBP's Incapsula — and it still fails. So this is **not** fixed by R4's self-hosted runner. Options are a CAPTCHA-solving service, a different source for Colombian policy decisions, requesting an allowlist from Banco de la República, or accepting BCR as permanently manual. **Needs a maintainer decision.** BCR is the only stale CB left. |
| I8 | P3 | **The repo has no lockfile and CI/prod/local resolve independently.** Related to I1 but distinct: the local venv built today resolved `anthropic` to 1.0.0 while the last green CI run had resolved an older 0.x, so CI was green on a tree production no longer had. |
| ~~I6~~ | ~~P1~~ | ~~**The CI test gate never ran a test.**~~ — **fixed**; see *Fixed this cycle*. Runs 2–13 were all red. |

## Outstanding work

| ID | Item | Blocked on |
|---|---|---|
| ~~R3~~ | ~~**Backfill NBP**~~ — **done** (2026-06-02, 2026-07-08). The stated cause was wrong; see *Fixed this cycle*. Issue #14 can close. |
| R4 | Self-hosted runner for the WAF-exposed CBs | **Scope now measured, and it is smaller than assumed.** A residential IP alone fixes nothing: NBP needs `PLAYWRIGHT_HEADLESS=0` (headed Chromium **plus** stealth) and browser-context fetching, both of which now exist — so a runner helps NBP only if it has a real display. **BCR is not fixed by a runner at all** (see I7). BCCH and BOI are currently *current*, so the runner's value for them is untested. |
| R8 | Capture HTML/PDF fixtures per CB + parser regression tests | Nothing — **next up**. Phases 1–4 are complete |
| R9 | Harden the 12 single-path scrapers | R8. Changing selectors blind is worse than leaving them detected-but-manual |
| — | **Run `scripts/migrate_add_versioning.py` on main after merge** | Merging this branch. Verified: `doc_score` checksum identical, 4,291 scores |
| — | **Run a real bake-off** (`scripts/model_bakeoff.py score --models … --replicates 2`) | **Spend decision** — ~$2–4 for 200 statements × 4 models. The harness is built and exercised against a stub; it has never been run against a live API |
| — | Backfill the 54 charset-corrupted FED statements | **Spend decision** — needs re-fetch + re-score of 54 × 3 models, which also trips `COST_GUARD_MAX = 20` |

---

## Fixed this cycle

Kept for evidence — several of these had been silently degrading the data for
months, and the record is the point.

| Item | Why it mattered |
|---|---|
| **SNB's 156-day gap was a false-positive garbage filter, not the blocklist (R-SNB)** | The handoff diagnosed SNB as purely a wrongly-blocked ID and expected section 2.4 to be a confirmation step. Unblocking was necessary but not sufficient: with the block lifted the scraper fetched the correct 4,941-character press release and `validate_new_statement` check 4 discarded it again on the same run. `_GARBAGE_PERMANENT` matched `"Download file now
Monetary policy"` **anywhere** in the document — but a genuine SNB assessment contains that exact pair thousands of characters in, as the caption of the conditional inflation forecast chart followed by the assessment title. So every valid SNB release was rejected, and because the pattern is *permanent*-class it also made them auto-blockable — which is how 2026-06-18 came to be blocked at all. The blocklist was the symptom; this was the cause. Now anchored to the first 200 characters, with `tests/test_garbage_patterns.py` pinning both directions. SNB is current. |
| **The Claude scorer had been failing on every call (I3 → I1)** | I3 recorded this as "errored once, counter 1 of 3, below threshold, watch it" — a flaky-looking blip. It was neither flaky nor minor: `anthropic` 1.0.0 removed `temperature`/`top_p`/`top_k` from `messages.create()`, `requirements.txt` asked only for `>=0.40.0`, and every Claude call had been raising `TypeError` since the SDK bumped. The alert threshold hid it because the counter only reaches 3 on consecutive days a Claude-eligible statement exists, and the pipeline had almost nothing new to score while three CBs were stale — **two failures masking each other**. The fix is `extra_body={"temperature": 0}`, not deletion: `temperature` is gone from the 1.x signature but not from the API, and `claude-sonnet-4-6` still honours it. Deleting it would have silently fallen back to the default temperature, making every score non-reproducible and quietly invalidating the test–retest metric in `src/model_eval.py` — whose entire purpose is to check a model agrees with itself at temperature 0. `anthropic` is now pinned `>=1,<2`. |
| **NBP was not an IP problem (R3, issue #14)** | The handoff's stated cause — Incapsula blocks GitHub's datacenter IPs, so a residential IP walks straight through — is wrong, and acting on it alone would have produced another "fixed" scraper that still returns nothing. Measured from the maintainer's residential IP: plain `requests` **and** headless+stealth Playwright both get the 884-byte Incapsula challenge with zero links. Only headed Chromium **plus** playwright-stealth returns the real 283 KB listing — each half alone fails. Discovery alone was still not enough: every PDF then 403'd, because the Incapsula cookie is bound to the browser's TLS/JS fingerprint and does not survive being handed to `requests`. NBP now falls back to fetching through the browser context's own request API. 295 statements discovered, both missing meetings stored, NBP current after 108 days. |
| **Every text file I/O in the repo assumed the platform default encoding** | Python's text I/O follows the locale: UTF-8 on the Linux CI runner, cp1252 on the maintainer's Windows machine. So 31 bare `read_text()` calls plus a dozen `write_text`/`open` calls worked in CI and crashed locally — on the very machine the handoff directs the operator to. `staleness_matrix.py`, the section 2.4 recovery check, exited 1 on any scraper source containing an em-dash and could not run at all. `model_bakeoff.py` writes a scorecard containing `≥` and `·`, so a real bake-off would have crashed **after** spending the API budget. The suite reported 3 failed / 319 passed locally against 322 passed in CI. Same bug class as the Fed charset bug (B1) — an undeclared encoding — this time in the tooling instead of the scrapers. |
| **The scheduled-meeting auto-block veto was confirmed working under real conditions** | Not a fix — evidence. Both SNB and BCR fetched rejected content this cycle and both logged "is a SCHEDULED meeting but content was rejected … not blocking; investigate the scraper" instead of being silently re-blocked. Under the old behaviour this session would have re-blocked both IDs and re-created the exact outage it was sent to repair. |
| **`data/scored/*.parquet.lock` were tracked in git** | `filelock` artifacts committed by the daily runs on 2026-07-03 and 2026-07-07 and never covered by `.gitignore`. Running the test suite deletes them, so every working tree showed spurious deletions — noise directly in front of trap 3.1, which asks you to read `git status --porcelain data/` carefully before every commit. |
| **Bake-off harness (C3c)** | `scripts/model_bakeoff.py` + `src/model_eval.py`: a standing framework for deciding whether a new model release is worth adopting, on a fixed stratified 200-statement sample that is committed so successive bake-offs stay comparable. Adds **test–retest** — the same model on the same sample twice — which had never been measured, and is the only absolute criterion here: a model that disagrees with itself is unusable however well it correlates with the incumbents. Writing the tests found three bugs in my own metrics: `pairwise_matrix` returned a column-less frame that made `verdict` raise instead of reporting "no comparison available"; the **bias sign was inverted** whenever the candidate sorted second, which would have described a dovish model as hawkish and flipped the recommendation; and `coverage`/`null_agreement` came off a `dropna(how="all")` pivot that discarded exactly the rows where both models agreed a sentence was boilerplate |
| **The CI gate never ran a test (I6)** | The "first CI gate in this repo" was added with a hand-picked dependency list — `pytest pandas pyarrow python-dotenv ruff` — that did not cover `requests`, `filelock`, `pdfplumber` or the three model SDKs. Five test modules failed at *collection*, so **runs 2 through 13 were all red and zero tests executed**. The suite was green locally the whole time, which is exactly why it went unnoticed: local reporting was true, and never checked against CI. It now installs `requirements.txt` — the same tree production uses — and as a side benefit the gate will now catch a breaking dependency release before the daily job does (I1) |
| **Ensemble blended model versions (D1 follow-on)** | Making version part of the write key means a statement can hold two sets of sentence rows for the same model. `compute_ensemble_scores` means across rows with no version filter, so the first 2.0 re-score would have been silently averaged with the 1.0 rows it replaced — every published number moves, and "1.0 is preserved" becomes false. `_latest_version_only` now keeps one build per `(statement_id, model)`, chosen by `model_scores.scored_at`. Verified a no-op on the real store: 4,291 scores, checksum `1916.6433413417`, zero rows moved |
| **Gemini/DeepSeek dropped short statements on a bad reply (B4)** | Only Claude retried a JSON parse failure on a short statement; the other two called once and let it raise, so one malformed response cost that model's score for the statement. Both had the 3-attempt retry on the chunked path only. Two smaller drifts fixed with it: only Claude scrubbed control characters from the text it *sent*, and only Gemini/DeepSeek could salvage a truncated reply — a truncated Claude response threw away every sentence already parsed |
| **Ensemble versioning (D1)** | Writes were destructive by `(statement_id, model)`, so re-scoring with a newer model rewrote history in place and made the series non-comparable across the break with nothing marking it. `model_version` and `prompt_version` are now part of the write key: the same build stays idempotent, a new build appends. A separate `ensemble_scores` table holds per-version doc scores, leaving `statements.doc_score` as the published series so nothing downstream changes |
| **Fed charset bug (B1)** | `requests` defaults `text/*` to ISO-8859-1 when no charset is declared. The Fed declares none, so every en-dash and curly quote became mojibake in 54 statements (2007–2026) — **and the models scored the corrupted text**. Fixed centrally in `BaseScraper._get`. Writing the guard test then exposed **six more paths** (`boi`, `bot`, `nbp` ×2, `rbnz` Wayback, `sarb`, plus the shared calendar probe) that read `.text` from their own `requests.get` and bypassed it — all now corrected, with a contract test that fails if a new one appears |
| `fetch_cb` returned `(0,0)` for both "nothing new" and "scraper dead" | The core blind spot. Detection went from **45–136 days to ~3 days** |
| **Auto-blocking of scheduled meetings** | `SNB_MPC_STATEMENT_20260618` and `BCR_RATE_DECISION_20260710` were permanently blocked (2026-07-05 / 07-12). A blocked ID is rejected before any scraper fix can matter, so both stayed stale for months while their scrapers were "being fixed". Now a calendar-listed meeting can never be auto-blocked, and a test asserts the invariant |
| `alert.py` had no `if: always()` | `update.py` exits 1 on the cost guard, so the runs most needing an alert sent none |
| `_compute_staleness` skipped CBs with zero statements | A scraper broken from day one could never alert |
| Model failure counter required `ok == 0` | A model scoring 1 of 40 reset its own counter |
| Cost-guard path wrote an empty `stale_cbs` | Erased staleness state on exactly the runs that tripped it |
| `nbp.py` never declared `CB` / `DOC_TYPE` | Any shared `BaseScraper` helper using `self.CB` failed for NBP alone. Caught by the new contract tests |
| New `_session` property collided with `rbi.py`'s attribute | Broke RBI's constructor outright. Caught by the new contract tests |
| BCR manual-refresh URL pointed at **Peru** (`bcrp.gob.pe`) | Scraper targets Colombia. Anyone refreshing the calendar would have transcribed the wrong country's dates |
| MNB non-decision Wednesday meetings | `_merge_dates` is append-only, so the 2026-08-01 refresh re-added dates deleted in June. Filter now lives in the fetcher |
| Weekend calendar entries counted as missed meetings | BOK's Sunday entry became a false positive the moment real blocks cleared |
| `dashboard/app.py` `_CORE_MODELS` `NameError` | Both internal drill-down panels had been dead since the initial commit |
| `loadCbSentences` cached `{}` on a failed fetch | Poisoned the cache for the whole session; the UI would claim a CB had no sentence data forever |
| Explorer render race | A slow response for a CB the user navigated away from could overwrite the current view |
| `BaseScraper._get` had no retry | One transient 503 silently truncated a whole discovery pass |

---

## Conventions

- **Add** an entry the moment something is found, even if not fixed. A known
  issue with no owner still beats an unknown one.
- **Move** to *Fixed this cycle* with a one-line note on why it mattered, not
  just what changed.
- Cross-reference GitHub issues where one exists (currently: **#14** for the
  NBP local run).
- Re-check `Last reviewed` when touching this file.

# Scrapers & Staleness Guarantees

How each central-bank scraper works, how a failure is detected, and — the part
that matters operationally — **which ones we can and cannot guarantee**.

> The table below is generated. Regenerate after changing any scraper:
> ```
> python scripts/staleness_matrix.py --write
> ```

## How detection works

Three independent signals, fastest first. A scraper has to defeat all three to
fail silently, which is the property the old pipeline lacked.

| Signal | Question it asks | Latency | Where |
|---|---|---|---|
| **Discovery counter** | Did this scraper return *any* refs? | ~3 runs (3 days) | `src/pipeline_health.py::compute_scraper_health` |
| **Calendar probe miss** | The calendar says a meeting happened — can we reach its URL? | same run | `src/scrapers/base.py::probe_from_calendar` |
| **Missing meeting** | Did a confirmed past meeting produce a statement? | grace period (3 days) | `src/pipeline_health.py::compute_calendar_staleness` |
| **Interval backstop** | Has this CB been silent for >1.5× its usual gap? | 45–136 days | `src/pipeline_health.py::compute_staleness` |

The discovery counter is the workhorse. `discover_urls()` returns a scraper's
entire back-catalogue every run, so a healthy scraper reports a large non-zero
number even on days when nothing was published. Zero — or a collapse against
the recorded baseline — therefore means *broken*, not *quiet*. This is the
distinction the previous `(fetched, errors)` return value could not express,
and why outages used to hide for months.

Alerts are raised by `scripts/alert.py` as GitHub issues, deduped through
`active_alerts` in `logs/last_run.json`.

## The matrix

<!-- BEGIN GENERATED MATRIX -->
*Data as of 2026-08-20.* **20 of 23 central banks current.** Stale: BCR, NBP, SNB.

> The **Resilience** and **Known risk** columns describe *posture* — what would happen **if** a site changed — not current breakage. A CB marked "Manual fix required" is working fine; it simply has one discovery path. Read the **Status today** column for what is actually broken.

**Detection is guaranteed for all 23 central banks.** The per-CB discovery counter fires after 3 consecutive runs (~3 days) whether or not a meeting was due, so no scraper can fail silently. The columns below describe what happens *after* detection.

- **Self-healing (3):** BCR, NBP, SNB — a calendar probe reconstructs statement URLs from the meeting date, so these recover from a site redesign without code changes.
- **Manual fix required (12):** BANXICO, BCB, BOK, BOT, CBC, CNB, ECB, MNB, NORGESBANK, RBA, RBI, SARB — a single discovery path. Breakage is detected in ~3 days but a human must repair the selector or URL pattern.
- **No missing-meeting check (1):** BCR — the calendar holds no confirmed dates, so gaps are caught only by the discovery counter and the interval backstop.
- **WAF-exposed (4):** BCCH, BCR, BOI, NBP — these sites block datacenter IPs, so they can fail on GitHub-hosted runners while working fine elsewhere. Mitigated by the self-hosted runner.

| CB | Status today | Transport | Probe | Other fallback | Calendar confirmed | Meeting check | Detect | Resilience | Known risk |
|---|---|---|---|---|---|---|---|---|---|
| **BANXICO** | current (15d) | requests | — | — | 8/8 | yes | 3 runs | Manual fix required | — |
| **BCB** | current (16d) | JSON API | — | — | 1/8 | yes | 3 runs | Manual fix required | calendar mostly estimated |
| **BCCH** | current (24d) | Playwright | — | 11 URL-slug candidates + doc page | 8/8 | yes | 3 runs | Partial fallback | WAF blocks CI IPs |
| **BCR** | **STALE 51d** | Playwright | yes | — | 0/7 | no | 3 runs | Self-healing (probe) | WAF blocks CI IPs; calendar all estimated |
| **BOC** | current (37d) | requests | — | dual listing + archive | 8/8 | yes | 3 runs | Partial fallback | — |
| **BOE** | current (22d) | requests | — | pure URL enumeration | 8/8 | yes | 3 runs | Partial fallback | — |
| **BOI** | current (46d) | Playwright | — | Playwright fetch retry | 8/8 | yes | 3 runs | Partial fallback | WAF blocks CI IPs |
| **BOK** | current (36d) | requests | — | — | 5/8 | yes | 3 runs | Manual fix required | — |
| **BOT** | current (58d) | Playwright | — | — | 6/6 | yes | 3 runs | Manual fix required | — |
| **CBC** | current (64d) | requests | — | — | 4/4 | yes | 3 runs | Manual fix required | — |
| **CBRT** | current (22d) | requests | — | ANO URL pattern | 8/8 | yes | 3 runs | Partial fallback | — |
| **CNB** | current (15d) | Playwright | — | — | 8/8 | yes | 3 runs | Manual fix required | — |
| **ECB** | current (29d) | requests | — | — | 8/8 | yes | 3 runs | Manual fix required | — |
| **FED** | current (23d) | requests | — | URL probing (historical path only) | 8/8 | yes | 3 runs | Partial fallback | — |
| **MNB** | current (31d) | requests | — | — | 12/12 | yes | 3 runs | Manual fix required | — |
| **NBP** | **STALE 107d** | Playwright | yes | — | 11/11 | yes | 3 runs | Self-healing (probe) | WAF blocks CI IPs |
| **NORGESBANK** | current (8d) | JSON API | — | — | 8/8 | yes | 3 runs | Manual fix required | — |
| **RBA** | current (10d) | requests | — | — | 8/8 | yes | 3 runs | Manual fix required | — |
| **RBI** | current (16d) | ASP.NET POST | — | — | 5/5 | yes | 3 runs | Manual fix required | — |
| **RBNZ** | current (44d) | Playwright | — | Wayback CDX (fetch only) | 6/7 | yes | 3 runs | Partial fallback | — |
| **RIKSBANK** | current (1d) | requests | — | alternate selector (same page) | 4/6 | yes | 3 runs | Partial fallback | — |
| **SARB** | current (29d) | Playwright | — | — | 2/6 | yes | 3 runs | Manual fix required | calendar mostly estimated |
| **SNB** | **STALE 155d** | requests | yes | — | 1/4 | yes | 3 runs | Self-healing (probe) | calendar mostly estimated |
<!-- END GENERATED MATRIX -->

## Column meanings

- **Probe** — has a direct calendar probe: reconstructs statement URLs from the
  official meeting date instead of parsing a listing page. This is the only
  fallback that is fully independent of the site's HTML structure, so it
  survives redesigns. It also uses plain `requests`, which several WAFs allow
  even when they block headless browsers.
- **Other fallback** — a secondary discovery path. Weaker than a probe: most
  still depend on the same site structure.
- **Calendar confirmed** — confirmed vs total dates in `forward_dates.json`.
  Only *confirmed* dates drive the missing-meeting check, because an estimated
  date for a meeting that never happened produces an alert nobody can clear.
- **Resilience** — what happens after detection. `Self-healing` recovers
  without code changes; `Manual fix required` means a human must repair the
  selector or URL pattern.
- **Known risk** — standing conditions that make failure more likely.

## What we cannot guarantee

> Tracked alongside everything else in **[`docs/BACKLOG.md`](BACKLOG.md)**.

Stated plainly, because these are the residual risks:

1. **WAF-blocked central banks on hosted runners.** BCCH, BCR, BOI and NBP sit
   behind Incapsula/ShieldSquare, which block GitHub's datacenter IP ranges.
   They can fail in CI while working perfectly from a residential connection.
   *Mitigation:* the self-hosted runner job. *Residual risk:* if that runner is
   offline, these four degrade until it returns.

2. **BCR's calendar is entirely estimated (0 of 7 dates confirmed)** — and its
   WAF bypass is built on those dates. Its probe can only look where the
   estimate points, and the missing-meeting check cannot run for it at all.
   *Mitigation:* the probe re-derives the true date from the page once found,
   and the discovery counter still covers it. *Residual risk:* a meeting on an
   unexpected date may be missed until the interval backstop fires.
   *Fix:* transcribe confirmed dates from
   <https://www.banrep.gov.co/es/calendario-junta-directiva>.

3. **Single-path scrapers.** Twelve CBs have exactly one discovery mechanism.
   Breakage is detected within ~3 days, but recovery needs a human. The most
   brittle single dependencies are ECB (a regex over a JavaScript array
   literal), BANXICO (three chained CSS-class regexes) and NORGESBANK (opaque
   CMS facet IDs that can change without notice).

4. **Calendar coverage ends 2026-12-23.** From November 2026, 15 CBs drop below
   two future meetings. When the calendar runs dry, both the probe fallback and
   the missing-meeting check become no-ops *silently*.
   *Mitigation:* `scripts/check_calendar_health.py` warns ahead of the cliff and
   runs in the monthly workflow. *Fix:* only 10 of 24 CBs auto-refresh; the rest
   are listed in `_MANUAL_REFRESH` in `scripts/refresh_calendars.py`.

5. **Calendar dates that disagree with recorded meeting dates.** Five confirmed
   dates are 6–8 days off what we store (CBRT 2026-01-22 vs 2026-01-29, RBNZ
   2026-04-08 vs 2026-04-01, NORGESBANK 2026-06-11 vs 2026-06-18, BCCH
   2026-01-27 vs 2026-02-04). These are reported as `date_mismatches` rather
   than outages so they do not drown the real signal — but each is either a bad
   calendar entry or a scraper recording the publication date instead of the
   meeting date, and they should be reconciled.

6. **Fetch-side failures are weaker than discovery-side.** The signals above
   all concern *discovery*. A scraper that finds URLs but cannot extract text
   from them shows up as fetch errors and, eventually, a missing meeting — but
   has no dedicated counter.

## Adding a scraper

1. Subclass `BaseScraper`; implement `discover_urls()` and `fetch_text()`.
2. Declare `CB` and `DOC_TYPE`. `CB` **must** match the key in
   `forward_dates.json` — the contract test enforces this.
3. Register it in `_SCRAPERS` in `scripts/update.py`.
4. Add a `TYPICAL_INTERVAL_DAYS` entry, or it can never go stale.
5. Add a calendar probe if the statement URL is derivable from the meeting date
   — see `snb.py::_probe_urls` for the simplest example.
6. Prefer raising over returning `[]` on discovery failure.
7. Run `pytest tests/test_scraper_contract.py`.

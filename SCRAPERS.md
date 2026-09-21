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

> ⚠️ **That is only true of some scrapers, and the exceptions are where the
> counter is weakest.** 18 of 23 filter discovery by `since_date`, which
> `update.py` sets to 60 days ago on every daily run, so what they report is
> the *window*, not the back-catalogue. Measured 2026-09-20: NORGESBANK
> returns 1, ECB 2, BCR 1-2, SARB 4, RBA and BOT 5. Two consequences:
>
> * The collapse heuristic needs a baseline of at least 4
>   (`_MIN_BASELINE_FOR_COLLAPSE`), so **NORGESBANK, ECB and BCR have no
>   partial-failure detection at all** — only the zero check stands behind
>   them, and SARB, RBA and BOT are one meeting away from the same position.
> * For these CBs zero is not unambiguous either: a genuinely quiet 60-day
>   window produces it. ECB's summer gap runs to about 56 days.
>
> The backstop for all six is the calendar: the probe and the missing-meeting
> check are date-anchored and do not care how many refs discovery returned.

Alerts are raised by `scripts/alert.py` as GitHub issues, deduped through
`active_alerts` in `logs/last_run.json`.

## The matrix

<!-- BEGIN GENERATED MATRIX -->
*Data as of 2026-09-17.* **22 of 23 central banks current.** Stale: BCR.

> The **Resilience** and **Known risk** columns describe *posture* — what would happen **if** a site changed — not current breakage. A CB marked "Manual fix required" is working fine; it simply has one discovery path. Read the **Status today** column for what is actually broken.

**Detection is guaranteed for all 23 central banks.** The per-CB discovery counter fires after 3 consecutive runs (~3 days) whether or not a meeting was due, so no scraper can fail silently. The columns below describe what happens *after* detection.

- **Self-healing (4):** BCR, FED, NBP, SNB — a calendar probe reconstructs statement URLs from the meeting date, so these recover from a site redesign without code changes.
- **Manual fix required (12):** BANXICO, BCB, BOK, BOT, CBC, CNB, ECB, MNB, NORGESBANK, RBA, RBI, SARB — a single discovery path. Breakage is detected in ~3 days but a human must repair the selector or URL pattern.
- **No missing-meeting check (1):** BCR — the calendar holds no confirmed dates, so gaps are caught only by the discovery counter and the interval backstop.
- **WAF-exposed (4):** BCCH, BCR, BOI, NBP — these sites block datacenter IPs, so they can fail on GitHub-hosted runners while working fine elsewhere. **Not currently mitigated:** the self-hosted runner is R4, still outstanding, and NBP needs a real display on top of it. Each of these needs a local headed run when it fails.

| CB | Status today | Transport | Probe | Other fallback | Calendar confirmed | Meeting check | Detect | Resilience | Known risk |
|---|---|---|---|---|---|---|---|---|---|
| **BANXICO** | current (46d) | requests | — | — | 8/8 | yes | 3 runs | Manual fix required | — |
| **BCB** | current (5d) | JSON API | — | — | 1/8 | yes | 3 runs | Manual fix required | calendar mostly estimated |
| **BCCH** | current (13d) | Playwright | — | 11 URL-slug candidates + doc page | 8/8 | yes | 3 runs | Partial fallback | WAF blocks CI IPs |
| **BCR** | **STALE 82d** | Playwright | yes | — | 0/7 | no | 3 runs | Self-healing (probe) | WAF blocks CI IPs; calendar all estimated |
| **BOC** | current (19d) | requests | — | dual listing + archive | 8/8 | yes | 3 runs | Partial fallback | — |
| **BOE** | current (4d) | requests | — | pure URL enumeration | 8/16 | yes | 3 runs | Partial fallback | — |
| **BOI** | current (20d) | Playwright | — | Playwright fetch retry | 8/8 | yes | 3 runs | Partial fallback | WAF blocks CI IPs |
| **BOK** | current (25d) | requests | — | — | 4/7 | yes | 3 runs | Manual fix required | — |
| **BOT** | current (26d) | Playwright | — | — | 6/6 | yes | 3 runs | Manual fix required | — |
| **CBC** | current (4d) | requests | — | — | 4/4 | yes | 3 runs | Manual fix required | — |
| **CBRT** | current (4d) | requests | — | ANO URL pattern | 12/12 | yes | 3 runs | Partial fallback | — |
| **CNB** | current (4d) | Playwright | — | — | 8/8 | yes | 3 runs | Manual fix required | — |
| **ECB** | current (11d) | requests | — | — | 24/24 | yes | 3 runs | Manual fix required | — |
| **FED** | current (5d) | requests | yes | URL probing (historical path only) | 18/18 | yes | 3 runs | Self-healing (probe) | — |
| **MNB** | current (27d) | requests | — | — | 12/12 | yes | 3 runs | Manual fix required | — |
| **NBP** | current (12d) | Playwright | yes | — | 11/11 | yes | 3 runs | Self-healing (probe) | WAF blocks CI IPs |
| **NORGESBANK** | current (39d) | JSON API | — | — | 8/8 | yes | 3 runs | Manual fix required | — |
| **RBA** | current (41d) | requests | — | — | 16/16 | yes | 3 runs | Manual fix required | — |
| **RBI** | current (47d) | ASP.NET POST | — | — | 5/5 | yes | 3 runs | Manual fix required | — |
| **RBNZ** | current (19d) | Playwright | — | Wayback CDX (fetch only) | 6/7 | yes | 3 runs | Partial fallback | — |
| **RIKSBANK** | current (32d) | requests | — | alternate selector (same page) | 11/13 | yes | 3 runs | Partial fallback | — |
| **SARB** | current (60d) | Playwright | — | — | 2/6 | yes | 3 runs | Manual fix required | calendar mostly estimated |
| **SNB** | current (95d) | requests | yes | — | 1/4 | yes | 3 runs | Self-healing (probe) | calendar mostly estimated |
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
>
> **Last verified 2026-09-20** by running discovery against all 23 live sites
> (`update.py --dry-run`). Where this section says a scraper is at risk, that
> is a statement about what was measured, not what was assumed.

Stated plainly, because these are the residual risks:

1. **NBP cannot run on a hosted runner at all.** Incapsula serves a challenge
   to headless Chromium; only headed Chromium plus stealth gets through. NBP
   has therefore failed discovery on 29 consecutive daily runs, which is
   *correct* behaviour reporting a real limitation. Every NBP meeting needs a
   local headed run to collect (`PLAYWRIGHT_HEADLESS=0`), most recently on
   2026-09-20 for the 09-09 meeting. *Fix:* R4, a self-hosted runner with a
   real display — nothing else closes this.

2. **BCR is hard-blocked and is not recoverable by any approach in this repo.**
   Re-verified 2026-09-20 from a residential IP with headed Chromium and
   stealth: the nested August URL is a genuine 404 and the July and September
   ones return the ShieldSquare CAPTCHA. Its listing discovery is separately
   dead (**B10** — 67 English pages plus the Spanish fallback return 0 refs),
   so the probe is the only path it has, and the probe now correctly reports a
   MISS rather than a find. *This needs a decision, not a fix:* **I7**.

3. **Single-path scrapers.** Twelve CBs still have exactly one discovery
   mechanism: BANXICO, BCB, BOK, BOT, CBC, CNB, ECB, MNB, NORGESBANK, RBA, RBI,
   SARB. Breakage is detected within ~3 days, but recovery needs a human. The
   most brittle single dependencies are BANXICO (three chained CSS-class
   regexes) and NORGESBANK (opaque CMS facet IDs that can change without
   notice); NORGESBANK is also one of the three with no collapse detection.
   FED, RBNZ, CBRT and BOI were taken off this list in September 2026 (**R9**
   in progress).

4. **ECB's discovery still rests on a regex over a JavaScript array literal**
   (`ECB.data["all_pc_historical_dates"]`, `ecb.py:83-88`) — the most brittle
   line in the repo. It fails loudly if the array moves, which is the good
   case. The bad case is the *second* regex: if the IS-href pattern stops
   matching, each date logs a warning and discovery returns a partial or empty
   list, and with a baseline of 2 there is no collapse check behind it.

5. **Statement ids are derived from dates, so one bad document can block a
   real one permanently.** `data/blocked_ids.json` is checked before any
   scraper runs and nothing expires from it. CBRT's over-inclusive discovery
   auto-blocked a liquidity-management press release published on 2026-09-17,
   which blocked the genuine MPC summary of the same date; it was found and
   recovered on 2026-09-20. The scheduled-meeting veto does **not** cover this:
   a summary published a week after the decision is not a calendar date. 15
   CBRT and 10 BOI ids from that era remain blocked; none of the rest collides
   with what the fixed scrapers now find, but the mechanism is intact for any
   future over-inclusive discovery.

6. **The calendar horizon now reaches 2028-12-07, but only for the 9 CBs whose
   fetchers work.** The 14 `_MANUAL_REFRESH` banks extend only when a human
   transcribes their dates, and three are already at one future meeting: CBC
   (2026-12-17), RIKSBANK (2026-11-19), SNB (2026-12-10). When a CB's calendar
   runs dry, its probe fallback and its missing-meeting check both become
   silent no-ops. *Mitigation:* `check_calendar_health.py` warns ahead of it,
   and the monthly refresh now exits non-zero when a fetcher regresses.

7. **Calendar dates that disagree with recorded meeting dates.** Five are
   6–8 days off what we store (BCCH 2026-01-27, CBRT 2026-01-22 and 2026-03-12,
   NORGESBANK 2026-06-11, RBNZ 2026-04-08). Reported as `date_mismatches`
   rather than outages so they do not drown the real signal — but each is
   either a bad calendar entry or a scraper recording the publication date
   instead of the meeting date. They cannot be corrected in place either:
   `_merge_dates` never deletes.

8. **Fetch-side failures are weaker than discovery-side.** The signals above
   all concern *discovery*. A scraper that finds URLs but cannot extract text
   from them shows up as fetch errors and, eventually, a missing meeting — but
   has no dedicated counter. BOI's WAF interstitial and SNB's garbage-pattern
   incident were both of this shape.

9. **The last line of defence against publishing a non-policy document is an
   LLM classifier.** `validate_new_statement` check 5 asks a model whether the
   text is a policy statement. It is doing that job well — it is what kept
   CBRT's press releases and BCR's 404 page out of the store — but it is
   probabilistic, and it is reached only because discovery admitted the
   document in the first place. Precision in `discover_urls` is the real
   defence; the classifier is the net under it.

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

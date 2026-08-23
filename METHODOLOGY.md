# Methodology

How a statement becomes a number, and what that number does and does not mean.

---

## The scale

Every sentence is scored as an **integer from −10 to +10**:

| Score | Meaning |
|---|---|
| **−10** | Maximally hawkish — emergency tightening, severe inflation alarm |
| −8 | Very hawkish |
| 0 | Neutral |
| +8 | Very dovish |
| **+10** | Maximally dovish — emergency easing, severe growth/employment concern |

**Negative is hawkish, positive is dovish.** The full integer range is used;
models are told explicitly not to anchor on round numbers.

`null` means "no monetary-policy signal" and the sentence is excluded from
every average. The prompt lists what to skip: meeting logistics and procedural
preamble, mandate restatements, vote recording, pure data recitation with no
evaluative language, and notices of future data releases.

The scale is **absolute, not directional**: it scores the hawkish/dovish *level*
of the language, not the change since last meeting. Two consequences worth
internalising:

- Maintaining rates at the zero lower bound scores **dovish**, not neutral.
- Holding at a restrictive level scores **hawkish**, not neutral.

So a flat series does not mean "no change in stance" — it means the stance
itself is unchanged in level.

## The prompt

All three models receive the **same prompt**, verbatim, in
`src/scoring/prompt.py`. Same scale, same skip rules, same JSON output shape:

```json
{"sentences": [{"idx": 0, "text": "…", "score": -6},
               {"idx": 1, "text": "…", "score": null}]}
```

Models are called at `temperature=0`.

> The prompt is **V1**, now recorded as `PROMPT_VERSION` in `config/settings.py`
> and written onto every scored row. Before that it was a docstring comment
> only, so a prompt change was indistinguishable from a model change in the
> stored data. Rows written before versioning existed carry
> `model_version = "unversioned"`; their prompt was demonstrably v1, but the
> exact model build behind a 2019 score is not recoverable and asserting one
> would be inventing provenance. Earlier prompt generations (v2–v5, exploring
> directional rather than level scoring) were compared in side-car CSVs and
> then deleted; only the winner survives.

## Language

Statements are scored **in their original language** — Spanish for Banxico,
BCCh and BCR, Portuguese for BCB — rather than translated first. Translation
would introduce a second model's interpretation between the central bank and
the score.

---

## From sentences to a published number

`compute_ensemble_scores()` in `src/storage/parquet_store.py` is the
authoritative definition. Two stages, both unweighted means:

**1. Align sentences across models.** Each model returns its own
`sentence_idx`, and they do not agree, so alignment is by normalised text:

```python
_norm = text.strip().lower()
```

**2. Per-sentence ensemble** — mean of the non-null scores for that normalised
text, across whichever models scored it:

```
sent_ensemble(statement, text) = mean(score for each model where score is not null)
```

**3. Document score** — mean of the per-sentence ensembles:

```
doc_score(statement) = mean(sent_ensemble over distinct normalised sentences)
```

This is deliberately *not* the mean of the three models' document scores. It
weights each sentence equally regardless of how many models chose to score it,
so a model that nulls more sentences does not thereby gain influence over the
document total.

**Eligibility.** A statement is published once at least
`ENSEMBLE_MIN_MODELS = 2` of the three models have scored it, so a single API
outage does not drop new statements from the dashboard. Coverage is counted
from `model_scores.parquet`.

### Consequences worth knowing

- A sentence scored by only one model counts as much as one scored by all
  three. Equal weight is per *sentence*, not per *observation*.
- Identical repeated sentences inside one statement collapse into a single
  group, because the key is normalised text rather than position.
- A sentence that one model splits differently from the others simply never
  matches, and is averaged over a smaller set.

---

## ⚠ Open decision: three different "ensembles" in the code

The same word denotes three different computations:

| Where | Definition | Used for |
|---|---|---|
| `parquet_store.py:219-307` | **Sentence-level mean** (above) | `statements.doc_score` — the published series |
| `build_methodology_data.py:126` | `_wide[CORE].mean(axis=1)` — **mean of the three document scores** | A row count on the methodology page |
| `build_site.py:1005-1009` | Per-sentence mean, recomputed — but **drops sentences under 10 characters** | `cb_sentences_*.json`, the sentence table |

They agree closely but not exactly. The third can disagree with `doc_score` for
the same statement, because of the 10-character filter.

**This is documented rather than fixed, deliberately.** Reconciling them would
move published numbers, which is a call for the maintainer, not a silent
refactor. The recommendation is to make `compute_ensemble_scores()` the single
implementation and have the other two call it.

---

## Model selection

The current set is Claude, Gemini and DeepSeek. GPT-4o was evaluated and
**dropped**, on two metrics measured over 249 statements scored by all four:

| Pair | Pearson r | Systematic bias |
|---|---|---|
| Claude vs Gemini | 0.948 | +0.10 |
| Claude vs DeepSeek | 0.911 | +0.08 |
| Gemini vs DeepSeek | 0.913 | +0.02 |
| Claude vs GPT-4o | 0.740 | **+1.02** |
| DeepSeek vs GPT-4o | 0.726 | **+0.94** |
| Gemini vs GPT-4o | 0.750 | **+0.92** |

GPT-4o scored roughly a full point more dovish than consensus against every
partner. In an equal-weight average that shifts every ensemble score by ~0.3
units across the whole corpus.

Live agreement on the current production data (`results.json`):

```
claude ↔ gemini    r = 0.930
claude ↔ deepseek  r = 0.916
gemini ↔ deepseek  r = 0.911
```

### ⚠ What this criterion actually measures

**Agreement, not accuracy.** There is no ground truth anywhere in this project
— no human-labelled set, no market anchor. The acceptance bar (r ≥ ~0.90,
|bias| ≤ ~0.10 against the incumbents) is a *consistency* test.

A genuinely better but differently-calibrated model would fail it. That is
precisely how GPT-4o was excluded: it may have been more accurate, less
accurate, or simply reading the same text on a different centre — the metrics
used cannot distinguish those cases.

The bake-off harness keeps this bar (it is the established precedent) but is
structured so a market anchor or a small labelled set can be added later as an
extra column without redesign.

---

## The bake-off: deciding on a new model release

`scripts/model_bakeoff.py` is the standing framework for this decision. Run it
when a provider ships a new build, or when evaluating a new candidate. The
metrics themselves live in `src/model_eval.py` as pure functions, so the whole
scorecard is unit-tested.

```bash
# Draw the evaluation sample once, then reuse it forever.
python scripts/model_bakeoff.py sample --n 200

# Score it. Nothing here touches the production tables.
python scripts/model_bakeoff.py score --models claude,gemini,deepseek
python scripts/model_bakeoff.py score --models openai --replicates 2

python scripts/model_bakeoff.py report --candidate openai
```

**The sample is stratified and fixed.** 200 statements drawn across CB, policy
era (pre-GFC / GFC-ZLB / normalisation / covid / inflation-shock) and tone
tercile, with a fixed seed, and committed as `data/bakeoff/sample.json`. Both
halves matter. Without era and tone stratification the draw lands mostly in
recent, mild statements — where every model trivially agrees — because that is
where most of the corpus is. And **redrawing it breaks comparability with every
earlier scorecard**, so `sample` refuses to overwrite without `--force`.

### What is measured

| Metric | Why it is here |
|---|---|
| Pairwise Pearson r | The incumbent bar: r ≥ 0.90 |
| Systematic bias `mean(a−b)` | The incumbent bar: \|bias\| ≤ 0.10. Correlation is blind to a constant offset, which is exactly how GPT-4o's +1.0 shift would have slipped through on r alone |
| **Test–retest** | Same model, same sample, twice. Never measured before this harness. At temperature 0 a model should reproduce itself; drift is a noise floor under every other comparison |
| Sentence-level agreement | Document scores can match while the sentences behind them disagree in offsetting ways — and the published ensemble is computed *per sentence*, so this is the level that matters |
| Coverage | Of every sentence either model emitted, the fraction both did. Catches a model that silently drops half a statement and then correlates beautifully on the half it kept |
| Null agreement | Whether two models agree a sentence carries no policy signal |
| Null rate | A model that nulls almost nothing is not following the prompt; one that nulls almost everything builds a document score from a handful of sentences |
| Failure rate | Refusals and unrecoverable parse failures are a selection criterion, not an operational footnote |
| Cost and latency | Priced from provider-reported token counts, not a characters/4 estimate |
| Drift vs incumbents | The maintainer's actual question: how far does the *published* series move if we swap this in |

**Test–retest is the only absolute measure here.** Everything else asks
"does this agree with what we already publish". A model that disagrees with
*itself* is unusable regardless of what anyone else thinks, so the verdict
refuses to pass an unstable model however well it correlates — and refuses to
pass an *unmeasured* one, since reporting zero drift from a single run would
make an untested model look flawless.

The verdict defaults to **DO NOT ADOPT**. A wrong swap puts a discontinuity in
a published series, which is far worse than a delayed upgrade.

### Safety and cost

Everything is written under `data/bakeoff/`, never to `statements.parquet`,
`sentences.parquet` or `model_scores.parquet` — running a bake-off cannot move
a published number. `score` is resumable and idempotent by
`(statement, model, model_version, replicate)`, so an interrupted run costs
nothing to restart, and a scorer failure records an error row and continues
rather than aborting. A pre-flight estimate is printed and anything above
`--max-cost` (default $5) requires `--yes`.

### Adopting a winner

Bump `ENSEMBLE_VERSION`, flip `in_ensemble` in `MODEL_REGISTRY`
(`config/settings.py`), and re-score. Version fields are part of the write key,
so ensemble 1.0 rows survive and stay queryable alongside 2.0 — see
[`BACKLOG.md`](BACKLOG.md).

---

## Scale choice

A 10-point scale was chosen over 5-point and 100-point alternatives:

- **5-point** loses resolution near neutral, where most central-bank language
  actually sits.
- **100-point** is false precision: models do not use the extra range
  meaningfully, and cross-model agreement does not improve.
- **10-point** balances resolution against reliable utilisation.

> The supporting figures on the methodology page are pre-built artefacts. Their
> input (`notebooks/scale_analysis_results.csv`) was deleted along with the
> notebooks, so `build_methodology_data.py` now takes a skip branch and ships
> the last-generated versions. The CSV is recoverable from git history at
> `b139b91^` if the analysis needs rerunning.

---

## Known limitations

> Also tracked in **[`docs/BACKLOG.md`](BACKLOG.md)**, with severities.

1. **No ground truth.** Everything above measures internal consistency. No
   claim of accuracy against an external standard is supported.
2. **Three ensemble definitions**, as above.
3. **Model drift is only partly visible.** New scores record the provider build
   in `model_version`, so a *declared* upgrade is now traceable in the data.
   Nothing detects a provider silently changing behaviour behind a stable model
   ID — re-running the bake-off sample is the only way to see that, which is
   part of why the sample is fixed and reusable.
4. **Sentence splitting is per-model.** Alignment by normalised text mitigates
   this but cannot fix a genuine disagreement about where a sentence ends.
5. **`methodology.json` is not rebuilt by the daily job**, so the figures on
   that tab can lag the data.
6. **BOJ is excluded** from the pipeline (format inconsistency), despite having
   a scraper and calendar entries.

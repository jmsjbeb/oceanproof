# Project Statement — OceanProof (海证)

**Track**: Open Track · Worldwide
**One-liner**: Turn a 30-year offshore discharge into a verifiable ledger for every shoreline in China — when it arrives, how long it lasts, whether the fish is safe, and what the *real* loss is.

---

## 1. The problem (Real problem & climate value)

On 24 August 2023, Japan began releasing ALPS-treated water from Fukushima Daiichi — 23 rounds and ~181,000 tonnes completed by September 2026, planned to continue for ~30 years. This is one of the most discussed climate-adjacent events in China, yet the information available to the people it touches is structurally broken:

1. **The totals are unanswerable.** "181,000 tonnes discharged" cannot be mapped onto "what happens at *my* shore, *my* county."
2. **Monitoring is qualitative.** Official bulletins say "no abnormality detected" without time dimensions or magnitude — which deepens distrust rather than resolving it.
3. **Two different risks are conflated.** Public discourse mixes *radiological exposure* with *market damage*, so both messages become unusable: "it's dangerous" is fear-marketing; "it's totally safe" ignores documented losses.

**The honest physics**: peer-reviewed modelling (Tsinghua SIGS, *National Science Review*, 2021) and public monitoring put tritium arriving at China's coast **six orders of magnitude below the WHO drinking-water guideline (10,000 Bq/L)**. Individual dose is not a health concern. **But the loss is real and measurable — it lands on the other ledger**: import bans, testing costs, consumer avoidance, collapsed origin-label premiums. *Fishermen lose orders, not doses.*

**Climate value**: OceanProof converts a diffuse, decade-long marine pollution event into place-specific, verifiable information that supports adaptation decisions (harvest timing, sourcing switches, public communication) for 11 coastal provinces and, via the atmospheric pathway, inland regions.

## 2. The user (Feasibility & UX)

| User | Their question | The number they need |
|---|---|---|
| Capture fishery co-ops | When does my ground enter the window, for how many years | Arrival date → pulse-end date |
| Mariculture farmers | Is my site in rising or receding phase | Phase tag + concentration curve |
| Inland farmers & wholesalers | Does the panic reach my county? via what path | Atmospheric-pathway rainfall concentration |
| Consumers | Is this fish safe to eat | Dose-vs-background magnitude card |
| County fishery administrators | Where to place monitoring first | Provincial exposure ranking |

The product opens with a role-based view; 65 refined sites carry full county-level industry data, and any of **3,237 provinces/prefectures/districts** (official DataV GeoAtlas divisions) can be searched, with province-average weights clearly labelled as estimates.

## 3. The AI task (AI approach & technical validity)

AI in OceanProof is **computation and reasoning infrastructure, not a chat box**:

1. **Sparse-observation field reconstruction & transport modelling.** A screening-level Lagrangian transport core: 6 calibrated current pathways with lateral second-order penalties and a Gamma pulse response, anchored to published arrival times (240 d to China's coast; 1,200 d to North America). Validated against the Tsinghua SIGS anchors (Xiangshan 223 d, Shanghai 246 d, Rongcheng 240 d, Dalian 268 d, Zhanjiang 338 d).
2. **Atmospheric-pathway particle tracking.** 600,000 Lagrangian particles advected through **NCEP/NCAR Reanalysis-1 925-hPa winds with measured precipitation rates** (wet deposition + 9-day mixing loss), producing the spatial field of ocean-source vapour fraction f_ocean (0.5° grid). Shanghai f ≈ 2.4×10⁻³; Chengdu f ≈ 1.7×10⁻⁴. This answers *which pathway reaches inland China and how much* — previously answered by hand-waving.
3. **Constrained risk-communication generation.** Role-specific advisories are generated from a deterministic template with numeric slots — reproducible, auditable, and forbidden from crossing the two ledgers or using fear language. Free-text generation is deliberately not used, so every displayed number can be recomputed from source.
4. **Uncertainty-aware presentation.** Because the near-field calibration constant C₀ is order-of-magnitude only, all outputs are presented as **magnitude ranges with explicit uncertainty statements** (e.g. "10⁻³–10⁻¹ Bq/L, seven orders below natural background even at the upper bound") — no false precision anywhere in the UI.

> **Honest scoping**: the AI approach in this submission is a physics-informed simulation core + constrained generation. A neural surrogate over an ensemble (training data ready) is the next increment; we chose auditability over model-count for this round, and say so on the Methodology page.

## 4. Solution logic (demo)

Login-free demo links:
- `?auto=1` — reviewer quick start (Brief page in English)
- `?auto=1&view=dash&loc=象山` — coastal dashboard
- `?auto=1&view=map` — dispersion atlas (measured currents + particle animation)
- `?auto=1&view=dash&loc=成都` — inland atmospheric pathway
- Search any district (e.g. 慈溪, 青羊) — 3,237-division coverage

Seven views: **0** Reviewer Brief → **1** My Shoreline → **2** Dispersion Atlas → **3** Impact Assessment → **4** Monitoring Evidence → **5** Action by Role → **6** Methodology & Pilot.

**The dual ledger** (core design): the radiological ledger is shown on a **log scale** (so "6 orders below guideline" *looks* pinned to zero) and the livelihood ledger on a **linear scale** (so 78/100 *looks* near the warning line). Users absorb both correct conclusions without reading a formula: *no need to panic; the damage is real.*

## 5. Data & AI statement

| Data | Source | Status |
|---|---|---|
| Surface currents | NOAA CoastWatch ERDDAP `noaacwBLENDEDNRTcurrentsDaily`, 0.25° daily | ✅ Measured, refreshable (`tools/fetch_currents.py`) |
| Atmospheric winds + precip | NOAA NCEP/NCAR Reanalysis-1 (925 hPa u/v, surface prate) | ✅ Measured, 600k-particle tracking (`tools/track_atmos.py`) |
| Wholesale seafood prices | Ministry of Agriculture price system (pfsc.agri.cn), daily snapshot | ✅ Measured, decrypt+parse (`tools/fetch_prices.py`) |
| Coastline | Natural Earth 1:50m land (public domain); China boundary in national inset: Ali Cloud DataV GeoAtlas official outlines | ✅ Real basemaps |
| Arrival anchors | Tsinghua SIGS *NSR* 2021 (240 d / 1,200 d / 3,600 d) | Public literature |
| Food-safety constants | IAEA TRS-472 (CF≈1 for HTO); ICRP 72 dose coefficients; UNSCEAR 2008 background; Codex CXS 193-1995 / Japan 10⁴ Bq/kg | Public dosimetry |
| Tritium monitoring | TEPCO / IAEA / MEE publish only PDF/Excel; **no API exists** | ❌ Declared honestly in-product |

Every displayed number carries a provenance tag: **实测 measured / 模型 modeled / 估算 estimated / 示意 schematic**.

**Safe-use boundaries** (stated on every page): screening-level communication tool; not for food-safety rulings, fishing-ban decisions, medical advice, or regulatory enforcement. Tritium-only conclusions do not cover Cs-137/Sr-90.

## 6. Validation plan (90 days)

| Phase | Weeks | Target | Method | Success criterion |
|---|---|---|---|---|
| P0 Baseline | 1–2 | 2 fishery co-ops (Xiangshan, Zhoushan) | 20 interviews | ≥15/20 confirm arrival-time is their most-wanted info |
| P1 Comprehension | 3–6 | 60 practitioners + 200 consumers | A/B: news digest vs dual-ledger page | Comprehension +30%; panic framing −20% |
| P2 Data-in | 7–10 | 1 county monitoring station | Replace model prior with measured tritium | Model-vs-measured within 1 order of magnitude |
| P3 Decision embed | 11–13 | Co-op pricing workflow | Batch provenance page embedded | ≥30% of batches carry scanable provenance |

## 7. Market sustainability (15%)

- **Payers**: county fishery associations (public-communication SaaS), aquaculture processors (batch-provenance pages for export questioning), cold-chain platforms (consumer trust widget).
- **Cost base**: static hosting near zero; data pipeline is 4 cron scripts on a free-tier VPS; no inference server required.
- **Transferability**: same engine + swapped pathway parameters covers Japan/Korea/SEA/US-West coasts (global layer already demoed in-product with 11 basins, clearly labelled as non-localized).

## 8. Scalability, ethics & openness (10%)

- Static, zero-dependency build (file:// runs offline); all fetch scripts open-sourced in `/tools`.
- Reverse-engineered price API is used read-only, one snapshot/day, no re-serving — with a stated intent to request formal data opening; compliance notes documented per source.
- Uncertainty and safe-use boundaries are hard-coded into the UI, not buried in a disclaimer.
- Dual-ledger framing is explicitly anti-panic *and* anti-whitewash — the product refuses both directions of misinformation.

---

*OceanProof (海证) · AI4Climate Global Youth Climate Solutions Challenge · 2026-10*

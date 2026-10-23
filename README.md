# OceanProof · 海证

**A verifiable, location-by-location ledger for coastal communities facing the Fukushima treated-water discharge.**

把三十年的核处理水排放计划，换算成每一段海岸可核验的账本：什么时候到、能持续多久、鱼还安不安全。

🌐 **Live demo:** https://jmsjbeb.github.io/oceanproof/ *(GitHub Pages)*
📦 **Repository:** https://github.com/jmsjbeb/oceanproof
📄 **Project statement:** [PROJECT_STATEMENT.md](docs/PROJECT_STATEMENT.md) · [Data & AI statement](docs/DATA_AI_STATEMENT.md) · [Validation plan](docs/VALIDATION_PLAN.md)
🎬 **Demo video (174s):** Chinese narration with bilingual subtitles — distributed via the competition submission form

---

## The problem

Since August 2023, the Fukushima Daiichi plant has been discharging ALPS-treated water into the Pacific on a schedule running roughly 30 years. Two very different groups face this:

- **Coastal fishers** (Zhejiang, Fujian, Shandong) — losing orders to import bans and consumer avoidance. A test result that is *safe* cannot be re-sold: the market reads headlines, not dose.
- **Inland consumers** (Chengdu, Xi'an) — carrying the same reputational cost, with no way to check the water story their customers repeat.

Nobody gives either group a location-specific, verifiable answer. Worse, the public conversation mixes a negligible radiological risk together with a total economic shock — which is exactly backwards.

## The core design: two ledgers, never mixed

| | Radiological ledger | Livelihood ledger |
|---|---|---|
| **Headline** | ~6 orders of magnitude below the WHO drinking-water guideline | stress index 78/100 |
| **Scale** | logarithmic | linear |
| **Unit** | millisievert (aggregate pathway dose) | dimensionless index |
| **Meaning** | a physical quantity | a constructed signal from published trade/price data |
| **Colour** | purple `#C084FC` | teal `#2FE3C0` |

They sit side by side and are **never averaged into a single risk score** — dose and economic harm are not commensurable, and collapsing them would be a lie.

> **Fishermen lose _orders_, not _doses_.** Both statements must be made together, or neither is useful.

## How it works

1. **Physical advection first.** Lagrangian particle tracking (60,000 ocean particles / 600,000 atmospheric particles) driven by NOAA CoastWatch 0.25° measured surface currents and NCEP/NCAR reanalysis winds. No model guesses where the water goes.
2. **Then the dose pathway.** A concentration field feeds a food-chain model (water → algae → fish), reported in millisievert on a log scale, using IAEA TRS-472 concentration factors and ICRP 72 dose coefficients.
3. **Then the ledger.** Radiological result beside livelihood index — side by side, never merged.

Coverage: **65 refined coastal sites** plus **3,241 administrative districts** nationwide, searchable by name.

## Honest uncertainty

Our calibration constant itself only carries **order-of-magnitude** meaning. Therefore:

- every figure is reported as a **magnitude range**, not a decimal
- every value carries a **provenance tag**: `measured` / `modeled` / `estimated` / `schematic`
- the boundary is printed on every page: **screening-level, not an early-warning system, not a monitoring station**

### What AI deliberately does *not* do here

- **No simulated monitoring feed.** China's coastal tritium monitoring is not published as an open API, so we do not fake one.
- **No seven-digit precision.** A single uncertainty figure of ~1 order of magnitude cannot support it.
- **No unified risk score.** See above.
- **No political framing.** Only physical transport, dose physics, and market observation.

## Data sources

| Source | Use | Status |
|---|---|---|
| NOAA CoastWatch 0.25° currents | surface current field | measured |
| NCEP/NCAR reanalysis | wind field | modeled |
| DataV (Aliyun) | 3,241 administrative boundaries | public |
| IAEA / TEPCO discharge reports | release point & schedule | published |
| IAEA TRS-472 | concentration factors | literature |
| ICRP 72 | dose coefficients | literature |
| UNSCEAR | background levels | literature |
| Ministry of Agriculture | agricultural / food standards | published |

## Data freshness

The site is a **snapshot, not a live feed**. It issues zero network requests at runtime: every field is precomputed at build time and shipped as a `.js` file, which is why it works offline.

Two consequences, both stated in the app:

- The **arrival dates do not change day to day.** They come from three calibrated transport paths anchored to published literature (240 d China coast / 1200 d North America), not from today's current field. The time anchor (`days since 2023-08-24`) is computed in the browser, so the UI moves from "expected in N days" to "inside the impact window for N days" by itself.
- What *does* age: wholesale prices, the ocean current field, and the discharge round counter. The in-app **Data Freshness** page lists every source with its date, refresh cadence, and the script that produces it — stale items turn amber, then purple, on their own.

`tools/` contains the full pipeline (`fetch_currents.py`, `fetch_prices.py`, `track_atmos.py`, `fetch_mean_flow.py`, `build_manifest.py`). One command refreshes the snapshot:

```bash
python tools/refresh.py          # prices + currents + manifest + single-file build
```

Every step fails independently: if a source is unreachable, the previous file is kept and the site keeps working.

## Tech

Zero-dependency, zero-build static site. Vanilla JS + CSS, no framework, no bundler, no external CDN — it runs from `file://` and from GitHub Pages identically.

```
index.html      # app shell
model.js        # arrival time + concentration core
app.js          # UI orchestration
admin.js        # methodology / provenance views
currents.js     # current field data
field.js        # concentration field
flowmap.js      # transport trajectory rendering
meanflow.js     # mean flow field
atmos_f.js      # atmospheric pathway
boundary.js     # administrative boundaries
land.js         # land polygons
prices.js       # price / trade signals
data.js         # curated datasets
styles.css
```

## Run locally

```bash
# any static server works, or just open the file
python -m http.server 8000
# → http://localhost:8000
```

## Citation

If this work informs your research, please cite it and refer to the underlying data providers above.

## License

MIT — see [LICENSE](LICENSE). The code is open; the data belongs to its providers.
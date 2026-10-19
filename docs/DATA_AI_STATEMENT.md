# Data & AI Statement — OceanProof (海证)

**Project:** OceanProof · AI4Climate Global Youth Climate Solutions Challenge 2026
**Track:** Open Track (coastal resilience / marine food safety)

---

## 1. Data sources

| Data | Source | Resolution / coverage | Provenance tag in product |
|---|---|---|---|
| Surface currents | NOAA CoastWatch, global 0.25° ocean current product | 0.25° grid, monthly snapshots | **Measured** |
| Atmospheric winds | NCEP/NCAR Reanalysis 1 | 2.5°, 6-hourly | **Measured** (reanalysis) |
| Coastline geometry | Natural Earth 1:10m; national boundary outline from DataV GeoAtlas (official administrative divisions) | Vector | **Reference** |
| Administrative units | DataV GeoAtlas: 34 provincial, 363 prefecture, 2,840 county-level units (3,237 total) | Vector + centroid | **Reference** |
| Wholesale seafood prices | Ministry of Agriculture and Rural Affairs public price releases | Weekly, market-level | **Measured** |
| Fukushima release inventory | TEPCO / IAEA review reports (public) | Annual totals | **Measured** (published) |
| Concentration factor (CF) and dose coefficients | IAEA TRS-472 (CF ≈ 1 for tritium in fish muscle); ICRP Publication 72 | Literature constants | **Model input** |
| Environmental tritium baseline | UNSCEAR global fallout and natural background ranges | Order-of-magnitude | **Estimated** |

We deliberately do **not** claim real-time monitoring data: China's coastal tritium monitoring is not published as an open API. The product states this explicitly instead of implying a live feed.

## 2. Models and AI methods

**(a) Ocean transport — Lagrangian particle tracking.** 60,000 particles released at the discharge point, advected by the NOAA 0.25° measured surface current field, with horizontal diffusion. Arrival time per location is derived from the first-arrival distribution of particles, reported as a range rather than a single date.

**(b) Atmospheric pathway — Lagrangian moisture transport.** 600,000 particles tracked in NCEP/NCAR 6-hourly winds to estimate the dilution factor for inland locations (e.g. Chengdu f ≈ 1.7×10⁻⁴; Shanghai f ≈ 2.4×10⁻³). Used only for inland sites where ocean transport does not apply.

**(c) Concentration field.** Multi-release accumulation model over the 30-year discharge schedule, rendered as an accumulation band along the transport trajectory — not as a uniform "everything is contaminated" field.

**(d) Food-chain and dose conversion.** Water concentration → fish muscle concentration (CF) → ingestion dose (ICRP 72) → comparison against natural background (UNSCEAR) and the WHO drinking-water guidance value.

**(e) Dual ledger output.** A radiological ledger (log scale) and a livelihood ledger (linear scale) computed separately, because the two questions — "is it dangerous" and "am I losing income" — have different answers and must not be blended.

## 3. Uncertainty handling — the core design decision

Our central calibration constant C₀ has an uncertainty of roughly one order of magnitude. We therefore:

- report results as **magnitude ranges** (e.g. "10⁻³ – 10⁻¹ Bq/L", "about 6–7 orders of magnitude below the WHO guideline"), never as 7-significant-digit figures;
- attach a **provenance tag** (measured / modeled / estimated / schematic) to every number shown in the interface;
- state the tool's boundary on every page: **screening-level, not an early-warning system**.

This is a deliberate trade: we give up apparent precision in exchange for defensible claims.

## 4. Tools

Static web application (HTML/CSS/vanilla JavaScript), no backend required, deployable as a single static site. Data preprocessing in Python (NumPy/SciPy). No personal data is collected; the demo runs entirely client-side.

## 5. Limitations and safe-use boundaries

- Screening-level accuracy only; not suitable for individual health decisions, food-safety certification, or emergency alerts.
- Ocean model is 0.25° — it resolves the Kuroshio Extension and mesoscale eddies only partially; coastal sub-grid processes are not resolved.
- Livelihood stress index is an expert-weighted composite, not an econometric estimate.
- Administrative-district values use provincial average industry weights and are labelled "estimate" in the interface.
- All output should be read as a range with its provenance tag, not as a measurement.

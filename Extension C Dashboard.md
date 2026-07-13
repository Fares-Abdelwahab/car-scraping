# Extension C — Data Analysis & Dashboard

A Power BI dashboard built on the scraped ContactCars listings, covering price distribution, depreciation, regional pricing, and the dealer-vs-private market split.

## How to view it

The finished report is `car_market_dashboard.pbix` — open it directly in Power BI Desktop, no setup required. It's built on `data/cars_report.csv` (committed to this repo), so it opens and works immediately without any database connection or credentials.

## How to reproduce it from scratch

1. The data originates from a normalized PostgreSQL schema (see `Database schema` and `Extension Planning Log.md` for how it was built) via a flattened reporting view, `cars_report`.
2. `scraper/export_csv.js` exports that view to `data/cars_report.csv`, applying a few data-quality filters (see below) — running it requires your own Postgres connection string in a `.env` file (`DATABASE_URL=...`).
3. In Power BI Desktop: **Get Data → Text/CSV** → select `data/cars_report.csv` → **Load**.
4. Charts: price distribution (binned histogram), price vs. mileage (binned line — a raw scatter of 6,000+ points was tried first and was unreadable, so mileage is bucketed the same way price is), average price by model year, crashed vs. non-crashed average price, dealer vs. private average price, and average price by governorate.

**Data cleaning applied** (in `export_csv.js`'s export query, so every chart reflects it): rows are excluded if `mileage` is missing or above 575,000 km (the real 99th percentile is ~500,000 km — anything past that was overwhelmingly placeholder/joke values like `999999999` and repeated exact `999999`, see the planning log for the full investigation), if `crashes` is unrecorded, if `year` is beyond 2026, or if `price` exceeds 10,000,000 EGP. Final dataset: 6,150 of the original 6,733 scraped listings.

## Insights

**1. Dealers operate in a different market segment, not just a markup.** Within the same age band, dealer-listed cars average 70-105% more than private-seller listings — e.g. for 2020-2024 model years, private sellers average ~1.62M EGP while dealers average ~3.30M EGP. That gap is too large and too consistent across every age band to be a simple markup on comparable inventory; it's better explained by dealers specializing in a higher-end segment of the market (newer, imported, or premium vehicles), while private sellers dominate the everyday used-car space.

**2. Depreciation is steep and remarkably consistent, not front-loaded.** Cars lose roughly 45-50% of their value every 5 years, regardless of how old they already are: a 2024-model car averages ~2.59M EGP, a 2019-model averages ~1.35M EGP (a 48% drop), and a 2014-model averages ~770K EGP (a 43% drop from there). The rate of depreciation barely changes with age — this is proportional decay, not a curve that flattens out for older cars.

**3. Cairo carries a substantial, standalone regional premium.** Cairo-listed cars average 1.41M EGP, versus 850K-915K EGP in the next-largest markets (Alexandria, Damietta, Port Said) — a 55-66% premium before accounting for any difference in make or model mix. Geography alone is a meaningful price signal in this market, likely reflecting Cairo's concentration of wealth and dealer activity.

**4. Crash disclosure is rare and expensive — noted with an honest caveat.** Only 13 of 6,150 listings (0.2%) disclose crash history, and those average 358,000 EGP versus 1,174,911 EGP for cars with no disclosed crashes — a ~70% gap. The sample is too thin (n=13) to be definitive, but the direction and size of the gap both suggest crash disclosure carries a real cost to sellers, which may itself explain why so few volunteer it.

**Concrete "best value" examples**, surfaced by comparing each car's price and mileage against others of the same model year: a 2023 Suzuki Van at 510,000 EGP with only 800 km, a 2021 Hyundai Verna at 290,000 EGP with 2,000 km, and a 2022 Suzuki SuperCarry at 420,000 EGP with 6,000 km — all priced well below the typical car of their age and mileage.

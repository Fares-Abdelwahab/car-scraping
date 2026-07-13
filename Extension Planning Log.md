# Extension Planning Log

Planning notes for the two extensions built on top of the base scraper: **Extension B** (full-stack REST API + frontend with search/filter and a comparison view) and **Extension C** (data analysis + BI dashboard). Both share one foundation: a properly normalized relational schema built from the scraped car data, so this log mostly covers how that schema came together.

## Field Discovery

The original scraper only kept 6 of the ~50 fields the ContactCars search API actually returns per listing (`make`, `model`, `year`, `price`, `mileage`, plus a synthetic `url`). Before designing anything, I pulled one raw, unfiltered page straight from the API to see everything actually available, and grouped it:

- **Core**: make/model (id + English/Arabic name), year, price, mileage
- **Specs**: body shape, transmission, fuel type, color, cylinder count, engine capacity, engine description (free text)
- **Condition flags** (17 booleans): `inWarranty`, `imported`, `factoryPaint`, `almostNew`, `crashes`, `firstOwner`, `agencyMaintenance`, `newTires`, `newBrakePads`, `recentMaintenance`, `sellerOwnedLicense`, `protectionFilm`, `nanoCeramic`, `forExchange`, `taxi`, `forDisabled`, `installmentsContinued`
- **Location**: governorate + area
- **Seller**: dealer object (name/phone/type) or `null` for a private listing
- **Financing**: lowest monthly installment, downpayment info
- Dropped: photos, contact numbers (PII, no analytical value), internal ranking/premium metadata, `currency` (always `EGP` — every row in the existing dataset confirmed this, so it's a constant, not a variable)

## Decoding the coded ID fields

`bodyShapeId`, `transmissionId`, `fuelTypeId`, `colorId`, `engineCapacity`, and `governorateId`/`areaId` are all bare numeric codes in the API response — no label attached, unlike `make`/`model` which include `nameEn`. The site's own filter UI doesn't expose a public enum/lookup endpoint I could find.

The fix: every car's **detail page** (`/en/used-cars/{make}-{model}/{id}`) renders human labels for these same codes in its "Specs Summary" section, because the frontend has to show something readable to a person. So for one Peugeot 5008 listing (id `5d6cbed95aa7`), cross-referencing the raw API values against that same car's detail page gave:

| Field | Raw code | Decoded label |
|---|---|---|
| `bodyShapeId` | 8 | SUV |
| `transmissionId` | 2 | Automatic |
| `fuelTypeId` | 1 | Gas |
| `colorId` | 3 | Blue |
| `governorateId` / `areaId` | 1 / 431 | Cairo, Maadi |

Notably, `engineCapacity: 8` on that same car decoded to **"1600 CC"** on the detail page — confirming it's a coded/bucketed field too, not a raw CC number as it first appeared.

This also incidentally validated something I'd been unsure about: the scraper's synthetic `url` field (built from `make`/`model`/`id`) turned out to exactly match the site's real detail-page URL pattern.

Plan to build the full lookup table: collect every distinct value seen for each coded field, find one example car per value, visit its detail page, and record the label — a one-time discovery task, not something that needs to run on every scrape.

## Schema design — mistakes caught along the way

Designing the normalized schema surfaced a few classic mistakes worth remembering:

1. **Repeated text instead of a lookup table.** First drafts had `make` and `model` as two plain text columns on one table, and `city`/`area` the same way — meaning `"Toyota"` or `"Cairo"` would be duplicated once per row that shared it. Fixed by splitting each into a parent table (id + name only) and a child table (id + FK back to parent + its own name), with the *main* table always pointing at the most specific child (`Models`, `Location`/area), never the parent directly.
2. **Wrong foreign-key direction.** Location was accidentally modeled with the "one" side (city) holding a single FK to the "many" side (area) — which can't represent one city having multiple areas. The FK belongs on the "many" side, pointing back to the "one" side.
3. **Avoided over-normalizing the boolean flags.** The instinct was to put the 17 condition flags into a separate `car_features` table (one row per car per flag). Correct call was to leave them as plain columns on `Cars` — normalization eliminates *shared, repeated facts* (like a make's name), not independent single-valued attributes that just happen to share the same `true`/`false` value across unrelated rows.
4. **NULL over a sentinel value.** For private-seller listings with no dealer, the first instinct was a placeholder `dealer_id = 0`. Used a nullable foreign key instead — that's exactly what NULL is for, and avoids needing a fake "no dealer" row.
5. **Non-atomic column.** `financing_numbers` started as one column meant to hold several distinct facts (installment estimate, downpayment amount, whether financing is offered). Split into four explicit columns.

## Final schema

10 tables: `Cars` (main), `Makes`, `Models`, `Colors`, `Shape`, `Transmission`, `Fuel`, `EngineCap`, `Location_city`, `Location` (area-level), `Dealer`. Full column-level definitions live in `Database schema`.

## Database engine

**PostgreSQL, hosted on Supabase** — the scraper currently uses SQLite, but chose Postgres for the extensions specifically to learn it. Supabase is used purely as a free hosted Postgres instance (no local install/upkeep, reachable for later demos) — deliberately *not* using its auto-generated REST API, since Extension B's evaluation criteria is specifically about hand-designing routes, status codes, and validation. A custom Flask/Express-style API still sits in front of the same database.

## BI tool

**Power BI** — the assignment explicitly allows it as a Superset alternative. Chosen over Superset for speed (drag-and-drop, no Docker setup) given where things are starting from on the frontend/BI side.

## Status snapshot

- [x] Field discovery + decoding technique validated
- [x] Normalized schema designed and reviewed
- [x] DB engine chosen (PostgreSQL via Supabase)
- [x] BI tool chosen (Power BI)
- [x] Write real `CREATE TABLE` SQL (all 10 tables live in Supabase Postgres)
- [x] Row Level Security enabled on all tables (deny-by-default; app connects via the DB password, which bypasses RLS anyway)
- [x] Lookup-table discovery script (`scraper/build_lookups.js`) — scans all listings, decodes every coded field via detail pages, outputs `scraper/lookups.json`. Hit and worked through: Cloudflare blocking rapid detail-page navigation (fixed with `puppeteer-extra` + stealth plugin), and a location-parsing bug from multiple "posted X ago" timestamps on one page. 4 of ~30 governorate entries are missing `city` — genuinely incomplete source listings, not a script bug; left as known gaps rather than over-investing further.
- [x] Load raw scrape + `lookups.json` into the actual Postgres schema — 6,733 cars loaded (`scraper/load_cars.js`), lookup tables seeded (`scraper/seed_lookups.js`), verified end-to-end with a join query across every table. `location.area` intentionally left NULL (see scope note above); a few schema constraints (NOT NULL / UNIQUE) had to be relaxed on `shape`, `enginecap`, `location_city`, and `location` to allow genuinely-unknown decoded values.
- [ ] Extension B: deprioritized due to time constraints, may not be attempted
- [x] Postgres connected via a `cars_report` view (joins all 10 tables into one flat, analysis-ready table) — normalized schema stays intact for the real app, denormalized view is purely for reporting.
- [x] Power BI's native Postgres connector hit an unresolved SSL certificate error (Npgsql-vs-Supabase cert chain, no separately-installed Npgsql found on this machine to explain it) — worked around by exporting `cars_report` to `data/cars_report.csv` (`scraper/export_csv.js`, uses Node's `pg` driver directly, unaffected by the Npgsql issue) and importing that into Power BI as a static file. Documented as a known limitation rather than further debugging, given time constraints. CSV is committed to the repo so the dashboard is reproducible without DB credentials.
- [x] Data cleaning pass on `cars.mileage`, in two rounds: (1) placeholder/joke values on the high end (`999999999`, `111111111`, repeated exact `999999` across 19 listings) — nulled anything ≥1,000,000 or exactly `999999`. (2) Found while building a "best value" example list: 500 cars (7% of the dataset) showed <300km despite being 2+ years old, clustered around suspicious round numbers (200, 250, 220...) — same placeholder problem on the low end. Nulled mileage <300 for any car with year ≤2024, preserving genuinely-plausible low mileage on current-model-year (2025/2026) cars. Checked `price`, `year`, and financing fields too — all genuinely clean, no fix needed there.
- [x] Built 6 charts (price distribution, mileage-vs-price as a binned line after the raw scatter proved unreadable at 6,150 points, avg price by year, crashed vs not, dealer vs private, avg price by governorate), combined onto one dashboard page, saved as `car_market_dashboard.pbix`.
- [x] Feedback pass: fixed blank/stray categories, added data labels to bar/column charts, replaced the overplotted scatter with a binned line chart.
- [x] Further CSV-level cleanup (in `export_csv.js`'s query, so it's baked into every chart): excluded mileage >575,000 (thin tail beyond the real p99 of ~500k), crashes IS NULL (3 rows), year >2026, price >10,000,000 (reverses the earlier "keep price outliers as-is" call — a deliberate reconsideration after seeing the actual charts, not an oversight). Final dataset: 6,150 rows.
- [x] Final insights (recomputed against the fully-filtered dataset to match what the dashboard actually shows): dealer/private market-segment gap (~70-105%), consistent ~45-50% price depreciation every 5 years, Cairo regional premium (~55-66% over the next-largest markets), and a heavily-caveated crash-discount note (n=13, ~70% gap). Plus 3 concrete "best value" example cars from the mileage/price relationship.
- [ ] Write reproduce-the-dashboard instructions doc + final commit (CSV + .pbix + insights write-up)

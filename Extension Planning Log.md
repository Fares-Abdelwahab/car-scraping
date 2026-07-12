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

**PostgreSQL** — the scraper currently uses SQLite, but chose Postgres for the extensions specifically to learn it; it's also the more natural fit for whatever BI tool ends up powering Extension C.

## Status snapshot

- [x] Field discovery + decoding technique validated
- [x] Normalized schema designed and reviewed
- [x] DB engine chosen (PostgreSQL)
- [ ] Write real `CREATE TABLE` SQL
- [ ] Build the lookup-table discovery script + rewritten scrape/load pipeline
- [ ] Extension B: REST API, frontend, run-locally docs
- [ ] Extension C: BI dashboard, charts, insights, reproduce docs

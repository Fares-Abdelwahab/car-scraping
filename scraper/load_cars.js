const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const axios = require('axios');
const pool = require('./db');

// In-run caches so we don't re-issue an identical upsert for every car that
// shares a make/model/dealer/area we've already seen this run.
const seenMakes = new Set();
const seenModels = new Set();
const seenDealers = new Set();
const seenLocations = new Set();

async function upsertMakeModel(item) {
    if (!seenMakes.has(item.make.id)) {
        await pool.query(
            `INSERT INTO makes (make_id, make_name) VALUES ($1, $2) ON CONFLICT (make_id) DO NOTHING`,
            [item.make.id, item.make.nameEn]
        );
        seenMakes.add(item.make.id);
    }

    if (!seenModels.has(item.model.id)) {
        await pool.query(
            `INSERT INTO models (model_id, make_id, model_name) VALUES ($1, $2, $3) ON CONFLICT (model_id) DO NOTHING`,
            [item.model.id, item.make.id, item.model.nameEn]
        );
        seenModels.add(item.model.id);
    }
}

async function upsertDealer(item) {
    if (!item.dealer) return null;

    if (!seenDealers.has(item.dealer.dealerId)) {
        await pool.query(
            `INSERT INTO dealer (dealer_id, name, phone, type) VALUES ($1, $2, $3, $4) ON CONFLICT (dealer_id) DO NOTHING`,
            [item.dealer.dealerId, item.dealer.name, item.dealer.phone, item.dealer.dealerType]
        );
        seenDealers.add(item.dealer.dealerId);
    }
    return item.dealer.dealerId;
}

async function upsertLocation(item) {
    const { areaId, governorateId } = item.location || {};
    if (!areaId || !governorateId) return null;

    if (!seenLocations.has(areaId)) {
        // area name intentionally left NULL -- we only decoded a handful of
        // example areas per governorate, not every distinct area (see planning log)
        await pool.query(
            `INSERT INTO location (location_id, location_city_id, area) VALUES ($1, $2, NULL) ON CONFLICT (location_id) DO NOTHING`,
            [areaId, governorateId]
        );
        seenLocations.add(areaId);
    }
    return areaId;
}

function detailUrl(item) {
    const make = item.make.nameEn.toLowerCase().replace(/ /g, '_');
    const model = item.model.nameEn.toLowerCase().replace(/ /g, '_');
    return `https://www.contactcars.com/en/used-cars/${make}-${model}/${item.id}`;
}

async function insertCar(item) {
    if (!item.id || !item.make?.id || !item.model?.id) return false;

    await upsertMakeModel(item);
    const dealerId = await upsertDealer(item);
    const locationId = await upsertLocation(item);

    const info = item.additionalInfo || {};

    const result = await pool.query(
        `INSERT INTO cars (
            model_id, color_id, body_shape_id, transmission_id, fuel_type_id, engine_capacity_id,
            location_id, dealer_id, year, price, mileage,
            lowest_monthly_installment, is_downpayment, downpayment_amount, contact_downpayment_amount,
            scraped_at, in_warranty, imported, factory_paint, almost_new, crashes, first_owner,
            agency_maintenance, new_tires, new_brake_pads, recent_maintenance, seller_owned_license,
            protection_film, nano_ceramic, for_exchange, taxi, for_disabled, installments_continued,
            url, engine_description
        ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
            $23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35
        )
        ON CONFLICT (url) DO NOTHING`,
        [
            item.model.id, item.colorId, item.bodyShapeId, item.transmissionId, item.fuelTypeId, item.engineCapacity,
            locationId, dealerId, item.year, item.price, item.kilometers,
            item.lowestMonthelyInstallment, item.isDownpayment, item.downpaymentAmount, item.contactDownpaymentAmount,
            new Date().toISOString(), info.inWarranty, info.imported, info.factoryPaint, info.almostNew, info.crashes, info.firstOwner,
            info.agencyMaintenance, info.newTires, info.newBrakePads, info.recentMaintenance, info.sellerOwnedLicense,
            info.protectionFilm, info.nanoCeramic, info.forExchange, info.taxi, info.forDisabled, info.installmentsContinued,
            detailUrl(item), item.engineDescription
        ]
    );

    return result.rowCount > 0;
}

async function main() {
    const startPage = parseInt(process.argv[2], 10) || 1;

    console.log('[*] Booting up headless browser to steal session tokens...');
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36');

    let stolenHeaders = {};
    try {
        const requestPromise = page.waitForRequest(
            req => req.url().includes('/gateway/vehicles/classifiedAdsSearch/search') && req.method() === 'GET',
            { timeout: 15000 }
        );
        await page.goto('https://www.contactcars.com/en/used-cars', { waitUntil: 'domcontentloaded' });
        const interceptedReq = await requestPromise;
        stolenHeaders = interceptedReq.headers();
        console.log('[+] Successfully extracted security headers!');
    } catch (err) {
        console.error('[-] Failed to steal headers:', err.message);
        await browser.close();
        return;
    }
    await browser.close();

    const cleanHeaders = { ...stolenHeaders };
    delete cleanHeaders['accept-encoding'];
    delete cleanHeaders['content-length'];

    let currentPage = startPage;
    let hasMorePages = true;
    let totalNew = 0;

    while (hasMorePages) {
        console.log(`\n[*] Fetching page ${currentPage}...`);
        const apiUrl = `https://api.contactcars.com/gateway/vehicles/classifiedAdsSearch/search?carStatus=3&pageIndex=${currentPage}&sortBy=&sortOrder=false&pageSize=26`;

        try {
            const response = await axios.get(apiUrl, { headers: cleanHeaders });
            const data = response.data.result || {};
            const items = data.items || [];

            if (items.length === 0) {
                console.log(`[!] No items on page ${currentPage}. Done.`);
                break;
            }

            let inserted = 0;
            for (const item of items) {
                if (await insertCar(item)) inserted++;
            }
            totalNew += inserted;
            console.log(`[+] Page ${currentPage}: ${inserted}/${items.length} new cars saved (running total: ${totalNew})`);

            hasMorePages = data.hasNextPage;
            if (!hasMorePages) {
                console.log(`[+] No more pages after page ${currentPage}.`);
                break;
            }
        } catch (err) {
            console.error(`[-] Request failed on page ${currentPage}:`, err.response?.status || err.message);
            break;
        }

        const sleepMs = Math.random() * 1000;
        await new Promise(r => setTimeout(r, sleepMs));
        currentPage++;
    }

    await pool.end();
    console.log('\n[+] Load complete!');
}

main().catch(console.error);

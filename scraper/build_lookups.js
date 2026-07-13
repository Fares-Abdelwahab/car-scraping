const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const axios = require('axios');
const fs = require('fs');

const FIELDS = ['bodyShapeId', 'transmissionId', 'fuelTypeId', 'colorId', 'engineCapacity', 'governorateId'];

// Which visible label precedes each field's value on a detail page, and how
// many lines after the label the value spans (Engine Capacity is "1600" / "CC").
const LABELS = {
    bodyShapeId: { label: 'Body Shape', lines: 1 },
    transmissionId: { label: 'Transmission', lines: 1 },
    fuelTypeId: { label: 'Fuel Type', lines: 1 },
    colorId: { label: 'Color', lines: 1 },
    engineCapacity: { label: 'Engine Capacity', lines: 2 },
};

const firstSeen = {};
for (const field of FIELDS) {
    firstSeen[field] = {};
}

function detailUrl(car) {
    const make = car.make.toLowerCase().replace(/ /g, '_');
    const model = car.model.toLowerCase().replace(/ /g, '_');
    return `https://www.contactcars.com/en/used-cars/${make}-${model}/${car.id}`;
}

async function scrapeLabel(page, url, label, linesToTake = 1) {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    const lines = (await page.evaluate(() => document.body.innerText))
        .split('\n')
        .map(l => l.trim());

    const idx = lines.indexOf(label);
    if (idx === -1 || idx + linesToTake >= lines.length) return null;
    return lines.slice(idx + 1, idx + 1 + linesToTake).join(' ');
}

async function scrapeLocation(page, url, make, model) {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    const lines = (await page.evaluate(() => document.body.innerText))
        .split('\n')
        .map(l => l.trim());

    // The page can have multiple "X ago" timestamps (e.g. a "similar cars"
    // section), so only search for one after this car's own title line --
    // otherwise we can match someone else's listing further down the page.
    const titleNeedle = `${make} ${model}`.toLowerCase();
    const titleIdx = lines.findIndex(l => l.toLowerCase().includes(titleNeedle));
    const searchFrom = titleIdx === -1 ? 0 : titleIdx;

    const agoIdx = lines.findIndex((l, i) => i >= searchFrom && /ago$/i.test(l));
    if (agoIdx < 1) return null;

    const before = lines[agoIdx - 1];
    if (before.includes(',')) {
        const [area, city] = before.split(',').map(p => p.trim()).filter(Boolean);
        return { area, city };
    }

    if (agoIdx < 2) return null;
    return { area: lines[agoIdx - 2].replace(/,$/, '').trim(), city: before };
}

async function decodeLookups(firstSeen) {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36');

    const decoded = {};

    for (const [field, { label, lines }] of Object.entries(LABELS)) {
        decoded[field] = {};
        for (const [code, car] of Object.entries(firstSeen[field])) {
            const value = await scrapeLabel(page, detailUrl(car), label, lines);
            decoded[field][code] = value;
            console.log(`  ${field}[${code}] = ${value}`);
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
        }
    }

    decoded.governorateId = {};
    for (const [code, car] of Object.entries(firstSeen.governorateId)) {
        const location = await scrapeLocation(page, detailUrl(car), car.make, car.model);
        decoded.governorateId[code] = location;
        console.log(`  governorateId[${code}] = ${JSON.stringify(location)}`);
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
    }

    await browser.close();
    return decoded;
}

async function main() {
    if (fs.existsSync('scraper/first_seen.json')) {
        console.log('[*] Found scraper/first_seen.json -- skipping the page scan, decoding straight away.');
        const firstSeen = JSON.parse(fs.readFileSync('scraper/first_seen.json', 'utf8'));
        const decoded = await decodeLookups(firstSeen);
        fs.writeFileSync('scraper/lookups.json', JSON.stringify(decoded, null, 2));
        console.log('\n[+] Saved scraper/lookups.json');
        return;
    }

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

    let currentPage = 1;
    let hasMorePages = true;

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

            for (const item of items) {
                item.governorateId = item.location.governorateId;

                for (const field of FIELDS) {
                    const code = item[field];
                    if (!(code in firstSeen[field])) {
                        firstSeen[field][code] = { id: item.id, make: item.make.nameEn, model: item.model.nameEn };
                    }
                }
            }

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

    fs.writeFileSync('scraper/first_seen.json', JSON.stringify(firstSeen, null, 2));
    console.log(`\n[*] Found ${Object.values(firstSeen).reduce((n, m) => n + Object.keys(m).length, 0)} distinct codes across all fields. Saved scraper/first_seen.json. Decoding labels from detail pages...\n`);

    const decoded = await decodeLookups(firstSeen);

    fs.writeFileSync('scraper/lookups.json', JSON.stringify(decoded, null, 2));
    console.log('\n[+] Saved scraper/lookups.json');
}

main().catch(console.error);

const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const Database = require('better-sqlite3');
const { createObjectCsvWriter } = require('csv-writer');

class CarDataPipeline {
    constructor(dbPath = 'cars.db', csvPath = 'cars.csv') {
        this.dbPath = dbPath;
        this.csvPath = csvPath;
        this.db = null;
        this.csvWriter = null;
        this.seenUrls = new Set(); // To track duplicates in-memory
    }

    init() {
        this.db = new Database(this.dbPath);
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS used_cars (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                make TEXT,
                model TEXT,
                year INTEGER,
                price REAL,
                mileage INTEGER,
                currency TEXT,
                url TEXT UNIQUE,
                scraped_at TEXT
            )
        `);

        // Seed in-memory dedup with everything already saved, so resumed/rerun
        // scrapes don't re-append cars the DB already has into the CSV.
        for (const row of this.db.prepare('SELECT url FROM used_cars').all()) {
            this.seenUrls.add(row.url);
        }

        this.csvWriter = createObjectCsvWriter({
            path: this.csvPath,
            header: [
                { id: 'make', title: 'MAKE' },
                { id: 'model', title: 'MODEL' },
                { id: 'year', title: 'YEAR' },
                { id: 'price', title: 'PRICE' },
                { id: 'mileage', title: 'MILEAGE_KM' },
                { id: 'currency', title: 'CURRENCY' },
                { id: 'url', title: 'URL' },
                { id: 'scraped_at', title: 'SCRAPED_AT' }
            ],
            append: fs.existsSync(this.csvPath)
        });
    }

    async saveRecords(cars) {
        if (!cars || cars.length === 0) return;

        // Filter out duplicates before saving
        const uniqueCars = cars.filter(car => {
            if (this.seenUrls.has(car.url)) {
                return false;
            }
            this.seenUrls.add(car.url);
            return true;
        });

        if (uniqueCars.length === 0) return;

        // INSERT OR IGNORE prevents crashes if the DB already has this URL
        const insertStmt = this.db.prepare(`
            INSERT OR IGNORE INTO used_cars (make, model, year, price, mileage, currency, url, scraped_at)
            VALUES (@make, @model, @year, @price, @mileage, @currency, @url, @scraped_at)
        `);

        const insertMany = this.db.transaction((records) => {
            for (const record of records) {
                insertStmt.run(record);
            }
        });

        insertMany(uniqueCars);

        try {
            await this.csvWriter.writeRecords(uniqueCars);
        } catch (err) {
            console.error(`[-] CSV Error: ${err.message}`);
        }
    }

    close() {
        if (this.db) this.db.close();
    }
}

class ContactCarsScraper {
    constructor(pipeline) {
        this.pipeline = pipeline;
        this.baseUrl = 'https://www.contactcars.com/en/used-cars';
    }

    normalizeCarSchema(items) {
        const cleaned = [];

        for (const item of items) {
            const make = item.make?.nameEn || 'Unknown';
            const model = item.model?.nameEn || 'Unknown';

            if (make === 'Unknown' && model === 'Unknown') continue;
            if (!item.id) continue;

            cleaned.push({
                make: make,
                model: model,
                year: item.year || null,
                price: item.price ?? null,
                // Here is the magic fix!
                mileage: item.kilometers ?? 0,
                currency: 'EGP',
                url: `https://www.contactcars.com/en/used-cars/${make.toLowerCase().replace(/ /g, '_')}-${model.toLowerCase().replace(/ /g, '_')}/${item.id}`,
                scraped_at: new Date().toISOString()
            });
        }
        return cleaned;
    }

    async run(startPage = 1) {
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

            await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
            const interceptedReq = await requestPromise;
            stolenHeaders = interceptedReq.headers();
            
            console.log('[+] Successfully extracted security headers!');
        } catch (err) {
            console.error('[-] Failed to steal headers:', err.message);
            await browser.close();
            return;
        }

        await browser.close();
        console.log('[*] Browser closed. Switching to high-speed Axios API requests...');

        const cleanHeaders = { ...stolenHeaders };
        delete cleanHeaders['accept-encoding']; 
        delete cleanHeaders['content-length'];

        let currentPage = startPage;
        let hasMorePages = true;

        while (hasMorePages) {
            console.log(`\n[*] Fetching Page ${currentPage} via API...`);
            const apiUrl = `https://api.contactcars.com/gateway/vehicles/classifiedAdsSearch/search?carStatus=3&pageIndex=${currentPage}&sortBy=&sortOrder=false&pageSize=26`;
            
            try {
                const response = await axios.get(apiUrl, { headers: cleanHeaders });
                const data = response.data.result || {};
                const items = data.items || [];
                
                if (items.length === 0) {
                    console.log(`[!] No items found on page ${currentPage}. Reached the end of the inventory!`);
                    break;
                }

                const cleanedCars = this.normalizeCarSchema(items);
                console.log(`[+] Captured ${cleanedCars.length} cars from API. Saving to database...`);

                await this.pipeline.saveRecords(cleanedCars);

                // The API politely tells us when we are done!
                hasMorePages = data.hasNextPage;
                if (!hasMorePages) {
                    console.log(`[+] API indicates no more pages after page ${currentPage}. Scraping complete!`);
                    break;
                }

            } catch (err) {
                console.error(`[-] API Request failed for page ${currentPage}:`, err.response?.status || err.message);
                // If we get blocked (e.g. 403 or 429), break the loop so we don't spam them
                break;
            }
            
            // Shortened from 2-5s: that jitter was triggering server errors around page 76
            const sleepMs = Math.random() * 1000;
            console.log(`[*] Sleeping for ${(sleepMs / 1000)} seconds to evade bot detection...`);
            await new Promise(r => setTimeout(r, sleepMs));

            currentPage++;
        }
    }
}

async function main() {
    // Resume a crashed/interrupted run with: node scraper.js <page>
    const startPage = parseInt(process.argv[2], 10) || 1;

    const pipeline = new CarDataPipeline('cars.db', 'cars.csv');
    pipeline.init();

    const scraper = new ContactCarsScraper(pipeline);

    console.log(`[*] Starting scrape from page ${startPage}...`);
    await scraper.run(startPage);

    pipeline.close();
    console.log('\n[+] Scraping run complete!');
}

main().catch(console.error);
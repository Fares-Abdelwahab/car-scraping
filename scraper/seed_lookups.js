const fs = require('fs');
const pool = require('./db');

const TABLES = {
    bodyShapeId: { table: 'shape', idCol: 'body_shape_id', nameCol: 'body_shape' },
    transmissionId: { table: 'transmission', idCol: 'transmission_id', nameCol: 'transmission' },
    fuelTypeId: { table: 'fuel', idCol: 'fuel_type_id', nameCol: 'fuel_type' },
    colorId: { table: 'colors', idCol: 'color_id', nameCol: 'color' },
    engineCapacity: { table: 'enginecap', idCol: 'engine_capacity_id', nameCol: 'engine_capacity' },
};

async function main() {
    const lookups = JSON.parse(fs.readFileSync('scraper/lookups.json', 'utf8'));

    for (const [field, { table, idCol, nameCol }] of Object.entries(TABLES)) {
        for (const [code, value] of Object.entries(lookups[field])) {
            if (code === 'null') continue; // no code at all -- Cars' FK will just be NULL for these
            await pool.query(
                `INSERT INTO ${table} (${idCol}, ${nameCol}) VALUES ($1, $2)
                 ON CONFLICT (${idCol}) DO UPDATE SET ${nameCol} = EXCLUDED.${nameCol}`,
                [Number(code), value]
            );
        }
        console.log(`[+] Seeded ${table}`);
    }

    for (const [code, loc] of Object.entries(lookups.governorateId)) {
        if (code === 'null') continue;
        await pool.query(
            `INSERT INTO location_city (location_city_id, city) VALUES ($1, $2)
             ON CONFLICT (location_city_id) DO UPDATE SET city = EXCLUDED.city`,
            [Number(code), loc?.city ?? null]
        );
    }
    console.log('[+] Seeded location_city');

    await pool.end();
}

main().catch(err => {
    console.error('[-] Seed failed:', err.message);
    process.exit(1);
});

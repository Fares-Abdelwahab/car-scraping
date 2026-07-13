const fs = require('fs');
const pool = require('./db');

function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (/[",\n]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

async function main() {
    const result = await pool.query(
        `SELECT * FROM cars_report
         WHERE mileage IS NOT NULL AND mileage <= 575000
           AND crashes IS NOT NULL
           AND year <= 2026
           AND price <= 10000000`
    );
    const rows = result.rows;

    if (rows.length === 0) {
        console.log('[!] No rows found in cars_report.');
        await pool.end();
        return;
    }

    const headers = Object.keys(rows[0]);
    const lines = [headers.join(',')];

    for (const row of rows) {
        lines.push(headers.map(h => csvEscape(row[h])).join(','));
    }

    fs.writeFileSync('data/cars_report.csv', lines.join('\n'));
    console.log(`[+] Exported ${rows.length} rows to data/cars_report.csv`);

    await pool.end();
}

main().catch(err => {
    console.error('[-] Export failed:', err.message);
    process.exit(1);
});

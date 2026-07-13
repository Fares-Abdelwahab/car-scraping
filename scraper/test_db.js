const pool = require('./db');

async function main() {
    const result = await pool.query('SELECT COUNT(*) FROM makes');
    console.log('[+] Connected! makes table row count:', result.rows[0].count);
    await pool.end();
}

main().catch(err => {
    console.error('[-] Connection failed:', err.message);
    process.exit(1);
});

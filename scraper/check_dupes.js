const fs = require('fs');

try {
    // Read the file and split it into lines
    const data = fs.readFileSync('cars.csv', 'utf8').trim().split('\n');
    const urls = new Set();
    let duplicates = 0;

    // Start from index 1 to skip the header row
    for (let i = 1; i < data.length; i++) {
        const columns = data[i].split(',');
        // The URL is the 7th column (index 6)
        if (columns.length > 6) {
            const url = columns[6]; 
            if (urls.has(url)) {
                duplicates++;
            } else {
                urls.add(url);
            }
        }
    }

    console.log(`[*] File: cars.csv`);
    console.log(`[+] Total rows (excluding header): ${data.length - 1}`);
    console.log(`[+] Duplicate URLs found: ${duplicates}`);
    
    if (duplicates === 0) {
        console.log(`\n[+] The deduplication logic worked perfectly!`);
    } else {
        console.log(`\n[-] Wait, we still have duplicates. Something slipped through!`);
    }

} catch (err) {
    console.error(`[-] Error reading cars_2.csv: ${err.message}`);
}
const fs = require('fs');

// Minimal CSV line parser that respects quoted fields (so commas inside a
// quoted price/model don't shift the column indices).
function parseCsvLine(line) {
    const columns = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (inQuotes) {
            if (char === '"' && line[i + 1] === '"') {
                current += '"';
                i++;
            } else if (char === '"') {
                inQuotes = false;
            } else {
                current += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            columns.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    columns.push(current);
    return columns;
}

try {
    // Read the file and split it into lines
    const data = fs.readFileSync('cars.csv', 'utf8').trim().split('\n');
    const urls = new Set();
    let duplicates = 0;

    // Start from index 1 to skip the header row
    for (let i = 1; i < data.length; i++) {
        const columns = parseCsvLine(data[i]);
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
    console.error(`[-] Error reading cars.csv: ${err.message}`);
}

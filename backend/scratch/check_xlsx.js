const xlsx = require('xlsx');

const workbook = xlsx.readFile('Taxas locais Armadores 2026.xlsx');
for (const sheetName of workbook.SheetNames) {
    console.log(`\n--- Sheet: ${sheetName} ---`);
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    if (data.length > 0) {
        console.log('Headers:', Object.keys(data[0]));
        console.log('First 2 rows:', data.slice(0, 2));
    } else {
        console.log('Empty sheet');
    }
}

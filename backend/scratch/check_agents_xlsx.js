const xlsx = require('xlsx');

const workbook = xlsx.readFile('Agentes/Agent List 2025.xlsx');
for (const sheetName of workbook.SheetNames) {
    console.log(`\n--- Sheet: ${sheetName} ---`);
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    if (data.length > 0) {
        console.log('Headers:', Object.keys(data[0]));
        console.log('First 3 rows:', data.slice(0, 3));
    } else {
        console.log('Empty sheet');
    }
}

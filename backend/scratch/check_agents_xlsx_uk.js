const xlsx = require('xlsx');

const workbook = xlsx.readFile('Agentes/Agent List 2025.xlsx');
const sheet = workbook.Sheets['Reino Unido'];
const data = xlsx.utils.sheet_to_json(sheet, { defval: '' });
console.log(JSON.stringify(data.slice(0, 15), null, 2));

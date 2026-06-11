const fs = require('fs');
const path = require('path');
const { parseEml } = require('./src/services/parserService');

async function main() {
  const emlPath = path.join(__dirname, '../ACO/RE_ ADZ _ Imp Air - EXW _ Czech Republic x GRU _ ACO _ ACO032 .eml');
  const buffer = fs.readFileSync(emlPath);
  const text = await parseEml(buffer);
  
  console.log('=== TEXTO DO E-MAIL COMPLETO ===');
  console.log(text);
}

main().catch(console.error);

const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');

async function main() {
  const emlPath = path.join(__dirname, '../../ADZ-QIA26060010/RE_ ADZ _ Rodoviário _ GRU x SJC _ IACIT _ PO 024158 - RFHIC - COTAÇÃO 35008.eml');
  const buffer = fs.readFileSync(emlPath);
  const parsed = await simpleParser(buffer);
  
  console.log('--- E-MAIL RODOVIÁRIO (Corpo completo) ---');
  console.log(parsed.text);
}

main().catch(console.error);

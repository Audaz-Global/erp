const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');

async function main() {
  const emlPath = path.join(__dirname, '../../ADZ-QIA26060010/RE_ ADZ _ Imp Air x EXW _ Korea x GRU _ IACIT _ PO 024158 - RFHIC.eml');
  const buffer = fs.readFileSync(emlPath);
  const parsed = await simpleParser(buffer);
  
  if (parsed.html) {
    fs.writeFileSync(path.join(__dirname, 'eml_html_content.html'), parsed.html);
    console.log('HTML do e-mail salvo em eml_html_content.html');
  } else {
    console.log('Nenhum HTML encontrado.');
  }
}

main().catch(console.error);

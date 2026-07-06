const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');
const pdfParse = require('pdf-parse');

const folder = path.join(__dirname, '../../ADZ-QIA26060010');

let outStr = '';
function log(msg) {
  outStr += msg + '\n';
}

async function inspectFile(filename) {
  const filePath = path.join(folder, filename);
  if (!fs.existsSync(filePath)) {
    log(`Not found: ${filename}`);
    return;
  }
  log(`\n=============================================`);
  log(`PARSING: ${filename}`);
  log(`=============================================`);
  
  const buffer = fs.readFileSync(filePath);
  const parsed = await simpleParser(buffer);
  
  log(`De: ${parsed.from ? parsed.from.text : 'N/A'}`);
  log(`Para: ${parsed.to ? parsed.to.text : 'N/A'}`);
  log(`Assunto: ${parsed.subject}`);
  log(`Data: ${parsed.date}`);
  log(`\n--- CORPO ---`);
  log(parsed.text ? parsed.text : 'N/A');
  
  if (parsed.attachments && parsed.attachments.length > 0) {
    log(`\n--- ANEXOS ---`);
    for (const att of parsed.attachments) {
      log(`Nome: ${att.filename} (${att.contentType}) - Size: ${att.size} bytes`);
      if (att.contentType === 'application/pdf') {
        try {
          const pdfData = await pdfParse(att.content);
          log(`[CONTEÚDO DO PDF ${att.filename}]:`);
          log(pdfData.text);
        } catch (e) {
          log(`[Erro ao ler PDF ${att.filename}]: ${e.message}`);
        }
      }
    }
  }
}

async function main() {
  const files = [
    'RE_ ADZ _ Imp Air x EXW _ Korea x GRU _ IACIT _ PO 024158 - RFHIC.eml',
    'RE_ ADZ _ Rodoviário _ GRU x SJC _ IACIT _ PO 024158 - RFHIC - COTAÇÃO 35008.eml',
    'IACIT - Cotação Frete Aereo PO 024158 - RFHIC.eml'
  ];
  for (const file of files) {
    await inspectFile(file);
  }
  fs.writeFileSync(path.join(__dirname, 'po_emails_output_utf8.txt'), outStr, 'utf8');
  console.log('Saved to po_emails_output_utf8.txt');
}

main().catch(console.error);

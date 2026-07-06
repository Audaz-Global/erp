const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');
const pdfParse = require('pdf-parse');

const folder = path.join(__dirname, '../../ADZ-QIA26060010');

async function main() {
  const files = fs.readdirSync(folder);
  for (const file of files) {
    const filePath = path.join(folder, file);
    console.log(`\n========================================`);
    console.log(`ARQUIVO: ${file}`);
    console.log(`========================================`);
    
    if (file.endsWith('.eml')) {
      const buffer = fs.readFileSync(filePath);
      const parsed = await simpleParser(buffer);
      console.log(`De: ${parsed.from ? (Array.isArray(parsed.from) ? parsed.from.map(f => f.text).join(', ') : parsed.from.text) : ''}`);
      console.log(`Assunto: ${parsed.subject || ''}`);
      console.log(`Corpo (primeiros 1000 caract):`);
      console.log(String(parsed.text || '').substring(0, 1000));
      if (parsed.attachments && parsed.attachments.length > 0) {
        console.log('Anexos encontrados:');
        for (const att of parsed.attachments) {
          console.log(`  - ${att.filename} (${att.contentType}) - ${att.size} bytes`);
        }
      }
    } else if (file.endsWith('.pdf')) {
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      console.log(`Texto do PDF (primeiros 1000 caract):`);
      console.log(data.text.substring(0, 1000));
    }
  }
}

main().catch(console.error);

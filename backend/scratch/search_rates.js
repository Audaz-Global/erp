const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');
const pdfParse = require('pdf-parse');

const folder = path.join(__dirname, '../../ADZ-QIA26060010');

async function main() {
  const files = fs.readdirSync(folder);
  for (const file of files) {
    const filePath = path.join(folder, file);
    if (file.endsWith('.eml')) {
      const buffer = fs.readFileSync(filePath);
      const parsed = await simpleParser(buffer);
      const allText = (parsed.text || '') + ' ' + (parsed.html || '');
      if (allText.includes('12,09') || allText.includes('12.09') || allText.includes('8.70') || allText.includes('8,70')) {
        console.log(`ENCONTRADO NO E-MAIL: ${file}`);
      }
    }
  }
}

main().catch(console.error);

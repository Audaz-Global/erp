const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');

async function main() {
  const emlPath = path.join(__dirname, '../../ADZ-QIA26060010/RE_ ADZ _ Imp Air x EXW _ Korea x GRU _ IACIT _ PO 024158 - RFHIC.eml');
  
  if (!fs.existsSync(emlPath)) {
    console.error(`Arquivo não encontrado em: ${emlPath}`);
    return;
  }
  
  console.log(`Lendo arquivo EML: ${emlPath}`);
  const buffer = fs.readFileSync(emlPath);
  const parsed = await simpleParser(buffer);
  
  if (parsed.attachments && parsed.attachments.length > 0) {
    for (const attachment of parsed.attachments) {
      console.log(`Encontrado anexo: ${attachment.filename} (${attachment.contentType})`);
      const filename = attachment.filename || `attachment_${Date.now()}`;
      const savePath = path.join(__dirname, filename);
      fs.writeFileSync(savePath, attachment.content);
      console.log(`Salvo em: ${savePath}`);
    }
  } else {
    console.log('Nenhum anexo encontrado.');
  }
}

main().catch(console.error);

const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');

async function main() {
  const emlPath = path.join(__dirname, '../../ADZ-QIA26060010/RE_ ADZ _ Rodoviário _ GRU x SJC _ IACIT _ PO 024158 - RFHIC - COTAÇÃO 35008.eml');
  const buffer = fs.readFileSync(emlPath);
  const parsed = await simpleParser(buffer);
  
  if (parsed.attachments && parsed.attachments.length > 0) {
    for (const attachment of parsed.attachments) {
      console.log(`Encontrado anexo: ${attachment.filename} (${attachment.contentType})`);
      const filename = attachment.filename || `attachment_${Date.now()}`;
      const savePath = path.join(__dirname, 'rodov_' + filename);
      fs.writeFileSync(savePath, attachment.content);
      console.log(`Salvo em: ${savePath}`);
    }
  } else {
    console.log('Nenhum anexo encontrado.');
  }
}

main().catch(console.error);

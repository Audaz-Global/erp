const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');

async function main() {
  const emlPath = path.join(__dirname, '../../ADZ-QIA26060010/RE_ ADZ _ Imp Air x EXW _ Korea x GRU _ IACIT _ PO 024158 - RFHIC.eml');
  const buffer = fs.readFileSync(emlPath);
  const parsed = await simpleParser(buffer);
  
  console.log('--- EML Headers ---');
  console.log('Subject:', parsed.subject);
  console.log('From:', parsed.from?.text);
  console.log('To:', parsed.to?.text);
  
  console.log('\n--- Attachments Detail ---');
  if (parsed.attachments) {
    parsed.attachments.forEach((att, idx) => {
      console.log(`[Attachment #${idx}]`);
      console.log(`  Filename: ${att.filename}`);
      console.log(`  ContentType: ${att.contentType}`);
      console.log(`  Disposition: ${att.disposition}`);
      console.log(`  ContentId: ${att.contentId}`);
      console.log(`  Size: ${att.size} bytes`);
    });
  } else {
    console.log('No attachments found.');
  }

  // Verificar se há "12.09" no HTML bruto decodificado por mailparser
  if (parsed.html) {
    console.log('\n--- Buscando "12.09" ou "LH" no HTML decodificado ---');
    console.log('Tem 12.09:', parsed.html.includes('12.09'));
    console.log('Tem 12,09:', parsed.html.includes('12,09'));
    console.log('Tem LH:', parsed.html.includes('LH'));
    console.log('Tem NORMAL:', parsed.html.includes('NORMAL'));
    console.log('Tem FSC:', parsed.html.includes('FSC'));
    
    // Vamos escrever o HTML decodificado para análise
    fs.writeFileSync(path.join(__dirname, 'decoded_body.html'), parsed.html);
  }
}

main().catch(console.error);

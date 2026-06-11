const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');
const pdfParse = require('pdf-parse');
const xlsx = require('xlsx');

async function main() {
  // 1. PDF do pack 3 VW
  const pdfPath = path.join(__dirname, '../VW-MQB 37/5500279920.pdf');
  if (fs.existsSync(pdfPath)) {
    console.log('=== PDF: 5500279920.pdf ===');
    const pdfData = await pdfParse(fs.readFileSync(pdfPath));
    console.log(pdfData.text);
    console.log('\n');
  }
  
  // 2. E-mail com "INVOICE_PACKING LIST"
  const emlPath = path.join(__dirname, '../VW-MQB 37/ENC_ VW-MQB 37 - BATCH 2 -INVOICE_PACKING LIST - SAM - PACK 3 - 5500279920.eml');
  if (fs.existsSync(emlPath)) {
    const emlBuf = fs.readFileSync(emlPath);
    const parsed = await simpleParser(emlBuf);
    
    console.log('=== CORPO DO E-MAIL: INVOICE_PACKING LIST ===');
    console.log(parsed.text || '');
    
    console.log('\n=== ANEXOS ===');
    for (const att of (parsed.attachments || [])) {
      console.log(`\n[Anexo] ${att.filename} | ${att.contentType} | ${att.size} bytes`);
      
      try {
        if (att.contentType === 'application/pdf' || (att.filename && att.filename.toLowerCase().endsWith('.pdf'))) {
          const pdfData = await pdfParse(att.content);
          console.log('--- TEXTO DO PDF ---');
          console.log(pdfData.text);
          
        } else if (
          att.contentType === 'application/vnd.ms-excel' ||
          att.contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
          (att.filename && (att.filename.endsWith('.xls') || att.filename.endsWith('.xlsx')))
        ) {
          const wb = xlsx.read(att.content, { type: 'buffer' });
          wb.SheetNames.forEach(sn => {
            const ws = wb.Sheets[sn];
            const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
            console.log(`\n--- ABA: ${sn} ---`);
            rows.forEach((row, i) => {
              if (row.some(c => c !== '')) {
                console.log(`  Linha ${i+1}: ${JSON.stringify(row)}`);
              }
            });
          });
        }
      } catch(e) {
        console.log('Erro ao processar:', e.message);
      }
    }
  }
  
  // 3. Principal e-mail do PACK 3
  const mainEmlPath = path.join(__dirname, '../VW-MQB 37/ADZ _ Imp Air - FCA _ China x GRU _ GESTAMP _ PACK 3 - 5500279920.eml');
  if (fs.existsSync(mainEmlPath)) {
    const emlBuf = fs.readFileSync(mainEmlPath);
    const parsed = await simpleParser(emlBuf);
    
    console.log('\n=== CORPO DO E-MAIL PRINCIPAL: PACK 3 ===');
    console.log(parsed.text || '');
    
    console.log('\n=== ANEXOS DO EMAIL PRINCIPAL ===');
    for (const att of (parsed.attachments || [])) {
      console.log(`\n[Anexo] ${att.filename} | ${att.contentType} | ${att.size} bytes`);
      
      try {
        if (att.contentType === 'application/pdf' || (att.filename && att.filename.toLowerCase().endsWith('.pdf'))) {
          const pdfData = await pdfParse(att.content);
          console.log('--- TEXTO DO PDF ---');
          console.log(pdfData.text);
          
        } else if (
          att.contentType === 'application/vnd.ms-excel' ||
          att.contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
          (att.filename && (att.filename.endsWith('.xls') || att.filename.endsWith('.xlsx')))
        ) {
          const wb = xlsx.read(att.content, { type: 'buffer' });
          wb.SheetNames.forEach(sn => {
            const ws = wb.Sheets[sn];
            const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
            console.log(`\n--- ABA: ${sn} ---`);
            rows.forEach((row, i) => {
              if (row.some(c => c !== '')) {
                console.log(`  Linha ${i+1}: ${JSON.stringify(row)}`);
              }
            });
          });
        }
      } catch(e) {
        console.log('Erro ao processar:', e.message);
      }
    }
  }
}

main().catch(console.error);

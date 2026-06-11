const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');
const pdfParse = require('pdf-parse');
const xlsx = require('xlsx');

async function inspectEml(emlPath) {
  console.log('\n========================================');
  console.log('ARQUIVO:', path.basename(emlPath));
  console.log('========================================');
  
  const emlBuf = fs.readFileSync(emlPath);
  const parsed = await simpleParser(emlBuf);
  
  console.log('\n--- CORPO DO E-MAIL ---');
  console.log((parsed.text || '').substring(0, 1000));
  
  console.log('\n--- ANEXOS ---');
  const atts = parsed.attachments || [];
  for (const att of atts) {
    console.log(`\n[Anexo] ${att.filename} | ${att.contentType} | ${att.size} bytes`);
    
    try {
      if (att.contentType === 'application/pdf' || (att.filename && att.filename.toLowerCase().endsWith('.pdf'))) {
        const pdfData = await pdfParse(att.content);
        console.log('=== TEXTO DO PDF ===');
        console.log(pdfData.text.substring(0, 3000));
        
        // Procurar linhas com peso
        const lines = pdfData.text.split('\n');
        const weightLines = lines.filter(l => 
          /(\d+[\.,]\d+)\s*(kg|kgs|gross|bruto|weight)/i.test(l) ||
          /peso\s*(bruto|gross|total)/i.test(l) ||
          /gross\s*weight/i.test(l) ||
          /487/i.test(l)
        );
        if (weightLines.length > 0) {
          console.log('\n=== LINHAS COM PESO ===');
          weightLines.forEach(l => console.log(l.trim()));
        }
        
      } else if (
        att.contentType === 'application/vnd.ms-excel' || 
        att.contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        (att.filename && (att.filename.endsWith('.xls') || att.filename.endsWith('.xlsx')))
      ) {
        const workbook = xlsx.read(att.content, { type: 'buffer' });
        workbook.SheetNames.forEach(sheetName => {
          const ws = workbook.Sheets[sheetName];
          const csv = xlsx.utils.sheet_to_csv(ws);
          const lines = csv.split('\n');
          // Filtrar linhas com peso ou 487
          const weightLines = lines.filter(l => 
            /487/i.test(l) || /peso|weight|gross/i.test(l)
          );
          if (weightLines.length > 0) {
            console.log(`\n=== LINHAS COM PESO NA ABA "${sheetName}" ===`);
            weightLines.forEach(l => console.log(l.trim()));
          }
        });
      }
    } catch(e) {
      console.log('Erro ao processar:', e.message);
    }
  }
}

async function main() {
  const dirs = [
    '../ACO',
    '../VW-MQB 37',
    '../Teste de Cotação',
    '../NWCNC26LA061-648'
  ];
  
  for (const dir of dirs) {
    const fullDir = path.join(__dirname, dir);
    if (!fs.existsSync(fullDir)) continue;
    
    const files = fs.readdirSync(fullDir);
    const emlFiles = files.filter(f => f.endsWith('.eml'));
    
    for (const emlFile of emlFiles) {
      await inspectEml(path.join(fullDir, emlFile));
    }
  }
}

main().catch(console.error);

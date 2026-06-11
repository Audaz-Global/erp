const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');
const xlsx = require('xlsx');

async function main() {
  const emlPath = path.join(__dirname, '../ACO/ACO032 - MCASSAB - MAGDA.eml');
  const emlBuf = fs.readFileSync(emlPath);
  const parsed = await simpleParser(emlBuf);

  console.log('=== TODOS OS ANEXOS DO E-MAIL ===');
  (parsed.attachments || []).forEach((att, i) => {
    console.log(`\n[${i+1}] Arquivo: ${att.filename}`);
    console.log(`    contentType: ${att.contentType}`);
    console.log(`    size: ${att.size} bytes`);
  });

  // Encontrar o Excel
  const xlsAtt = (parsed.attachments || []).find(a => 
    a.filename && (a.filename.endsWith('.xls') || a.filename.endsWith('.xlsx'))
  );
  
  if (!xlsAtt) {
    console.log('\nNenhum Excel encontrado!');
    return;
  }
  
  console.log('\n=== CONTEÚDO DO EXCEL:', xlsAtt.filename, '===');
  const workbook = xlsx.read(xlsAtt.content, { type: 'buffer' });
  
  workbook.SheetNames.forEach(sheetName => {
    console.log(`\n--- Aba: "${sheetName}" ---`);
    const ws = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
    rows.forEach((row, i) => {
      if (row.some(c => c !== '')) {
        console.log(`  Linha ${i + 1}: ${JSON.stringify(row)}`);
      }
    });
  });
  
  // Mostrar o CSV que a IA recebe
  console.log('\n=== CSV QUE A IA RECEBE DO EXCEL ===');
  workbook.SheetNames.forEach(sheetName => {
    const ws = workbook.Sheets[sheetName];
    const csvText = xlsx.utils.sheet_to_csv(ws);
    console.log(`Aba ${sheetName}:\n${csvText}`);
  });
}

main().catch(console.error);

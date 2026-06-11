import * as XLSX from 'xlsx';
import * as path from 'path';

async function main() {
  const filePath = path.join(__dirname, '..', 'Taxas locais Armadores 2026.xlsx');
  console.log('Lendo arquivo Excel:', filePath);
  
  const workbook = XLSX.readFile(filePath);
  console.log('Abas disponíveis no Excel:', workbook.SheetNames);
  
  // Vamos ler a primeira linha de cada aba para entender as colunas
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    console.log(`\n--- ABA: ${sheetName} ---`);
    console.log('Primeiras 5 linhas:');
    console.log(json.slice(0, 5));
  }
}

main().catch(console.error);

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../public/index.html');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

function printContext(label, targetIndex, count = 20) {
  console.log(`=== CONTEXTO DE ${label} (Linha ${targetIndex + 1}) ===`);
  const start = Math.max(0, targetIndex - count);
  const end = Math.min(lines.length - 1, targetIndex + count);
  for (let i = start; i <= end; i++) {
    console.log(`${i + 1}: ${lines[i]}`);
  }
  console.log('\n');
}

printContext('SALVAR FASE 1', 1788, 15);
printContext('SALVAR FASE 2', 2198, 20);

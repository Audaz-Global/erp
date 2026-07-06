const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../public/index.html');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

function printContext(label, targetIndex, count = 50) {
  console.log(`=== CONTEXTO DE ${label} (Linhas ${targetIndex - count + 1} a ${targetIndex + count + 1}) ===`);
  const start = Math.max(0, targetIndex - count);
  const end = Math.min(lines.length - 1, targetIndex + count);
  for (let i = start; i <= end; i++) {
    console.log(`${i + 1}: ${lines[i]}`);
  }
  console.log('\n');
}

printContext('MONTAGEM DO BODY DA FASE 2', 2140, 40);

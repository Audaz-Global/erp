const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../public/index.html');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log("Buscando pela declaração de r-type no index.html...");
lines.forEach((line, index) => {
  if (line.includes('id="r-type"') || line.includes("id='r-type'")) {
    console.log(`Linha ${index + 1}: ${line.trim()}`);
    // Imprimir o contexto em volta
    for (let i = Math.max(0, index - 5); i <= Math.min(lines.length - 1, index + 5); i++) {
      console.log(`  ${i + 1}: ${lines[i]}`);
    }
  }
});

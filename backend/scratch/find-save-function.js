const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../public/index.html');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log("Buscando por envios de formulário de revisão...");
lines.forEach((line, index) => {
  if (line.includes('phase') || line.includes('r-freight') || line.includes('rev-freight')) {
    if (line.includes('fetch') || line.includes('function') || line.includes('save') || line.includes('body:')) {
      console.log(`Linha ${index + 1}: ${line.trim()}`);
    }
  }
});

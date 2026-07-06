const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../public/index.html');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log("Buscando modais de edição e botões de gatilho...");
lines.forEach((line, index) => {
  if (line.includes('openPdfReviewModal') || line.includes('editar') || line.includes('editQuotation') || line.includes('modal') || line.includes('rev-')) {
    if (line.includes('function') || line.includes('button') || line.includes('onclick')) {
      console.log(`Linha ${index + 1}: ${line.trim()}`);
    }
  }
});

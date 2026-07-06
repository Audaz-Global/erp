const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'decoded_body.html');
if (!fs.existsSync(htmlPath)) {
  console.log('Arquivo decoded_body.html não encontrado.');
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');
const lines = html.split('\n');

console.log('--- Ocorrências de "LH" no HTML ---');
lines.forEach((line, idx) => {
  if (line.includes('LH')) {
    console.log(`Linha ${idx + 1}: ${line.trim().substring(0, 150)}`);
  }
});

const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'eml_html_content.html');
if (!fs.existsSync(htmlPath)) {
  console.error("Arquivo não encontrado!");
  process.exit(1);
}
const html = fs.readFileSync(htmlPath, 'utf8');

const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
console.log('\n--- Texto limpo do HTML com regex (primeiros 4000 caract) ---');
console.log(text.substring(0, 4000));

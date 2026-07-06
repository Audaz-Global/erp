const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../public/index.html');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log("=== CONTEXTO DA FUNÇÃO DE ABERTURA DE MODAL ===");
for (let i = 1810; i <= 1845; i++) {
  console.log(`${i}: ${lines[i - 1]}`);
}

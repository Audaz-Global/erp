const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../public/index.html');
const content = fs.readFileSync(filePath, 'utf8');

const search = 'freight';
const lines = content.split('\n');

console.log(`Buscando por "${search}"...`);
lines.forEach((line, index) => {
  if (line.toLowerCase().includes(search.toLowerCase())) {
    console.log(`Linha ${index + 1}: ${line.trim()}`);
  }
});

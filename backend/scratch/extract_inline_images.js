const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'decoded_body.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// Encontrar todas as tags <img que tenham src="data:image/...;base64,..."
const imgRegex = /<img[^>]+src=["']data:(image\/[^;]+);base64,([^"']+)["']/g;
let match;
let count = 0;

while ((match = imgRegex.exec(html)) !== null) {
  count++;
  const mimeType = match[1];
  const base64Data = match[2];
  const extension = mimeType.split('/')[1] || 'png';
  const filename = `inline_image_${count}.${extension}`;
  const savePath = path.join(__dirname, filename);
  
  fs.writeFileSync(savePath, Buffer.from(base64Data, 'base64'));
  console.log(`Salvo imagem inline #${count} (${mimeType}) em: ${filename}`);
}

console.log(`Total de imagens inline salvas: ${count}`);

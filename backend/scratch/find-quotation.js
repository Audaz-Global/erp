const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();

async function main() {
  console.log("Conectando ao banco de dados...");
  
  const quotations = await prisma.quotation.findMany({
    where: {
      reference: {
        contains: '024158'
      }
    },
    include: {
      client: true
    }
  });

  let output = `Encontradas ${quotations.length} cotações para '024158':\n`;
  for (const q of quotations) {
    output += "-----------------------------------------\n";
    output += JSON.stringify(q, null, 2) + "\n";
  }

  const filePath = path.join(__dirname, 'query_result_utf8.txt');
  fs.writeFileSync(filePath, output, 'utf8');
  console.log(`Resultado gravado em: ${filePath}`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error("Erro ao executar script:", err);
  process.exit(1);
});

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

// Importar as funções de build transpiladas
const { generatePdf } = require('../dist/services/pdfService');

const prisma = new PrismaClient();

async function main() {
  console.log("Conectando ao banco de dados...");
  
  // 1. Encontrar a cotação SLI/114724
  let quotation = await prisma.quotation.findFirst({
    where: {
      reference: {
        contains: '114724'
      }
    },
    include: {
      client: true
    }
  });

  if (!quotation) {
    console.error("Cotação SLI/114724 não encontrada!");
    return;
  }

  console.log(`Cotação encontrada: ID=${quotation.id}, Ref=${quotation.reference}`);
  
  // 2. Atualizar a cotação com a moeda EUR e valor do frete original 17.28
  console.log("Atualizando cotação com moeda EUR e frete 17.28...");
  quotation = await prisma.quotation.update({
    where: { id: quotation.id },
    data: {
      freightValue: 17.28,
      freightCurrency: 'EUR'
    },
    include: {
      client: true
    }
  });

  console.log(`Cotação atualizada no banco! Freight = ${quotation.freightValue} ${quotation.freightCurrency}`);

  // 3. Chamar generatePdf para testar a renderização com as mudanças dinâmicas
  console.log("Gerando PDF com a moeda original...");
  const host = 'localhost:3000';
  const protocol = 'http';
  const publicWebViewUrl = `${protocol}://${host}/api/quotations/${quotation.id}/view`;

  const pdfBuffer = await generatePdf({
    ...quotation,
    publicWebViewUrl
  });

  const outputPath = path.join(__dirname, 'test_sli_114724_eur.pdf');
  fs.writeFileSync(outputPath, pdfBuffer);
  console.log(`PDF gerado e salvo com sucesso em: ${outputPath}`);
  
  await prisma.$disconnect();
}

main().catch(err => {
  console.error("Erro ao rodar script de teste:", err);
  prisma.$disconnect();
  process.exit(1);
});

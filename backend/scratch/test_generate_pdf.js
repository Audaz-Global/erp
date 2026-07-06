const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { generatePdf } = require('../dist/services/pdfService');
const fs = require('fs');
const path = require('path');

async function main() {
  const quotationId = '6ee53ad0-3daf-4a03-bcc1-3d32bde862d3';
  console.log(`Buscando cotação ${quotationId} no banco...`);
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: { client: true, createdBy: true }
  });
  
  if (!quotation) {
    console.error('Cotação não encontrada no banco!');
    return;
  }
  
  console.log(`Gerando PDF para ${quotation.reference}...`);
  try {
    const pdfBuffer = await generatePdf({
      ...quotation,
      publicWebViewUrl: `http://localhost:3001/api/quotations/${quotation.id}/view`
    });
    
    const outputPath = path.join(__dirname, 'test_output.pdf');
    fs.writeFileSync(outputPath, pdfBuffer);
    console.log(`PDF gerado com sucesso em: ${outputPath}`);
  } catch (error) {
    console.error('Erro ao gerar PDF:', error);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());

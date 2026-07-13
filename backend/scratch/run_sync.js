const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

async function main() {
  const excelPath = path.join(__dirname, '..', '..', 'Taxas locais Armadores 2026.xlsx');
  console.log('Lendo planilha de:', excelPath);

  if (!fs.existsSync(excelPath)) {
    console.error('Planilha não encontrada.');
    return;
  }

  const workbook = xlsx.readFile(excelPath);
  let createdCount = 0;
  let updatedCount = 0;

  for (const sheetName of workbook.SheetNames) {
    const carrierName = sheetName.trim();
    if (!carrierName || ['guide', 'summary', 'capa', 'resumo'].includes(carrierName.toLowerCase())) continue;

    console.log(`Processando armador: ${carrierName}`);

    // Procurar se já existe no banco de dados como ARMADOR
    const existing = await prisma.agent.findFirst({
      where: {
        name: { equals: carrierName, mode: 'insensitive' },
        type: 'ARMADOR'
      }
    });

    if (existing) {
      await prisma.agent.update({
        where: { id: existing.id },
        data: {
          active: true,
          modals: 'SEA_FCL, SEA_LCL',
          origins: 'Global',
          destinations: 'Brasil'
        }
      });
      updatedCount++;
      console.log(`- Atualizado: ${carrierName}`);
    } else {
      await prisma.agent.create({
        data: {
          name: carrierName,
          email: null,
          type: 'ARMADOR',
          modals: 'SEA_FCL, SEA_LCL',
          origins: 'Global',
          destinations: 'Brasil',
          active: true
        }
      });
      createdCount++;
      console.log(`- Criado: ${carrierName}`);
    }
  }

  console.log(`Sincronização concluída! Criados: ${createdCount}, Atualizados: ${updatedCount}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

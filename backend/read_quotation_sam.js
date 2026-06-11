const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const q = await prisma.quotation.findFirst({
    where: {
      reference: {
        contains: 'SAM20260519002'
      }
    }
  });
  if (q) {
    console.log({
      id: q.id,
      reference: q.reference,
      modal: q.modal,
      loadType: q.loadType,
      packages: q.packages,
      totalPackages: q.totalPackages,
      totalGrossWeightKg: q.totalGrossWeightKg,
      totalCbm: q.totalCbm,
      freightValue: q.freightValue,
      iofUsd: q.iofUsd,
      destinationStorage: q.destinationStorage,
      destinationServicesTotal: q.destinationServicesTotal,
      destinationTaxes: q.destinationTaxes,
      totalBrl: q.totalBrl,
      totalUsd: q.totalUsd,
      direction: q.direction,
      status: q.status,
      createdAt: q.createdAt,
      sourceEmails: q.sourceEmails ? q.sourceEmails.substring(0, 500) + '...' : null
    });
  } else {
    console.log('Não encontrado!');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());

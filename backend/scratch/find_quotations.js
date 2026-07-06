const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const quotations = await prisma.quotation.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log('Last 5 quotations in DB:');
  quotations.forEach(q => {
    console.log(`- ID: ${q.id} | Ref: ${q.reference} | Modal: ${q.modal} | Incoterm: ${q.incoterm}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());

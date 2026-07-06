const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("Conectando ao banco...");
  const q = await prisma.quotation.findFirst({
    where: {
      reference: {
        contains: 'IMP077-26'
      }
    },
    include: {
      client: true
    }
  });

  if (!q) {
    console.error("Cotação IMP077-26 não encontrada!");
    return;
  }

  console.log("=== DADOS DA COTAÇÃO IMP077-26 ===");
  console.log("ID:", q.id);
  console.log("Ref:", q.reference);
  console.log("Incoterm:", q.incoterm);
  console.log("Modal:", q.modal);
  console.log("freightValue:", q.freightValue, q.freightCurrency);
  console.log("originServices (JSON):", q.originServices);
  console.log("destinationServices (JSON):", q.destinationServices);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  prisma.$disconnect();
});

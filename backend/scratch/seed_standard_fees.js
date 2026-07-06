const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const standardFees = [
    {
      name: "CCT fee",
      type: "DESTINATION",
      chargeType: "FIXED",
      value: 10.00,
      currency: "USD",
      active: true
    },
    {
      name: "Delivery Fee",
      type: "DESTINATION",
      chargeType: "PER_DOCUMENT",
      value: 55.00,
      currency: "USD",
      active: true
    },
    {
      name: "Desconsolidação / Deconsolidation",
      type: "DESTINATION",
      chargeType: "PER_DOCUMENT",
      value: 55.00,
      currency: "USD",
      active: true
    },
    {
      name: "Collect Fee",
      type: "DESTINATION",
      chargeType: "PERCENTAGE",
      value: 3.00,
      currency: "USD",
      active: true
    },
    {
      name: "IOF - FRETE + TX ORIGEM",
      type: "ORIGIN", // Usually IOF is charged on imports, but we'll set to ORIGIN based on name
      chargeType: "PERCENTAGE",
      value: 3.50,
      currency: "USD",
      active: true
    }
  ];

  for (const fee of standardFees) {
    await prisma.standardFee.create({ data: fee });
    console.log(`Taxa ${fee.name} inserida com sucesso.`);
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

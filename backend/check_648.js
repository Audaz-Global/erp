const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const quote = await prisma.quotation.findUnique({
    where: { id: '7ca5392f-efc8-4df6-b6ad-fd31c756cc96' }
  });
  console.log('carrier:', quote.carrier);
  console.log('loadType:', quote.loadType);
  console.log('packages (dimensions):', quote.packages);
  console.log('reference:', quote.reference);
  console.log('originCity:', quote.originCity);
  console.log('destinationCity:', quote.destinationCity);
  console.log('destinationServicesTotal:', quote.destinationServicesTotal);
  console.log('freightValue:', quote.freightValue);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

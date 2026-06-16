const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.quotation.findMany({
  where: {
    reference: {
      contains: '20260611'
    }
  }
}).then(res => {
  console.log(JSON.stringify(res, null, 2));
}).finally(() => prisma.$disconnect());

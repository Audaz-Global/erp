import { prisma } from '../src/prisma';

const check = async () => {
  const quote = await prisma.quotation.findFirst({ where: { reference: 'AG-TEST-001' } });
  console.log(JSON.stringify(quote, null, 2));
};

check();

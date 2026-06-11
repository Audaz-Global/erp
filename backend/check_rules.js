const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.knowledgeEntry.findMany({ where: { active: true } })
  .then(rules => {
    console.log('REGRAS ATIVAS NO BANCO:');
    rules.forEach((r, i) => {
      console.log(`\n--- Regra ${i + 1}: ${r.title} ---`);
      console.log(r.content);
    });
  })
  .catch(err => console.error(err))
  .finally(() => prisma.$disconnect());

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const entries = await prisma.knowledgeEntry.findMany();
  console.log('=== REGRAS DE CONHECIMENTO CADASTRADAS ===');
  entries.forEach((e, i) => {
    console.log(`\n--- Regra ${i+1}: ${e.title} (Category: ${e.category}) ---`);
    console.log(e.content);
  });
  await prisma.$disconnect();
}

main().catch(console.error);

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const agents = await prisma.agent.findMany();
  console.log('Total de agentes no banco:', agents.length);
  if (agents.length > 0) {
    console.log('Primeiros 3 agentes:');
    console.log(JSON.stringify(agents.slice(0, 3), null, 2));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  try {
    const entries = await prisma.knowledgeEntry.findMany();
    console.log('--- REGRAS DE CONHECIMENTO CADASTRADAS ---');
    entries.forEach(e => {
      console.log(`ID: ${e.id}`);
      console.log(`Título: ${e.title}`);
      console.log(`Categoria: ${e.category}`);
      console.log(`Conteúdo:\n${e.content}`);
      console.log('------------------------------------------');
    });
  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

run();

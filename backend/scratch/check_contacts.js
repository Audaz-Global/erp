const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== VERIFICANDO DADOS DE CLIENTE E CONTATO ===');
  
  // Buscar último cliente criado
  const clients = await prisma.client.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });

  console.log('Últimos 5 clientes cadastrados:');
  clients.forEach(c => {
    console.log(`- ID: ${c.id}`);
    console.log(`  Nome: ${c.name}`);
    console.log(`  CNPJ: ${c.cnpj}`);
    console.log(`  Contato: ${c.contactName}`);
    console.log(`  E-mail: ${c.contactEmail}`);
    console.log(`  Telefone: ${c.contactPhone}`);
    console.log('-----------------------------------');
  });

  // Buscar última cotação com cliente
  const quotation = await prisma.quotation.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { client: true }
  });

  if (quotation) {
    console.log(`Última cotação criada: ${quotation.reference}`);
    console.log(`Cliente associado: ${quotation.client ? quotation.client.name : 'Nenhum'}`);
    if (quotation.client) {
      console.log(`  Nome do Contato: ${quotation.client.contactName}`);
      console.log(`  Telefone do Contato: ${quotation.client.contactPhone}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  prisma.$disconnect();
});

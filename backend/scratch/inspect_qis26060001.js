const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== INSPECTION OF ADZ-QIS26060001 ===');
  
  const quotation = await prisma.quotation.findFirst({
    where: {
      reference: {
        contains: 'QIS26060001'
      }
    },
    include: {
      client: true
    }
  });

  if (!quotation) {
    console.log('Cotação não encontrada no banco com referência contendo QIS26060001');
    // Buscar as últimas cotações para ver o que temos
    const latest = await prisma.quotation.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { client: true }
    });
    console.log('\nÚltimas cotações no banco:');
    latest.forEach(q => {
      console.log(`- ID: ${q.id}, Ref: ${q.reference}, Status: ${q.status}`);
      console.log(`  Origem: ${q.originPort}, Cidade: ${q.originCity}`);
      console.log(`  Conexões: ${q.connections}`);
      console.log(`  Cliente: ${q.client ? q.client.name : 'Nenhum'}`);
      console.log(`  Contato: ${q.client ? q.client.contactName : 'Nenhum'}, Telefone: ${q.client ? q.client.contactPhone : 'Nenhum'}`);
    });
  } else {
    console.log('Cotação encontrada:');
    console.log(JSON.stringify(quotation, null, 2));
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  prisma.$disconnect();
});

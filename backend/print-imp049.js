const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const q = await prisma.quotation.findFirst({
    where: { reference: { contains: 'IMP049' } },
    orderBy: { createdAt: 'desc' }
  });

  if (!q) {
    console.log('Nenhuma cotação com IMP049 encontrada.');
    return;
  }

  console.log('=== DADOS DA COTAÇÃO ===');
  console.log('ID:', q.id);
  console.log('Ref:', q.reference);
  console.log('Incoterm banco:', q.incoterm);
  console.log('Load Type:', q.loadType);
  console.log('Status:', q.status);
  console.log('Emails source (primeiras 300 letras):', q.sourceEmails ? q.sourceEmails.substring(0, 300) : 'vazio');
  if (q.sourceEmails) {
    try {
      const arr = JSON.parse(q.sourceEmails);
      console.log('Email Assunto / Texto:');
      console.log(arr[0] ? arr[0].substring(0, 1000) : 'vazio');
    } catch(e) {
      console.log(q.sourceEmails.substring(0, 1000));
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());

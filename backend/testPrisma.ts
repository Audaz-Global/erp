import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function test() {
  try {
    let testUser = await prisma.user.findUnique({ where: { email: 'teste@audazglobal.com' } });
    if (!testUser) {
      console.log('Creating test user...');
      testUser = await prisma.user.create({
        data: {
          name: 'Usuário de Teste Local',
          email: 'teste@audazglobal.com',
          password: 'senha-fake-nao-usada',
          role: 'ADMIN'
        }
      });
    }
    console.log('User ID:', testUser.id);

    let client = await prisma.client.findFirst({ where: { cnpj: '02.147.467/0005-18' } });
    if (!client) {
      console.log('Creating test client...');
      client = await prisma.client.create({
        data: {
          name: 'GESTAMP BRASIL INDÚSTRIA DE AUTOPEÇAS S A',
          cnpj: '02.147.467/0005-18'
        }
      });
    }
    console.log('Client ID:', client.id);

    console.log('Creating quotation...');
    const q = await prisma.quotation.create({
      data: {
        reference: "TESTE-123",
        direction: "IMPORT",
        modal: "SEA",
        loadType: "LCL",
        createdById: testUser.id,
        clientId: client.id,
        status: "DRAFT"
      }
    });
    console.log('Quotation created!', q.id);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

test();

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const quotation = await prisma.quotation.findFirst({
    where: { reference: { contains: 'QIS26060001' } },
    include: { client: true }
  });

  if (quotation) {
    console.log('--- DADOS DA COTAÇÃO ---');
    console.log('Reference:', quotation.reference);
    console.log('Status:', quotation.status);
    console.log('Origin Port (Aeroporto):', quotation.originPort);
    console.log('Origin City (Cidade):', quotation.originCity);
    console.log('Origin Country (País):', quotation.originCountry);
    console.log('Destination Port:', quotation.destinationPort);
    console.log('Destination City:', quotation.destinationCity);
    console.log('Connections (Conexões):', quotation.connections);
    console.log('Carrier (Cia Aérea):', quotation.carrier);
    
    console.log('\n--- DADOS DO CLIENTE ---');
    if (quotation.client) {
      console.log('Client Name:', quotation.client.name);
      console.log('Client CNPJ:', quotation.client.cnpj);
      console.log('Contact Name:', quotation.client.contactName);
      console.log('Contact Email:', quotation.client.contactEmail);
      console.log('Contact Phone:', quotation.client.contactPhone);
    } else {
      console.log('Nenhum cliente associado.');
    }
  } else {
    console.log('Cotação não encontrada.');
  }

  await prisma.$disconnect();
}

main();

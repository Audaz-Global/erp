const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const prisma = new PrismaClient();

async function main() {
  const q = await prisma.quotation.findFirst({
    where: { reference: { contains: 'IMP049' } },
    orderBy: { createdAt: 'desc' }
  });

  if (!q || !q.sourceEmails) { console.log('Sem dados'); return; }

  const emails = JSON.parse(q.sourceEmails);
  const rawText = emails[0] || '';

  console.log('=== RE-TESTANDO EXTRAÇÃO IMP049-26 COM PROMPT CORRIGIDO ===\n');

  const form = new (require('form-data'))();
  form.append('mode', 'CLIENT');
  form.append('text', rawText);

  const res = await axios.post('http://localhost:3001/api/extract', form, {
    headers: form.getHeaders()
  });

  const data = res.data.data;
  console.log('Incoterm:', data?.route?.incoterm, data?.route?.incoterm === 'EXW' ? '✅ CORRETO!' : '❌ ERRADO (esperado EXW)');
  console.log('Origem:', data?.route?.origin_city, data?.route?.origin_country);
  console.log('Aeroporto Origem:', data?.route?.origin_airport);
  console.log('Modal:', data?.cargo?.type);
}

main().catch(e => console.error('Erro:', e.response?.data || e.message)).finally(() => prisma.$disconnect());

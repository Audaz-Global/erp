const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

async function main() {
  const excelPath = path.join(__dirname, '..', '..', 'Taxas locais Armadores 2026.xlsx');
  console.log('Lendo planilha de:', excelPath);

  if (!fs.existsSync(excelPath)) {
    console.error('Planilha não encontrada.');
    return;
  }

  const workbook = xlsx.readFile(excelPath);
  let createdCount = 0;
  let updatedCount = 0;
  let feesImported = 0;

  for (const sheetName of workbook.SheetNames) {
    const carrierName = sheetName.trim();
    if (!carrierName || ['guide', 'summary', 'capa', 'resumo'].includes(carrierName.toLowerCase())) continue;

    console.log(`Processando armador: ${carrierName}`);

    // 1. Procurar se já existe no banco de dados como ARMADOR
    const existing = await prisma.agent.findFirst({
      where: {
        name: { equals: carrierName, mode: 'insensitive' },
        type: 'ARMADOR'
      }
    });

    if (existing) {
      await prisma.agent.update({
        where: { id: existing.id },
        data: {
          active: true,
          modals: 'SEA_FCL, SEA_LCL',
          origins: 'Global',
          destinations: 'Brasil'
        }
      });
      updatedCount++;
      console.log(`- Atualizado: ${carrierName}`);
    } else {
      await prisma.agent.create({
        data: {
          name: carrierName,
          email: null,
          type: 'ARMADOR',
          modals: 'SEA_FCL, SEA_LCL',
          origins: 'Global',
          destinations: 'Brasil',
          active: true
        }
      });
      createdCount++;
      console.log(`- Criado: ${carrierName}`);
    }

    // 2. Importar as taxas locais da aba do armador correspondente para a tabela FixedFee
    const sheet = workbook.Sheets[sheetName];
    if (sheet) {
      // Limpar taxas anteriores do armador para evitar duplicações
      await prisma.fixedFee.deleteMany({
        where: {
          carrier: { equals: carrierName, mode: 'insensitive' }
        }
      });

      const data = xlsx.utils.sheet_to_json(sheet, { defval: '' });

      for (const row of data) {
        const keys = Object.keys(row);
        if (keys.length < 2) continue;

        let nameField = keys.find(k => k.toLowerCase().includes('taxa') || k.toLowerCase().includes('nome') || k.toLowerCase().includes('fee') || k.toLowerCase().includes('charge')) || keys[0];
        let valueField = keys.find(k => k.toLowerCase().includes('valor') || k.toLowerCase().includes('value') || k.toLowerCase().includes('amount') || k.toLowerCase().includes('ssz')) || keys[1];

        let name = String(row[nameField || ''] || '').trim();
        let valueStr = row[valueField || ''];
        
        if (!name || name === '') continue;
        if (valueStr === undefined || valueStr === '') continue;

        const nameUpper = name.toUpperCase();
        if (
          nameUpper.includes('ADICIONAL') || 
          nameUpper.includes('ADICIONAIS') || 
          nameUpper.includes('ADICONAIS') ||
          nameUpper.includes('ADICIONA')
        ) {
          break;
        }

        let currency = 'BRL'; // Padrão
        if (keys.some(k => k.toLowerCase().includes('moeda'))) {
            currency = row[keys.find(k => k.toLowerCase().includes('moeda'))] || 'BRL';
        } else if (typeof valueStr === 'string' && valueStr.includes('USD')) {
            currency = 'USD';
        }

        let val = 0;
        if (typeof valueStr === 'number') val = valueStr;
        else if (typeof valueStr === 'string') {
            const cleanStr = valueStr.replace(/[^\d,-]/g, '');
            if (cleanStr) val = parseFloat(cleanStr.replace(',', '.'));
        }

        if (!isNaN(val) && val > 0) {
          // Criar registro de 20'
          await prisma.fixedFee.create({
            data: {
              name: name.substring(0, 255).trim(),
              carrier: carrierName.toUpperCase().substring(0, 100).trim(),
              containerSize: "20'",
              type: 'DESTINATION',
              value: val,
              currency: currency.substring(0, 10).toUpperCase().trim(),
              modal: 'SEA_FCL',
              active: true
            }
          });
          feesImported++;

          // Criar registro de 40' se houver na coluna __EMPTY_1
          if (keys.includes('__EMPTY_1') && row['__EMPTY_1'] !== undefined && row['__EMPTY_1'] !== '') {
             let val40 = 0;
             const val40Str = row['__EMPTY_1'];
             if (typeof val40Str === 'number') val40 = val40Str;
             else if (typeof val40Str === 'string') {
                 const cleanStr = val40Str.replace(/[^\d,-]/g, '');
                 if (cleanStr) val40 = parseFloat(cleanStr.replace(',', '.'));
             }
             
             if (!isNaN(val40) && val40 > 0) {
                await prisma.fixedFee.create({
                   data: {
                     name: name.substring(0, 255).trim(),
                     carrier: carrierName.toUpperCase().substring(0, 100).trim(),
                     containerSize: "40'",
                     type: 'DESTINATION',
                     value: val40,
                     currency: currency.substring(0, 10).toUpperCase().trim(),
                     modal: 'SEA_FCL',
                     active: true
                   }
                });
                feesImported++;
             }
          }
        }
      }
    }
  }

  console.log(`Sincronização concluída! Criados: ${createdCount}, Atualizados: ${updatedCount}, Taxas Importadas: ${feesImported}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import * as xlsx from 'xlsx';

const prisma = new PrismaClient();

export const getFixedFees = async (req: Request, res: Response) => {
  try {
    const fees = await prisma.fixedFee.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(fees);
  } catch (error) {
    console.error('Erro ao buscar fixed fees:', error);
    res.status(500).json({ error: 'Erro ao buscar taxas fixas.' });
  }
};

export const createFixedFee = async (req: Request, res: Response) => {
  try {
    const { name, type, value, currency, modal, active } = req.body;
    const fee = await prisma.fixedFee.create({
      data: {
        name,
        type,
        value: Number(value),
        currency: currency || 'USD',
        modal: modal || 'ALL',
        active: active !== undefined ? active : true
      }
    });
    res.status(201).json(fee);
  } catch (error) {
    console.error('Erro ao criar fixed fee:', error);
    res.status(500).json({ error: 'Erro ao criar taxa fixa.' });
  }
};

export const updateFixedFee = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, type, value, currency, modal, active } = req.body;
    
    const fee = await prisma.fixedFee.update({
      where: { id },
      data: {
        name,
        type,
        value: Number(value),
        currency,
        modal,
        active
      }
    });
    res.json(fee);
  } catch (error) {
    console.error('Erro ao atualizar fixed fee:', error);
    res.status(500).json({ error: 'Erro ao atualizar taxa fixa.' });
  }
};

export const deleteFixedFee = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.fixedFee.delete({
      where: { id }
    });
    res.status(204).send();
  } catch (error) {
    console.error('Erro ao excluir fixed fee:', error);
    res.status(500).json({ error: 'Erro ao excluir taxa fixa.' });
  }
};

export const importFixedFeesXlsx = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Nenhum arquivo enviado.' });
      return;
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    let totalImported = 0;

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json<any>(sheet, { defval: '' });

      for (const row of data) {
        let name = row['Nome'] || row['Taxa'] || row['Fee'] || row['Name'] || row['Descrição'] || row['Charge'];
        let valueStr = row['Valor'] || row['Value'] || row['Amount'] || row['Preço'];
        let currency = row['Moeda'] || row['Currency'] || row['Curr'] || 'USD';
        let modal = row['Modal'] || row['Modais'] || 'ALL';
        let type = row['Tipo'] || row['Type'] || row['Origem/Destino'] || 'ORIGIN';
        
        if (sheetName.toLowerCase().includes('destino') || sheetName.toLowerCase().includes('dest')) {
          type = 'DESTINATION';
        } else if (sheetName.toLowerCase().includes('origem') || sheetName.toLowerCase().includes('origin')) {
          type = 'ORIGIN';
        }

        if (name && valueStr !== undefined && valueStr !== '') {
          let val = 0;
          if (typeof valueStr === 'number') val = valueStr;
          else if (typeof valueStr === 'string') {
             // Handle values like "$ 50.00" or "R$ 1.200,00"
             const cleanStr = valueStr.replace(/[^\d,-]/g, '');
             val = parseFloat(cleanStr.replace(',', '.'));
          }

          if (!isNaN(val)) {
            await prisma.fixedFee.create({
              data: {
                name: String(name).substring(0, 255).trim(),
                type: String(type).toUpperCase().includes('DEST') ? 'DESTINATION' : 'ORIGIN',
                value: val,
                currency: String(currency).substring(0, 10).toUpperCase().trim(),
                modal: String(modal).substring(0, 50).toUpperCase().trim(),
                active: true
              }
            });
            totalImported++;
          }
        }
      }
    }

    res.json({ message: `${totalImported} taxas fixas foram importadas com sucesso da planilha!` });
  } catch (error) {
    console.error('Erro ao importar XLSX:', error);
    res.status(500).json({ error: 'Erro ao importar planilha de taxas.' });
  }
};

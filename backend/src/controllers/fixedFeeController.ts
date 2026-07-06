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
      if (!sheet) continue;
      const data = xlsx.utils.sheet_to_json<any>(sheet, { defval: '' });

      for (const row of data) {
        const keys = Object.keys(row);
        if (keys.length < 2) continue;

        // Achar a coluna de Nome (pode ser "TAXAS DE DESTINO", "Nome", "Fee", ou a primeira coluna)
        let nameField = keys.find(k => k.toLowerCase().includes('taxa') || k.toLowerCase().includes('nome') || k.toLowerCase().includes('fee') || k.toLowerCase().includes('charge'));
        if (!nameField) nameField = keys[0];

        // Achar a coluna de Valor (pode ser "SSZ", "Valor", ou a segunda coluna)
        let valueField = keys.find(k => k.toLowerCase().includes('valor') || k.toLowerCase().includes('value') || k.toLowerCase().includes('amount'));
        if (!valueField) valueField = keys[1]; // Ex: 'SSZ' na planilha dos armadores

        let name = row[nameField];
        let valueStr = row[valueField];
        
        if (!name || typeof name !== 'string' || name.trim() === '') continue;
        if (valueStr === undefined || valueStr === '') continue;

        let currency = 'BRL'; // Padrão
        if (keys.some(k => k.toLowerCase().includes('moeda'))) {
            currency = row[keys.find(k => k.toLowerCase().includes('moeda'))!] || 'BRL';
        } else if (typeof valueStr === 'string' && valueStr.includes('USD')) {
            currency = 'USD';
        }
        
        let modal = 'ALL';
        // Se a planilha for de armador (ex: COSCO, HMM, etc), assumir SEA_FCL
        if (['COSCO','ONE','PIL','HMM','CMA','MSC','MAERSK','ZIM','HAPAG','EVERGREEN'].some(m => sheetName.toUpperCase().includes(m))) {
            modal = 'SEA_FCL';
        }

        let type = 'DESTINATION'; 
        if (sheetName.toLowerCase().includes('origem') || sheetName.toLowerCase().includes('origin')) type = 'ORIGIN';
        // Se a coluna 0 tiver "DESTINO", forçar destino
        if (nameField.toLowerCase().includes('destino')) type = 'DESTINATION';

        let val = 0;
        if (typeof valueStr === 'number') val = valueStr;
        else if (typeof valueStr === 'string') {
            const cleanStr = valueStr.replace(/[^\\d,-]/g, '');
            if (cleanStr) val = parseFloat(cleanStr.replace(',', '.'));
        }

        if (!isNaN(val) && val > 0) {
          // Salvar como FCL_20 (ex: "Nome da Taxa (20')") se for do SSZ
          await prisma.fixedFee.create({
            data: {
              name: String(name).substring(0, 255).trim(),
              type: type,
              value: val,
              currency: String(currency).substring(0, 10).toUpperCase().trim(),
              modal: modal,
              active: true
            }
          });
          totalImported++;
          
          // Adicionar para 40' também, que está na coluna __EMPTY_1 normalmente (Heurística específica para planilha de armadores 2026)
          if (keys.includes('__EMPTY_1') && typeof row['__EMPTY_1'] === 'number') {
             await prisma.fixedFee.create({
                data: {
                  name: String(name).substring(0, 240).trim() + " (40')",
                  type: type,
                  value: row['__EMPTY_1'],
                  currency: String(currency).substring(0, 10).toUpperCase().trim(),
                  modal: modal,
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

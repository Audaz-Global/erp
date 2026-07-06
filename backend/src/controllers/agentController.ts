import { Request, Response } from 'express';
import { prisma } from '../prisma';
import * as xlsx from 'xlsx';

export const getAgents = async (req: Request, res: Response) => {
  try {
    const agents = await prisma.agent.findMany({
      orderBy: { name: 'asc' }
    });
    res.json(agents);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createAgent = async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const agent = await prisma.agent.create({
      data: {
        name: data.name,
        email: data.email,
        modals: data.modals || null,
        origins: data.origins || null,
        destinations: data.destinations || null,
        active: data.active !== undefined ? data.active : true,
      }
    });
    res.status(201).json(agent);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateAgent = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const agent = await prisma.agent.update({
      where: { id },
      data: {
        name: data.name,
        email: data.email,
        modals: data.modals,
        origins: data.origins,
        destinations: data.destinations,
        active: data.active,
      }
    });
    res.json(agent);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteAgent = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.agent.delete({ where: { id } });
    res.json({ message: 'Agente deletado com sucesso' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const importAgents = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Nenhum arquivo enviado' });
      return;
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    let imported = 0;
    let errors = 0;

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const data = xlsx.utils.sheet_to_json<any>(sheet, { defval: '' });

      for (const row of data) {
        try {
          const keys = Object.keys(row);
          if (keys.length === 0) continue;

          // Achar a coluna de Nome
          let nameField = keys.find(k => k.toLowerCase().includes('name') || k.toLowerCase().includes('nome') || k.toLowerCase().includes('agent'));
          if (!nameField) nameField = keys[0];

          // Achar a coluna de E-mail
          let emailField = keys.find(k => k.toLowerCase().includes('email') || k.toLowerCase().includes('e-mail'));
          if (!emailField) emailField = keys[1]; // Se não achar, tenta a 2a coluna como chute

          const name = row[nameField];
          const email = row[emailField];
          
          if (!name || !email || typeof name !== 'string' || typeof email !== 'string') {
            errors++;
            continue;
          }

          const modalsField = keys.find(k => k.toLowerCase().includes('modal'));
          const originsField = keys.find(k => k.toLowerCase().includes('origin') || k.toLowerCase().includes('origen'));
          const destinationsField = keys.find(k => k.toLowerCase().includes('destin'));

          await prisma.agent.create({
            data: {
              name: String(name).trim().substring(0, 255),
              email: String(email).trim().substring(0, 255),
              modals: modalsField ? String(row[modalsField]).trim() : null,
              origins: originsField ? String(row[originsField]).trim() : null,
              destinations: destinationsField ? String(row[destinationsField]).trim() : null,
              active: true
            }
          });
          imported++;
        } catch (e) {
          errors++;
        }
      }
    }
    
    res.json({ message: `Importação concluída. Importados: ${imported}. Erros/Ignorados: ${errors}.` });
  } catch (error: any) {
    console.error('Erro ao importar agentes:', error);
    res.status(500).json({ error: error.message });
  }
};

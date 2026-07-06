import { Request, Response } from 'express';
import { prisma } from '../prisma';
import Papa from 'papaparse';

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

export const importAgents = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const csvData = req.file.buffer.toString('utf-8');
    
    Papa.parse(csvData, {
      header: true,
      skipEmptyLines: true,
      complete: async (results: any) => {
        let imported = 0;
        let errors = 0;
        
        for (const row of results.data as any[]) {
          try {
            const name = row['Name'] || row['Nome'] || row['Agent'] || row['Agente'];
            const email = row['Email'] || row['E-mail'] || row['email'];
            
            if (!name || !email) {
              errors++;
              continue;
            }

            await prisma.agent.create({
              data: {
                name: String(name).trim(),
                email: String(email).trim(),
                modals: row['Modals'] || row['Modais'] || row['Modal'] || null,
                origins: row['Origins'] || row['Origens'] || row['Origin'] || null,
                destinations: row['Destinations'] || row['Destinos'] || null,
                active: true
              }
            });
            imported++;
          } catch (e) {
            errors++;
          }
        }
        
        res.json({ message: `Importação concluída. Importados: ${imported}. Erros/Ignorados: ${errors}.` });
      },
      error: (error: any) => {
        res.status(500).json({ error: error.message });
      }
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

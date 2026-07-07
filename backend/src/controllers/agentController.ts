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
        networks: data.networks || null,
        address: data.address || null,
        phone: data.phone || null,
        website: data.website || null,
        contactName: data.contactName || null,
        contactEmail: data.contactEmail || null,
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
        networks: data.networks,
        address: data.address,
        phone: data.phone,
        website: data.website,
        contactName: data.contactName,
        contactEmail: data.contactEmail,
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
      if (['guide', 'summary', 'capa', 'resumo'].includes(sheetName.toLowerCase())) continue;
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const data = xlsx.utils.sheet_to_json<any>(sheet, { defval: '' });
      if (data.length === 0) continue;

      const firstRowKeys = Object.keys(data[0]);
      const hasEmailCol = firstRowKeys.some(k => k.toLowerCase().includes('email') || k.toLowerCase().includes('e-mail'));

      if (hasEmailCol) {
        // --- PARSER TABULAR (CSV/Planilha Padrão) ---
        for (const row of data) {
          try {
            const keys = Object.keys(row);
            if (keys.length === 0) continue;

            let nameField: string = (keys.find(k => k.toLowerCase().includes('name') || k.toLowerCase().includes('nome') || k.toLowerCase().includes('agent')) || keys[0])!;
            let emailField: string = (keys.find(k => k.toLowerCase().includes('email') || k.toLowerCase().includes('e-mail')) || keys[1])!; 

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
      } else {
        // --- PARSER DOCUMENTAL (Agent List 2025) ---
        let currentCompany = '';
        let lastWasBlank = true;
        let companyEmails = new Set<string>();

        const saveCompany = async () => {
          if (currentCompany && companyEmails.size > 0) {
            await prisma.agent.create({
              data: {
                name: currentCompany.substring(0, 255),
                email: Array.from(companyEmails).join('; ').substring(0, 255),
                origins: sheetName,
                destinations: sheetName,
                modals: 'ALL',
                active: true
              }
            });
            imported++;
          }
          currentCompany = '';
          companyEmails.clear();
        };

        for (const row of data) {
          const keys = Object.keys(row);
          if (keys.length === 0) continue;

          const valA = String(row[keys[0]!] || '').trim();
          
          if (!valA) {
              lastWasBlank = true;
          } else {
              // Ignore lines that are just labels or addresses
              if (!valA.toLowerCase().startsWith('office') && 
                  !valA.toLowerCase().startsWith('ph:') && 
                  !valA.toLowerCase().startsWith('unit') &&
                  !valA.toLowerCase().startsWith('http') &&
                  !valA.toLowerCase().startsWith('www.')) {
                  
                  if (lastWasBlank) {
                      await saveCompany();
                      currentCompany = valA;
                      lastWasBlank = false;
                  }
              }
          }

          // Procurar e-mails na linha inteira
          for (const key of keys) {
            const cell = String(row[key] || '').trim();
            if (cell.includes('@') && cell.includes('.')) {
              // Regex para extrair email de dentro do texto
              const match = cell.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi);
              if (match) {
                  match.forEach(e => companyEmails.add(e.toLowerCase()));
              }
            }
          }
        }
        await saveCompany(); // Salvar a última do arquivo
      }
    }
    
    res.json({ message: `Importação concluída. Importados: ${imported}. Erros/Ignorados: ${errors}.` });
  } catch (error: any) {
    console.error('Erro ao importar agentes:', error);
    res.status(500).json({ error: error.message });
  }
};

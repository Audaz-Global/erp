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
        contacts: data.contacts || undefined,
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
        contacts: data.contacts !== undefined ? data.contacts : undefined,
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
            const networksField = keys.find(k => k.toLowerCase().includes('network') || k.toLowerCase().includes('rede'));
            const addressField = keys.find(k => k.toLowerCase().includes('address') || k.toLowerCase().includes('endere'));
            const phoneField = keys.find(k => k.toLowerCase().includes('phone') || k.toLowerCase().includes('telef') || k.toLowerCase().includes('celular'));
            const websiteField = keys.find(k => k.toLowerCase().includes('website') || k.toLowerCase().includes('site'));
            
            const contactField = keys.find(k => k.toLowerCase().includes('contact') || k.toLowerCase().includes('contato') || k.toLowerCase() === 'nome');
            const roleField = keys.find(k => k.toLowerCase().includes('role') || k.toLowerCase().includes('cargo') || k.toLowerCase().includes('title'));

            let parsedContacts: any[] = [];
            if (contactField && row[contactField]) {
               parsedContacts.push({
                 name: String(row[contactField]).trim(),
                 role: roleField && row[roleField] ? String(row[roleField]).trim() : '',
                 email: '',
                 phone: ''
               });
            }

            await prisma.agent.create({
              data: {
                name: String(name).trim().substring(0, 255),
                email: String(email).trim().substring(0, 255),
                modals: modalsField ? String(row[modalsField]).trim() : null,
                origins: originsField ? String(row[originsField]).trim() : null,
                destinations: destinationsField ? String(row[destinationsField]).trim() : null,
                networks: networksField ? String(row[networksField]).trim() : null,
                address: addressField ? String(row[addressField]).trim() : null,
                phone: phoneField ? String(row[phoneField]).trim() : null,
                website: websiteField ? String(row[websiteField]).trim() : null,
                contacts: parsedContacts.length > 0 ? parsedContacts : undefined,
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
        let currentAddress = '';
        let currentPhone = '';
        let currentWebsite = '';
        let parsedContacts: any[] = [];
        let lastPotentialContact = '';

        const saveCompany = async () => {
          if (currentCompany && companyEmails.size > 0) {
            await prisma.agent.create({
              data: {
                name: currentCompany.substring(0, 255),
                email: Array.from(companyEmails).join('; ').substring(0, 255),
                origins: sheetName,
                destinations: sheetName,
                modals: 'ALL',
                address: currentAddress || null,
                phone: currentPhone || null,
                website: currentWebsite || null,
                contacts: parsedContacts.length > 0 ? parsedContacts : undefined,
                active: true
              }
            });
            imported++;
          }
          currentCompany = '';
          companyEmails.clear();
          currentAddress = '';
          currentPhone = '';
          currentWebsite = '';
          parsedContacts = [];
        };

        for (const row of data) {
          const keys = Object.keys(row);
          if (keys.length === 0) continue;

          const valA = String(row[keys[0]!] || '').trim();
          
          if (!valA) {
              lastWasBlank = true;
          } else {
              const valALower = valA.toLowerCase();
              const isAddress = /^\d+/.test(valA) || 
                                valALower.includes('street') || 
                                valALower.includes('road') || 
                                valALower.includes('avenue') || 
                                valALower.includes(' blvd') || 
                                valALower.includes(' st') || 
                                valALower.includes('room ') || 
                                valALower.includes('floor,') ||
                                valALower.includes('building');

              // Ignore lines that are just labels or addresses
              if (!valALower.startsWith('office') && 
                  !valALower.startsWith('ph:') && 
                  !valALower.startsWith('tel:') &&
                  !valALower.startsWith('unit') &&
                  !valALower.startsWith('http') &&
                  !valALower.startsWith('www.') &&
                  !isAddress) {
                  
                  if (lastWasBlank) {
                      await saveCompany();
                      currentCompany = valA;
                      lastWasBlank = false;
                  }
              } else {
                  // Even if it's an address or phone, it's not a blank line
                  lastWasBlank = false;
                  if (valALower.startsWith('http') || valALower.startsWith('www.')) {
                      currentWebsite = valA;
                  } else if (valALower.startsWith('ph:') || valALower.startsWith('tel:') || valALower.startsWith('phone')) {
                      currentPhone = valA;
                  } else if (isAddress || valALower.startsWith('office') || valALower.startsWith('unit') || valALower.startsWith('add:')) {
                      if (currentAddress) {
                          currentAddress += ', ' + valA;
                      } else {
                          currentAddress = valA;
                      }
                  } else if (!valA.includes('@')) {
                      // Se não é email, endereço, telefone ou site, pode ser o nome de um contato!
                      lastPotentialContact = valA;
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
                  match.forEach(e => {
                    const emailFound = e.toLowerCase();
                    companyEmails.add(emailFound);
                    
                    let cName = '';
                    let cRole = '';
                    
                    // Tentar extrair do mesmo texto da célula (ex: "Sandro (Manager) sandro@cn.com")
                    let cellWithoutEmail = cell.replace(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi, '').trim();
                    if (!cellWithoutEmail && lastPotentialContact) {
                      cellWithoutEmail = lastPotentialContact;
                    }
                    
                    if (cellWithoutEmail && !cellWithoutEmail.toLowerCase().startsWith('http') && !cellWithoutEmail.toLowerCase().startsWith('www')) {
                      const parts = cellWithoutEmail.split(/[-/()]/).map(p=>p.trim()).filter(Boolean);
                      if (parts.length > 0 && parts[0]) cName = parts[0].replace(/^(Attn:|Pic:|Contact:)/i, '').trim();
                      if (parts.length > 1 && parts[1]) cRole = parts[1];
                      
                      const exists = parsedContacts.find(c => c.email === emailFound);
                      if (!exists) {
                         console.log("-> EXTRAÍDO CONTATO:", { name: cName, role: cRole, email: emailFound });
                         parsedContacts.push({ name: cName, role: cRole, email: emailFound, phone: '' });
                      }
                    } else {
                      console.log("-> FALHA AO EXTRAIR NOME:", cellWithoutEmail);
                    }
                  });
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

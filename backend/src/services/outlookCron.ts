import { fetchUnreadEmails, markEmailAsRead } from './outlookService';
import { prisma } from '../prisma';
import { extractAgentCosts } from './aiService';

export const startOutlookWatcher = () => {
  console.log('👀 Iniciando watcher de e-mails do Outlook...');
  
  // Roda a cada 3 minutos
  setInterval(async () => {
    try {
      const emails = await fetchUnreadEmails();
      if (!emails || emails.length === 0) return;

      console.log(`[Outlook] Encontrou ${emails.length} mensagens não lidas.`);

      for (const email of emails) {
        const subject = email.subject || '';
        // O body completo costuma ser em HTML, o preview é um texto curto.
        // A IA lida bem com HTML/Texto.
        const bodyContent = email.body?.content || email.bodyPreview || '';
        
        // Procurar por "REF: [REFERENCIA]" no assunto
        const refMatch = subject.match(/REF:\s*([A-Za-z0-9-]+)/i);
        
        if (refMatch) {
          const reference = refMatch[1].trim();
          console.log(`[Outlook] E-mail recebido com REF: ${reference}`);
          
          // Tentar achar a cotação pela referência exata OU pelo ID (prefixo)
          const quotation = await prisma.quotation.findFirst({
            where: {
              OR: [
                { reference: reference },
                { id: { startsWith: reference.toLowerCase() } }
              ]
            }
          });
          
          if (quotation) {
             console.log(`[Outlook] Cotação encontrada! ID: ${quotation.id}. Extraindo custos...`);
             try {
                // Monta o payload mínimo para a IA
                const payload = {
                  route: {
                    origin_country: quotation.originCountry,
                    origin: quotation.originCity || quotation.originPort,
                    destination: quotation.destinationCity || quotation.destinationPort
                  },
                  cargo: {
                    type: quotation.loadType,
                    gross_weight_kg: quotation.totalGrossWeightKg
                  }
                };

                const costs = await extractAgentCosts(bodyContent, '', '', JSON.stringify(payload), []);
                
                if (costs) {
                  // Aqui no futuro podemos salvar o JSON de custos direto na cotação
                  // Para já, mudamos o status para avisar que chegou
                  await prisma.quotation.update({
                    where: { id: quotation.id },
                    data: { 
                      status: 'RETORNO_RECEBIDO'
                    }
                  });
                  console.log(`[Outlook] Retorno processado com sucesso para cotação ${quotation.id}`);
                }
             } catch(e) {
                console.error('[Outlook] Erro ao extrair custos via IA:', e);
             }
          } else {
             console.log(`[Outlook] Cotação não encontrada no banco para REF: ${reference}`);
          }
        }
        
        // Marcar como lido para não baixar novamente no próximo ciclo
        await markEmailAsRead(email.id);
      }
    } catch(err) {
      console.error('[Outlook Watcher] Erro no ciclo:', err);
    }
  }, 180000); // 3 minutos
};

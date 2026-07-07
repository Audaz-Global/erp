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
                
                if (costs && costs.costs) {
                  const c = costs.costs;
                  
                  // Mapeia os dados da IA para as colunas do banco
                  const updateData: any = {
                    status: 'RETORNO_RECEBIDO',
                    costsData: JSON.stringify(c),
                  };

                  if (c.freight_value != null) updateData.freightValue = c.freight_value;
                  if (c.freight_currency) updateData.freightCurrency = c.freight_currency;
                  if (c.freight_usd != null) updateData.totalUsd = c.freight_usd;
                  if (c.iof_usd != null) updateData.iofUsd = c.iof_usd;
                  if (c.storage_brl != null) {
                    updateData.destinationStorage = c.storage_brl;
                    updateData.destinationStorageCurrency = 'BRL';
                  }
                  if (c.services_brl != null) updateData.destinationServicesTotal = c.services_brl;
                  if (c.taxes_brl != null) {
                    updateData.destinationTaxes = c.taxes_brl;
                    updateData.destinationTaxesCurrency = 'BRL';
                  }
                  if (c.total_brl != null) updateData.totalBrl = c.total_brl;
                  
                  if (c.carrier) updateData.carrier = c.carrier;
                  if (c.transit_time_days != null) updateData.transitTimeDays = c.transit_time_days;
                  if (c.frequency) updateData.frequency = c.frequency;
                  if (c.weight_break) updateData.weightBreak = c.weight_break;
                  
                  if (Array.isArray(c.origin_fees) && c.origin_fees.length > 0) {
                    updateData.originServices = JSON.stringify(c.origin_fees);
                  }
                  if (Array.isArray(c.destination_fees) && c.destination_fees.length > 0) {
                    updateData.destinationServices = JSON.stringify(c.destination_fees);
                  }
                  if (c.insurance_requested === true) {
                    updateData.requiresInsurance = true;
                  }
                  if (c.invoice_value && c.invoice_value > 0) {
                    updateData.commercialValue = c.invoice_value;
                  }

                  await prisma.quotation.update({
                    where: { id: quotation.id },
                    data: updateData
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

import { fetchUnreadEmails, markEmailAsRead } from './outlookService';
import { prisma } from '../prisma';
import { extractAgentCosts } from './aiService';

/**
 * Camada 1: Busca cotação pelo REF: no assunto do e-mail.
 * Método mais confiável — matching direto por reference ou prefixo do ID.
 */
async function matchByReference(subject: string) {
  const refMatch = subject.match(/REF:\s*([A-Za-z0-9-]+)/i);
  if (!refMatch) return null;

  const reference = refMatch[1]!.trim();
  console.log(`[Outlook Match] Camada 1 — REF encontrada no assunto: ${reference}`);

  const quotation = await prisma.quotation.findFirst({
    where: {
      OR: [
        { reference: reference },
        { id: { startsWith: reference.toLowerCase() } }
      ]
    }
  });

  if (quotation) {
    console.log(`[Outlook Match] ✅ Camada 1 — Cotação ${quotation.id} encontrada por REF`);
  }
  return quotation;
}

/**
 * Camada 2: Busca cotação pelo conversationId da thread do MS Graph.
 * Funciona quando o agente responde na mesma thread (reply/reply-all).
 */
async function matchByConversationId(conversationId: string | undefined) {
  if (!conversationId) return null;

  const quotation = await prisma.quotation.findFirst({
    where: {
      sentEmailConversationId: conversationId,
      status: 'AGUARDANDO_AGENTE'
    }
  });

  if (quotation) {
    console.log(`[Outlook Match] ✅ Camada 2 — Cotação ${quotation.id} encontrada por ConversationId`);
  }
  return quotation;
}

/**
 * Camada 3: Busca cotação pelo e-mail do remetente.
 * Só faz match se houver EXATAMENTE 1 cotação pendente para aquele agente.
 * Se houver múltiplas cotações pendentes, retorna null (ambiguidade).
 */
async function matchBySenderEmail(senderEmail: string | undefined) {
  if (!senderEmail) return null;

  const pendingQuotations = await prisma.quotation.findMany({
    where: {
      agentEmail: { contains: senderEmail, mode: 'insensitive' as const },
      status: 'AGUARDANDO_AGENTE'
    }
  });

  if (pendingQuotations.length === 1) {
    console.log(`[Outlook Match] ✅ Camada 3 — Cotação ${pendingQuotations[0]!.id} encontrada por remetente (match único)`);
    return pendingQuotations[0]!;
  }

  if (pendingQuotations.length > 1) {
    console.log(`[Outlook Match] ⚠️ Camada 3 — ${pendingQuotations.length} cotações pendentes para ${senderEmail}. Pulando (ambiguidade).`);
  }

  return null;
}

/**
 * Camada 4: Busca referência da cotação dentro do corpo/assunto do e-mail.
 * Procura padrões como ADZ-QIA26060010, QIS26060117, QIA26060065, etc.
 */
async function matchByBodyReference(subject: string, bodyContent: string) {
  const fullText = `${subject} ${bodyContent}`;

  // Padrões de referência conhecidos: ADZ-QIA/QIS/QIR + 8 dígitos ou variações
  const patterns = [
    /(?:ADZ-)?Q[IA][ASIR]\d{8}/gi,       // QIA26060010, QIS26060117, ADZ-QIA26060021
    /NWCNC\d{2}[A-Z]{2}\d{3}-\d+/gi,     // NWCNC26LA061-648
    /IMP-?\d{3,}/gi,                       // IMP049, IMP-077
  ];

  for (const pattern of patterns) {
    const matches = fullText.match(pattern);
    if (matches) {
      for (const match of matches) {
        const ref = match.trim();
        console.log(`[Outlook Match] Camada 4 — Referência encontrada no corpo: ${ref}`);
        
        const quotation = await prisma.quotation.findFirst({
          where: {
            OR: [
              { reference: ref },
              { reference: { contains: ref, mode: 'insensitive' as const } }
            ]
          }
        });

        if (quotation) {
          console.log(`[Outlook Match] ✅ Camada 4 — Cotação ${quotation.id} encontrada por referência no corpo`);
          return quotation;
        }
      }
    }
  }

  return null;
}

/**
 * Orquestra as 4 camadas de matching em sequência (fallback).
 * Retorna a cotação vinculada ou null se nenhuma camada encontrar.
 */
async function findQuotationForEmail(email: any) {
  const subject = email.subject || '';
  const bodyContent = email.body?.content || email.bodyPreview || '';
  const senderEmail = email.from?.emailAddress?.address?.toLowerCase();
  const conversationId = email.conversationId;

  // Camada 1: REF no assunto
  const q1 = await matchByReference(subject);
  if (q1) return { quotation: q1, matchLayer: 1 };

  // Camada 2: ConversationId (thread tracking)
  const q2 = await matchByConversationId(conversationId);
  if (q2) return { quotation: q2, matchLayer: 2 };

  // Camada 3: E-mail do remetente (match único)
  const q3 = await matchBySenderEmail(senderEmail);
  if (q3) return { quotation: q3, matchLayer: 3 };

  // Camada 4: Referência no corpo do e-mail
  const q4 = await matchByBodyReference(subject, bodyContent);
  if (q4) return { quotation: q4, matchLayer: 4 };

  return null;
}

/**
 * Processa um e-mail vinculado a uma cotação:
 * extrai custos via IA e atualiza o banco de dados.
 */
async function processMatchedEmail(email: any, quotation: any, matchLayer: number) {
  const bodyContent = email.body?.content || email.bodyPreview || '';

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
        agentResponseRaw: bodyContent.substring(0, 50000), // Limita para não estourar o campo
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
      console.log(`[Outlook] ✅ Retorno processado | Cotação: ${quotation.id} | REF: ${quotation.reference} | Camada: ${matchLayer} | Assunto: "${email.subject}"`);
    }
  } catch(e) {
    console.error(`[Outlook] ❌ Erro ao extrair custos via IA para cotação ${quotation.id}:`, e);
  }
}

export const startOutlookWatcher = () => {
  console.log('👀 Iniciando watcher de e-mails do Outlook (matching inteligente em 4 camadas)...');
  
  // Set para rastrear e-mails não vinculados já logados (evita logs repetitivos)
  const loggedUnmatchedIds = new Set<string>();
  
  // Roda a cada 3 minutos
  setInterval(async () => {
    try {
      const emails = await fetchUnreadEmails();
      if (!emails || emails.length === 0) return;

      console.log(`[Outlook] Encontrou ${emails.length} mensagens não lidas.`);

      for (const email of emails) {
        const result = await findQuotationForEmail(email);
        
        if (result) {
          const { quotation, matchLayer } = result;
          
          // Processar e-mail vinculado
          await processMatchedEmail(email, quotation, matchLayer);
          
          // Marcar como lido somente após processamento bem-sucedido
          await markEmailAsRead(email.id);
          loggedUnmatchedIds.delete(email.id); // Limpar do set se estava lá
        } else {
          // E-mail não vinculado: NÃO marcar como lido (pode ser processado no próximo ciclo)
          if (!loggedUnmatchedIds.has(email.id)) {
            const sender = email.from?.emailAddress?.address || 'desconhecido';
            console.log(`[Outlook] ⏭️ E-mail não vinculado | De: ${sender} | Assunto: "${email.subject}" — será tentado novamente no próximo ciclo`);
            loggedUnmatchedIds.add(email.id);
          }
        }
      }
    } catch(err) {
      console.error('[Outlook Watcher] Erro no ciclo:', err);
    }
  }, 180000); // 3 minutos
};

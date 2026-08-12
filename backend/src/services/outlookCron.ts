import { fetchEmailAttachments, fetchEmailsByConversationId, fetchUnreadEmails, markEmailAsRead } from './outlookService';
import { prisma } from '../prisma';
import { extractAgentCosts } from './aiService';
import { buildThreadContext, extractOutlookAttachments, mergeExtractedCosts, mergeFeeLists, splitAgentReply } from './agentResponseService';
import { findRequestCycle, markCycleResponse, recordQuotationEvent } from './quotationHistoryService';

const quotationChangesForAgent = (updateData: Record<string, any>) => Object.fromEntries(
  Object.entries(updateData).filter(([field]) => !['agentResponseRaw', 'costsData'].includes(field)).map(([field, value]) => [field, { to: value }])
);
import { applyRateValidityPolicy, rateValidityFields } from './rateValidityService';
import { applyMinLclStorage } from '../utils/cargoUtils';

const TRACKED_AGENT_FIELDS = new Set([
  'freight_value', 'freight_currency', 'freight_usd', 'iof_usd', 'storage_brl', 'services_brl', 'taxes_brl', 'total_brl',
  'invoice_value', 'insurance_requested', 'carrier', 'vessel_name', 'voyage_number', 'free_time_days', 'rate_valid_until',
  'transshipments', 'origin_airport', 'connections', 'origin_fees', 'origin_inland', 'destination_fees',
  'transit_time', 'transit_time_days', 'frequency', 'weight_break'
]);

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
      status: { in: ['AGUARDANDO_AGENTE', 'RETORNO_RECEBIDO'] }
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

  // Padrões de referência conhecidos: GDS-060826-1806, ADZ-QIA/QIS/QIR + 8 dígitos ou variações
  const patterns = [
    /[A-Z]{2,4}-\d{6}-\d{4}/gi,          // GDS-060826-1806, ADZ-060826-1806
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
async function processMatchedEmail(email: any, quotation: any, matchLayer: number): Promise<boolean> {
  const bodyContent = email.body?.content || email.bodyPreview || '';
  const messageId = String(email.id || '');
  if (!messageId) return false;

  const existingVersion = await prisma.agentResponseVersion.findUnique({ where: { messageId } });
  if (existingVersion && ['SUCCESS', 'NO_VALUES'].includes(existingVersion.processingStatus)) return true;
  if (existingVersion && ['FAILED', 'PROCESSING'].includes(existingVersion.processingStatus) && Date.now() - existingVersion.updatedAt.getTime() < 15 * 60 * 1000) return false;

  const receivedAt = email.receivedDateTime && !isNaN(Date.parse(email.receivedDateTime)) ? new Date(email.receivedDateTime) : null;
  const senderEmail = email.from?.emailAddress?.address || null;
  const reply = splitAgentReply(bodyContent);
  let requestCycle = receivedAt ? await findRequestCycle(prisma, {
    quotationId: quotation.id, conversationId: email.conversationId || null, senderEmail, receivedAt
  }) : null;

  const version = await prisma.agentResponseVersion.upsert({
    where: { messageId },
    create: {
      quotationId: quotation.id, messageId, conversationId: email.conversationId || null,
      subject: email.subject || null, senderEmail, receivedAt, matchLayer,
      latestText: reply.latestText, quotedHistory: reply.quotedHistory, signature: reply.signature,
      processingStatus: 'PROCESSING', attempts: 1, requestCycleId: requestCycle?.id || null
    },
    update: {
      quotationId: quotation.id, conversationId: email.conversationId || null,
      subject: email.subject || null, senderEmail, receivedAt, matchLayer,
      latestText: reply.latestText, quotedHistory: reply.quotedHistory, signature: reply.signature,
      processingStatus: 'PROCESSING', errorMessage: null, attempts: { increment: 1 }, requestCycleId: requestCycle?.id || null
    }
  });
  if (requestCycle && receivedAt) requestCycle = await markCycleResponse(prisma, requestCycle, receivedAt, false);
  if (!existingVersion) await recordQuotationEvent(prisma, {
    quotationId: quotation.id, type: 'PARTNER_RESPONSE_RECEIVED', eventAt: receivedAt || new Date(),
    actorType: 'OUTLOOK', channel: 'OUTLOOK', partnerEmail: senderEmail,
    sourceType: 'AGENT_RESPONSE', sourceId: version.id,
    metadata: { subject: email.subject || null, requestCycleId: requestCycle?.id || null, matchLayer }
  });

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

    const [threadMessages, rawAttachments] = await Promise.all([
      email.conversationId ? fetchEmailsByConversationId(email.conversationId) : Promise.resolve([]),
      email.hasAttachments ? fetchEmailAttachments(messageId) : Promise.resolve([])
    ]);
    const threadContext = buildThreadContext(threadMessages, messageId, email.receivedDateTime);
    const attachments = await extractOutlookAttachments(rawAttachments);
    const sourceText = [
      '=== RESPOSTA ATUAL DO AGENTE (FONTE PRIMÁRIA) ===', reply.latestText || email.bodyPreview || '',
      attachments.text ? `=== ANEXOS DA RESPOSTA ATUAL ===\n${attachments.text}` : '',
      threadContext ? `=== HISTÓRICO DA CONVERSA (SOMENTE CONTEXTO; NÃO EXTRAIR PREÇOS NÃO CONFIRMADOS) ===\n${threadContext}` : ''
    ].filter(Boolean).join('\n\n');

    const costs = await extractAgentCosts(sourceText, '', '', JSON.stringify(payload), attachments.mediaParts);
    
    if (costs && costs.costs) {
      const c = costs.costs;
      applyRateValidityPolicy(c, receivedAt || new Date());
      const presentFields = new Set<string>((Array.isArray(c.present_fields) ? c.present_fields : [])
        .map((field: any) => String(field).trim().toLowerCase())
        .filter((field: string) => TRACKED_AGENT_FIELDS.has(field)));
      const has = (...fields: string[]) => fields.some(field => presentFields.has(field));

      if (presentFields.size === 0) {
        await prisma.$transaction(async tx => {
          await tx.agentResponseVersion.update({ where: { id: version.id }, data: {
            attachmentNames: JSON.stringify(attachments.names), extractedData: JSON.stringify(c), confidence: c.confidence ?? null,
            processingStatus: 'NO_VALUES', processedAt: new Date(), errorMessage: 'Nenhum valor novo foi identificado na resposta atual.'
          } });
          await recordQuotationEvent(tx, {
            quotationId: quotation.id, type: 'RESPONSE_PROCESSED_NO_VALUES', actorType: 'AI', channel: 'OUTLOOK',
            partnerEmail: senderEmail, sourceType: 'AGENT_RESPONSE', sourceId: version.id,
            metadata: { requestCycleId: requestCycle?.id || null, attachmentNames: attachments.names }
          });
        });
        console.log(`[Outlook] Resposta sem valores novos | Cotação: ${quotation.id} | Mensagem: ${messageId}`);
        return true;
      }
      
      // Mapeia os dados da IA para as colunas do banco
      const updateData: any = {
        status: 'RETORNO_RECEBIDO',
        costsData: JSON.stringify(mergeExtractedCosts(quotation.costsData, c, presentFields)),
        agentResponseRaw: bodyContent.substring(0, 50000), // Limita para não estourar o campo
      };

      if (has('freight_value') && c.freight_value != null) updateData.freightValue = c.freight_value;
      if ((has('freight_currency') || has('freight_value')) && c.freight_currency) updateData.freightCurrency = c.freight_currency;
      if (has('freight_usd') && c.freight_usd != null) updateData.totalUsd = c.freight_usd;
      if (has('iof_usd') && c.iof_usd != null) updateData.iofUsd = c.iof_usd;
      if (has('storage_brl') && c.storage_brl != null) {
        const pricingSettings = await prisma.pricingSettings.upsert({
          where: { id: 'default' },
          update: {},
          create: { id: 'default' }
        });
        updateData.destinationStorage = applyMinLclStorage(c.storage_brl, quotation.modal, quotation.loadType, pricingSettings.minLclStorageBrl);
        updateData.destinationStorageCurrency = 'BRL';
      }
      if (has('services_brl') && c.services_brl != null) updateData.destinationServicesTotal = c.services_brl;
      if (has('taxes_brl') && c.taxes_brl != null) {
        updateData.destinationTaxes = c.taxes_brl;
        updateData.destinationTaxesCurrency = 'BRL';
      }
      if (has('total_brl') && c.total_brl != null) updateData.totalBrl = c.total_brl;
      
      if (has('carrier') && c.carrier) {
        updateData.carrier = c.carrier;
        const carrierName = String(c.carrier).toUpperCase();
        const profiles = await prisma.carrierProfile.findMany({ where: { active: true } });
        const profile = profiles.find(p => {
          let profileAliases: string[] = [];
          try { profileAliases = JSON.parse(p.aliases || '[]'); } catch { profileAliases = []; }
          return [p.name, p.code, ...profileAliases].filter(Boolean).some(value => {
            const normalized = String(value).toUpperCase();
            return carrierName === normalized || carrierName.includes(normalized) || normalized.includes(carrierName);
          });
        });
        if (profile) updateData.carrierProfileId = profile.id;
      }
      if (has('vessel_name') && c.vessel_name) updateData.vesselName = c.vessel_name;
      if (has('voyage_number') && c.voyage_number) updateData.voyageNumber = c.voyage_number;
      if (has('free_time_days') && c.free_time_days != null) updateData.freeTimeDays = c.free_time_days;
      Object.assign(updateData, rateValidityFields(c));
      if (has('transshipments') && Array.isArray(c.transshipments)) updateData.transshipments = JSON.stringify(c.transshipments);
      if (has('transit_time', 'transit_time_days') && c.transit_time_days != null) updateData.transitTimeDays = c.transit_time_days;
      if (has('frequency') && c.frequency) updateData.frequency = c.frequency;
      if (has('weight_break') && c.weight_break) updateData.weightBreak = c.weight_break;
      if (has('origin_airport') && c.origin_airport) updateData.originPort = c.origin_airport;
      if (has('connections') && c.connections !== undefined) updateData.connections = c.connections;
      
      if (has('origin_inland') && c.origin_inland?.quoted === true) {
        updateData.needsOriginInland = true;
        updateData.originInlandRoute = c.origin_inland.route || quotation.originInlandRoute || null;
        if (c.origin_inland.value != null) updateData.originInlandValue = c.origin_inland.value;
        updateData.originInlandCurrency = c.origin_inland.currency || 'USD';
        updateData.originInlandTransitTime = c.origin_inland.transit_time || null;
      }
      if (has('origin_fees') && Array.isArray(c.origin_fees) && c.origin_fees.length > 0) {
        const localOriginFees = c.origin_fees.filter((fee: any) =>
          !/(pick\s*up|pickup|collection|pre[-\s]?carriage|coleta|inland)/i.test(String(fee?.name || ''))
        );
        if (localOriginFees.length > 0) updateData.originServices = JSON.stringify(mergeFeeLists(quotation.originServices, localOriginFees));
      }
      if (has('destination_fees') && Array.isArray(c.destination_fees) && c.destination_fees.length > 0) {
        updateData.destinationServices = JSON.stringify(mergeFeeLists(quotation.destinationServices, c.destination_fees));
      }
      if (has('insurance_requested') && c.insurance_requested === true) {
        updateData.requiresInsurance = true;
      }
      if (has('invoice_value') && c.invoice_value && c.invoice_value > 0) {
        updateData.commercialValue = c.invoice_value;
      }

      await prisma.$transaction(async tx => {
        await tx.quotation.update({ where: { id: quotation.id }, data: updateData });
        await tx.agentResponseVersion.update({ where: { id: version.id }, data: {
          attachmentNames: JSON.stringify(attachments.names), extractedData: JSON.stringify(c), confidence: c.confidence ?? null,
          processingStatus: 'SUCCESS', processedAt: new Date(), errorMessage: null, requestCycleId: requestCycle?.id || null
        } });
        if (requestCycle && receivedAt) await markCycleResponse(tx, requestCycle, receivedAt, true);
        await recordQuotationEvent(tx, {
          quotationId: quotation.id, type: 'RESPONSE_PROCESSED_WITH_VALUES', actorType: 'AI', channel: 'OUTLOOK',
          partnerEmail: senderEmail, previousStatus: quotation.status, newStatus: 'RETORNO_RECEBIDO',
          changes: quotationChangesForAgent(updateData), sourceType: 'AGENT_RESPONSE', sourceId: version.id,
          metadata: { requestCycleId: requestCycle?.id || null, presentFields: [...presentFields], attachmentNames: attachments.names }
        });
      });
      console.log(`[Outlook] ✅ Retorno processado | Cotação: ${quotation.id} | REF: ${quotation.reference} | Camada: ${matchLayer} | Assunto: "${email.subject}"`);
      return true;
    }
    await prisma.agentResponseVersion.update({ where: { id: version.id }, data: { processingStatus: 'NO_VALUES', processedAt: new Date(), errorMessage: 'A IA não retornou custos estruturados.' } });
    await recordQuotationEvent(prisma, { quotationId: quotation.id, type: 'RESPONSE_PROCESSED_NO_VALUES', actorType: 'AI', sourceType: 'AGENT_RESPONSE', sourceId: version.id });
    return true;
  } catch(e: any) {
    await prisma.agentResponseVersion.update({ where: { id: version.id }, data: { processingStatus: 'FAILED', errorMessage: String(e?.message || e).slice(0, 2000), processedAt: new Date() } }).catch(() => undefined);
    await recordQuotationEvent(prisma, {
      quotationId: quotation.id, type: 'RESPONSE_PROCESSING_FAILED', actorType: 'AI', channel: 'OUTLOOK',
      partnerEmail: senderEmail, sourceType: 'AGENT_RESPONSE', sourceId: version.id,
      metadata: { error: String(e?.message || e).slice(0, 1000) }
    }).catch(() => undefined);
    console.error(`[Outlook] ❌ Erro ao extrair custos via IA para cotação ${quotation.id}:`, e);
    return false;
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
          const processed = await processMatchedEmail(email, quotation, matchLayer);
          
          // Marcar como lido somente após sucesso ou triagem comprovada sem valores.
          if (processed) {
            await markEmailAsRead(email.id);
            loggedUnmatchedIds.delete(email.id); // Limpar do set se estava lá
          }
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

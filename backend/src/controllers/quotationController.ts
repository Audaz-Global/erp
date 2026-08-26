import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { generatePdf } from '../services/pdfService';
import axios from 'axios';
import { calculateAirCubado, hasOversizedCargo, calculateCbmFromDimensions, applyMinLclStorage, extractContainerInfo } from '../utils/cargoUtils';
import { getFeesForIncoterm, formatFeesForController, resolveFreightValue } from '../services/incotermRuleService';
import { enforceCarrierFieldRules, CarrierFieldRuleError } from '../services/carrierFieldRuleService';
import { enforcePartnerRules, PartnerRuleError } from '../services/partnerRuleService';
import { enforceCnpjRequirement, CnpjRequiredError } from '../services/cnpjRequirementService';
import { enforceHybridModalAcknowledgement, HybridModalError } from '../services/hybridModalService';
import { getPtaxRate } from '../services/ptaxService';
import { applyRateValidityPolicy, rateValidityFields } from '../services/rateValidityService';
import { quotationChanges, recordQuotationEvent } from '../services/quotationHistoryService';
import { normalizeDangerousGoodsPayload, withDangerousGoodsCompliance } from '../services/dangerousGoodsService';
import { withIncotermApplicability } from '../services/incotermApplicabilityService';
import { normalizeIncotermText } from '../services/incotermAliasService';
import { normalizeCurrency, normalizeFee } from '../services/feeCalculationService';
import { shouldHydrateAutomaticCosts } from '../services/costCompositionService';
import { legacyRoadFields, normalizeGroundServiceLegs, syncGroundServiceLegs } from '../services/groundServiceService';
import { findClientByCnpjMatch, findClientByNameMatch } from '../services/clientMatchService';

const PRICING_SETTINGS_ID = 'default';

// 1. Create a new Quotation
export const createQuotation = async (req: Request, res: Response) => {
  try {
    let userId = req.user?.userId;

    if (!userId || userId === 'teste-local-id') {
      // Modo de teste local (sem autenticação real)
      let testUser = await prisma.user.findUnique({ where: { email: 'teste@audazglobal.com' } });
      if (!testUser) {
        testUser = await prisma.user.create({
          data: {
            name: 'Usuário de Teste Local',
            email: 'teste@audazglobal.com',
            password: 'senha-fake-nao-usada',
            role: 'ADMIN'
          }
        });
      }
      userId = testUser.id;
    }

    // Extract non-quotation fields
    const { clientName, clientCnpj, clientContactName, clientContactEmail, clientContactPhone, clientAtlantisId, clientNeedsValidation, clientValidationNote, iofUsd, ruleStage, operatorInitials, groundServiceLegs, ...quotationData } = req.body;
    const normalizedGround = normalizeGroundServiceLegs(groundServiceLegs, quotationData);
    Object.assign(quotationData, legacyRoadFields(normalizedGround.legs));
    if (typeof quotationData.reference === 'string') quotationData.reference = quotationData.reference.trim();
    if (quotationData.freightCurrency) quotationData.freightCurrency = normalizeCurrency(quotationData.freightCurrency);
    if (quotationData.incoterm) quotationData.incoterm = normalizeIncotermText(quotationData.incoterm);
    normalizeDangerousGoodsPayload(quotationData);
    if (ruleStage) {
      await enforceCarrierFieldRules(quotationData, String(ruleStage).toUpperCase());
      await enforcePartnerRules(quotationData, String(ruleStage).toUpperCase());
      enforceCnpjRequirement({ loadType: quotationData.loadType, requiresStorageEstimate: quotationData.requiresStorageEstimate, clientCnpj });
      enforceHybridModalAcknowledgement({ hybridModalDetected: quotationData.hybridModalDetected, hybridModalAcknowledged: quotationData.hybridModalAcknowledged });
    }

    // Generate Reference in INITIALS-DDMMYY-HHMM format if not provided
    let reference = quotationData.reference;
    if (reference) {
      const existing = await prisma.quotation.findUnique({ where: { reference } });
      if (existing) {
        reference = `${reference}-${Math.floor(Math.random() * 1000)}`;
      }
    } else {
      reference = await generateReference(operatorInitials || 'ADZ');
    }

    // Handle Client
    let clientId = null;
    if (clientName) {
      // Find or Create Client
      let client = await findClientByCnpjMatch(prisma, clientCnpj);
      if (!client) {
        // Tentar encontrar pelo nome se não encontrou pelo CNPJ
        client = await findClientByNameMatch(prisma, clientName);
      }
      if (!client) {
        client = await prisma.client.create({
          data: {
            name: clientName,
            cnpj: clientCnpj || null,
            contactName: clientContactName || null,
            contactEmail: clientContactEmail || null,
            contactPhone: clientContactPhone || null,
            atlantisId: clientAtlantisId || null,
            needsValidation: Boolean(clientNeedsValidation),
            validationNote: clientValidationNote || null
          }
        });
      } else if (clientContactName || clientContactPhone || clientContactEmail || quotationData.productSegment || clientAtlantisId) {
        // Atualizar dados de contato/segmento do cliente existente se estavam vazios
        const updateClientData: any = {};
        if (clientContactName && !client.contactName) updateClientData.contactName = clientContactName;
        if (clientContactPhone && !client.contactPhone) updateClientData.contactPhone = clientContactPhone;
        if (clientContactEmail && !client.contactEmail) updateClientData.contactEmail = clientContactEmail;
        if (quotationData.productSegment && !client.productSegment) updateClientData.productSegment = quotationData.productSegment;
        // Só grava o vínculo com o Atlantis se o cliente ainda não tinha um confirmado.
        if (clientAtlantisId && !client.atlantisId) {
          updateClientData.atlantisId = clientAtlantisId;
          updateClientData.needsValidation = Boolean(clientNeedsValidation);
          updateClientData.validationNote = clientValidationNote || null;
        }
        if (Object.keys(updateClientData).length > 0) {
          client = await prisma.client.update({ where: { id: client.id }, data: updateClientData });
        }
      }
      // Sem segmento informado nesta cotação, herda o segmento já cadastrado do cliente
      if (!quotationData.productSegment && client.productSegment) quotationData.productSegment = client.productSegment;
      clientId = client.id;
    }

    // Calcular CBM automaticamente a partir de dimensões se não vier preenchido
    let totalCbm = quotationData.totalCbm;
    if (!totalCbm && quotationData.packages) {
      totalCbm = calculateCbmFromDimensions(quotationData.packages, quotationData.totalPackages || 1);
    }

    const data = {
      ...quotationData,
      totalCbm,
      iofUsd,
      reference,
      createdById: userId,
      ...(clientId ? { clientId } : {})
    };

    const quotation = await prisma.quotation.create({ data });
    await syncGroundServiceLegs(quotation.id, groundServiceLegs, quotationData);
    await recordQuotationEvent(prisma, {
      quotationId: quotation.id, type: 'QUOTATION_CREATED', actorType: 'USER',
      actorId: req.user?.userId === 'teste-local-id' ? null : req.user?.userId,
      newStatus: quotation.status, metadata: { reference: quotation.reference }
    });
    const created = await prisma.quotation.findUnique({ where:{ id:quotation.id }, include:{ groundServiceLegs:true } });
    res.status(201).json(await withIncotermApplicability(withDangerousGoodsCompliance(created || quotation)));
  } catch (error: any) {
    console.error('Erro ao criar cotação:', error);
    const detail = error?.meta?.target || error?.meta?.cause || error?.message || '';
    res.status(error instanceof CarrierFieldRuleError || error instanceof PartnerRuleError || error instanceof CnpjRequiredError || error instanceof HybridModalError ? 400 : 500).json({ error: `Erro ao criar a cotação no banco de dados${detail ? ': ' + detail : ''}` });
  }
};

// 2. Get all Quotations
export const getQuotations = async (req: Request, res: Response) => {
  try {
    const quotations = await prisma.quotation.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        client: { select: { name: true } },
        createdBy: { select: { name: true } },
        groundServiceLegs:true,
        requestCycles: { orderBy: { sentAt: 'desc' } }
      }
    });
    res.json(quotations.map(withDangerousGoodsCompliance));
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar cotações' });
  }
};

// 3. Get single Quotation
export const getQuotationById = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: { client: true, groundServiceLegs:true }
    });
    if (!quotation) return res.status(404).json({ error: 'Cotação não encontrada' });
    res.json(await withIncotermApplicability(withDangerousGoodsCompliance(quotation)));
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar a cotação' });
  }
};

// 4. Update Quotation
export const updateQuotation = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const current = await prisma.quotation.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: 'Cotação não encontrada' });
    
    // Desestruturar campos que não pertencem ao model Quotation
    const {
      clientName,
      clientCnpj,
      clientContactName,
      clientContactEmail,
      clientContactPhone,
      clientAtlantisId,
      clientNeedsValidation,
      clientValidationNote,
      sourceEmails,
      ruleStage,
      operatorInitials,
      groundServiceLegs,
      ...quotationData
    } = req.body;
    const normalizedGround = normalizeGroundServiceLegs(groundServiceLegs, { ...current, ...quotationData });
    if (normalizedGround.supplied) Object.assign(quotationData, legacyRoadFields(normalizedGround.legs));

    // Um campo vazio na tela nunca pode apagar a referência oficial já gerada.
    if (typeof quotationData.reference === 'string') quotationData.reference = quotationData.reference.trim();
    if (quotationData.freightCurrency) quotationData.freightCurrency = normalizeCurrency(quotationData.freightCurrency);
    if (quotationData.incoterm) quotationData.incoterm = normalizeIncotermText(quotationData.incoterm);
    if (!quotationData.reference) delete quotationData.reference;
    if (!current.reference && !quotationData.reference && operatorInitials) {
      quotationData.reference = await generateReference(operatorInitials);
    }

    if (ruleStage) {
      await enforceCarrierFieldRules(quotationData, String(ruleStage).toUpperCase(), current);
      await enforcePartnerRules(quotationData, String(ruleStage).toUpperCase(), current);
      enforceCnpjRequirement({
        loadType: quotationData.loadType ?? current.loadType,
        requiresStorageEstimate: quotationData.requiresStorageEstimate ?? current.requiresStorageEstimate,
        clientCnpj
      });
      enforceHybridModalAcknowledgement({
        hybridModalDetected: quotationData.hybridModalDetected ?? current.hybridModalDetected,
        hybridModalAcknowledged: quotationData.hybridModalAcknowledged ?? current.hybridModalAcknowledged
      });
    }

    const updateData: any = normalizeDangerousGoodsPayload({ ...quotationData }, current);
    if (sourceEmails !== undefined) updateData.sourceEmails = sourceEmails;
    if (updateData.packages && !updateData.totalCbm) {
      updateData.totalCbm = calculateCbmFromDimensions(updateData.packages, updateData.totalPackages || 1);
    }

    // Se as informações de cliente foram passadas, atualizamos/associamos
    if (clientName) {
      let client = await findClientByCnpjMatch(prisma, clientCnpj);
      if (!client) {
        client = await findClientByNameMatch(prisma, clientName);
      }
      if (!client) {
        client = await prisma.client.create({
          data: {
            name: clientName,
            cnpj: clientCnpj || null,
            contactName: clientContactName || null,
            contactEmail: clientContactEmail || null,
            contactPhone: clientContactPhone || null,
            atlantisId: clientAtlantisId || null,
            needsValidation: Boolean(clientNeedsValidation),
            validationNote: clientValidationNote || null
          }
        });
      } else {
        // Atualizar campos de contato se foram fornecidos e estavam vazios ou diferentes
        const updateClientData: any = {};
        if (clientContactName && clientContactName !== client.contactName) updateClientData.contactName = clientContactName;
        if (clientContactPhone && clientContactPhone !== client.contactPhone) updateClientData.contactPhone = clientContactPhone;
        if (clientContactEmail && clientContactEmail !== client.contactEmail) updateClientData.contactEmail = clientContactEmail;
        if (updateData.productSegment && updateData.productSegment !== client.productSegment) updateClientData.productSegment = updateData.productSegment;
        // Só grava o vínculo com o Atlantis se o cliente ainda não tinha um confirmado.
        if (clientAtlantisId && !client.atlantisId) {
          updateClientData.atlantisId = clientAtlantisId;
          updateClientData.needsValidation = Boolean(clientNeedsValidation);
          updateClientData.validationNote = clientValidationNote || null;
        }
        if (Object.keys(updateClientData).length > 0) {
          client = await prisma.client.update({ where: { id: client.id }, data: updateClientData });
        }
      }
      updateData.clientId = client.id;
    }

    const quotation = await prisma.quotation.update({
      where: { id },
      data: updateData,
      include: { client: true, groundServiceLegs:true }
    });
    if (normalizedGround.supplied) await syncGroundServiceLegs(id, groundServiceLegs, quotationData);
    const changes = quotationChanges(current, quotation);
    if (Object.keys(changes).length) await recordQuotationEvent(prisma, {
      quotationId: id, type: current.status !== quotation.status ? 'STATUS_CHANGED' : 'QUOTATION_UPDATED', actorType: 'USER',
      actorId: req.user?.userId === 'teste-local-id' ? null : req.user?.userId,
      previousStatus: current.status, newStatus: quotation.status, changes
    });
    const result = await prisma.quotation.findUnique({ where:{ id }, include:{ client:true, groundServiceLegs:true } });
    res.json(await withIncotermApplicability(withDangerousGoodsCompliance(result || quotation)));
  } catch (error: any) {
    console.error('Erro no updateQuotation:', error);
    res.status(error instanceof CarrierFieldRuleError || error instanceof PartnerRuleError || error instanceof CnpjRequiredError || error instanceof HybridModalError ? 400 : 500).json({ error: error?.message || 'Erro ao atualizar cotação' });
  }
};

// 5. Delete Quotation
export const deleteQuotation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const documents = await prisma.quotationDocument.findMany({ where: { quotationId: id }, select: { blobId: true } });
    await prisma.quotation.delete({ where: { id } });
    for (const { blobId } of documents) {
      const references = await prisma.quotationDocument.count({ where: { blobId } });
      if (!references) await prisma.documentBlob.delete({ where: { id: blobId } }).catch(() => undefined);
    }
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir cotação' });
  }
};

// Helper: Auto-generate Reference "INITIALS-DDMMYY-HHMM" format
const generateReference = async (initials: string = 'ADZ') => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).reduce<Record<string, string>>((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const datePart = `${parts.day || '01'}${parts.month || '01'}${(parts.year || '2000').slice(-2)}`;
  const timePart = `${parts.hour || '00'}${parts.minute || '00'}`;
  const prefix = (initials || 'ADZ').trim().toUpperCase();
  return `${prefix}-${datePart}-${timePart}`;
};

// 6. Generate PDF for Quotation
export const generateQuotationPdf = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    let quotation = await prisma.quotation.findUnique({
      where: { id },
      include: { client: true, createdBy: true, groundServiceLegs:true }
    });

    if (!quotation) return res.status(404).json({ error: 'Cotação não encontrada' });

    if (!quotation.rateValidUntil) {
      const validity = applyRateValidityPolicy({}, new Date());
      const updatedValidity = await prisma.quotation.update({
        where: { id: quotation.id },
        data: rateValidityFields(validity)
      });
      quotation = { ...quotation, ...updatedValidity };
    }

    const host = req.get('host');
    const protocol = req.protocol;
    const publicWebViewUrl = `${protocol}://${host}/api/quotations/${quotation.id}/view`;

    // Assinatura do rodapé do PDF: sempre a pessoa que está cotando ("Cotando
    // como", selecionada no cabeçalho) no momento da geração — não quem criou
    // a cotação originalmente, que pode ser outra pessoa. Sem seleção, cai
    // para quem criou o registro para nunca deixar a assinatura em branco.
    const professionalId = String(req.query?.professionalId || '');
    const professional = professionalId
      ? await prisma.professionalProfile.findUnique({ where: { id: professionalId } })
      : null;
    const professionalName = professional?.name || quotation.createdBy?.name || '';
    const professionalEmail = professional?.email || quotation.createdBy?.email || '';

    const pdfBuffer = await generatePdf({
      ...quotation,
      publicWebViewUrl,
      professionalName,
      professionalEmail
    });
    await recordQuotationEvent(prisma, { quotationId: quotation.id, type: 'PDF_GENERATED', actorType: 'USER', channel: 'SYSTEM' });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${quotation.reference}.pdf"`,
      'Content-Length': pdfBuffer.length.toString()
    });

    res.send(pdfBuffer);
  } catch (error: any) {
    console.error('Erro ao gerar PDF:', error);
    res.status(500).json({ 
      error: 'Erro ao gerar o PDF da cotação', 
      message: error.message, 
      stack: error.stack 
    });
  }
};

// 7. Update Quotation Status / Phase
export const updatePhase = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const current = await prisma.quotation.findUnique({ where: { id }, include: { client: true } });
    if (!current) return res.status(404).json({ error: 'Cotação não encontrada' });
    const { status, costs, agentEmail, customsClearanceIncluded, transitTimeDays, frequency, weightBreak, freightDisplayMode, costCompositionReviewed } = req.body;

    if (['AGUARDANDO_PARCEIRO', 'GERADA'].includes(status)) {
      enforceCnpjRequirement({
        loadType: req.body.loadType ?? current.loadType,
        requiresStorageEstimate: current.requiresStorageEstimate,
        clientCnpj: current.client?.cnpj
      });
      enforceHybridModalAcknowledgement({
        hybridModalDetected: current.hybridModalDetected,
        hybridModalAcknowledged: current.hybridModalAcknowledged
      });
    }

    const updateData: any = { status };
    if (costCompositionReviewed !== undefined) updateData.costCompositionReviewed = Boolean(costCompositionReviewed);
    if (agentEmail) updateData.agentEmail = agentEmail;
    if (freightDisplayMode !== undefined) {
      updateData.freightDisplayMode = freightDisplayMode === 'ITEMIZED' ? 'ITEMIZED' : 'ALL_IN';
    }
    if (customsClearanceIncluded !== undefined) {
      updateData.customsClearanceIncluded = customsClearanceIncluded;
    }
    if (transitTimeDays !== undefined) {
      updateData.transitTimeDays = transitTimeDays;
    }
    if (frequency !== undefined) {
      updateData.frequency = frequency;
    }
    if (weightBreak !== undefined) {
      updateData.weightBreak = weightBreak;
    }

    if (costs) {
      if (costs.freight_currency && costs.freight_value !== undefined) {
        updateData.freightValue = costs.freight_value;
        updateData.freightCurrency = normalizeCurrency(costs.freight_currency);
      } else {
        updateData.freightValue = costs.freight_usd;
        updateData.freightCurrency = 'USD';
      }
      updateData.iofUsd = costs.iof_usd;
      const quotationForStorage = await prisma.quotation.findUnique({ where: { id }, select: { modal: true, loadType: true } });
      const pricingSettingsForStorage = await prisma.pricingSettings.upsert({
        where: { id: PRICING_SETTINGS_ID },
        update: {},
        create: { id: PRICING_SETTINGS_ID }
      });
      const informedStorage = Number(costs.storage_brl || 0);
      const reportedStorageSource = String(costs.storage_source || '');
      const storageFromPartner = /(?:AGENTE|AGENT|COLOADER|ARMADOR|CIA_AEREA|DESCONSOLIDADOR)_RESPONSE/.test(reportedStorageSource);
      updateData.destinationStorage = (costCompositionReviewed || storageFromPartner)
        ? informedStorage
        : applyMinLclStorage(informedStorage, quotationForStorage?.modal, quotationForStorage?.loadType, pricingSettingsForStorage.minLclStorageBrl);
      updateData.destinationStorageCurrency = 'BRL';
      const storageUnchanged = Number(current.destinationStorage || 0) === informedStorage;
      updateData.destinationStorageSource = storageFromPartner
        ? reportedStorageSource
        : storageUnchanged
        ? current.destinationStorageSource
        : (informedStorage > 0 ? 'MANUAL' : (!costCompositionReviewed && quotationForStorage?.modal === 'SEA' && quotationForStorage?.loadType === 'LCL' ? 'MINIMUM_FALLBACK' : null));
      updateData.destinationServicesTotal = costs.services_brl;
      updateData.destinationTaxes = costs.taxes_brl;
      updateData.totalBrl = costs.total_brl;
      if (costs.frequency !== undefined) {
        updateData.frequency = costs.frequency;
      }
      if (costs.weight_break !== undefined) {
        updateData.weightBreak = costs.weight_break;
      }
    }

    const updated = await prisma.quotation.update({
      where: { id },
      data: updateData
    });

    const changes = quotationChanges(current, updated);
    if (Object.keys(changes).length) await recordQuotationEvent(prisma, {
      quotationId: id, type: current.status !== updated.status ? 'STATUS_CHANGED' : 'QUOTATION_UPDATED', actorType: 'USER',
      actorId: req.user?.userId === 'teste-local-id' ? null : req.user?.userId,
      previousStatus: current.status, newStatus: updated.status, changes
    });

    res.json(updated);
  } catch (error: any) {
    res.status(error instanceof CnpjRequiredError || error instanceof HybridModalError ? 400 : 500).json({ error: error.message });
  }
};

// 8. Duplicar cotação (usado quando a extração identifica embarque híbrido — dois
// modais distintos no mesmo e-mail — e o operador decide separar em dois processos)
export const duplicateQuotation = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const source = await prisma.quotation.findUnique({ where: { id } });
    if (!source) return res.status(404).json({ error: 'Cotação não encontrada' });

    const baseReference = source.reference || source.id.substring(0, 6).toUpperCase();
    const cloneCount = await prisma.quotation.count({ where: { reference: { startsWith: baseReference + '-' } } });
    const targetReference = `${baseReference}-${cloneCount + 2}`;

    const { id: _sourceId, createdAt, updatedAt, reference, ...quotationData } = source;

    const clone = await prisma.quotation.create({ data: {
      ...quotationData,
      reference: targetReference,
      status: 'CRIADA',
      agentEmail: null, agentName: null, draftEmail: null, sentAt: null, sentEmailConversationId: null,
      truckerEmail: null, truckerName: null, truckerDraftEmail: null, truckerSentAt: null,
      costCompositionReviewed: false,
      hybridModalAcknowledged: true
    } });

    const sourceDocuments = await prisma.quotationDocument.findMany({ where: { quotationId: id } });
    if (sourceDocuments.length) {
      await prisma.quotationDocument.createMany({ data: sourceDocuments.map(document => ({
        quotationId: clone.id, blobId: document.blobId, originalName: document.originalName, origin: document.origin,
        sourceContainerName: document.sourceContainerName, forwardByDefault: document.forwardByDefault, createdById: document.createdById
      })), skipDuplicates: true });
    }

    // A divisão em dois processos resolve a ambiguidade também para o processo original.
    await prisma.quotation.update({ where: { id }, data: { hybridModalAcknowledged: true } });

    const actorId = req.user?.userId === 'teste-local-id' ? null : req.user?.userId;
    await recordQuotationEvent(prisma, {
      quotationId: clone.id, type: 'QUOTATION_CLONED', actorType: 'USER', actorId,
      newStatus: clone.status, metadata: { sourceQuotationId: id, reason: 'HYBRID_MODAL_SPLIT' }
    });
    await recordQuotationEvent(prisma, {
      quotationId: id, type: 'QUOTATION_UPDATED', actorType: 'USER', actorId,
      metadata: { clonedIntoQuotationId: clone.id, reason: 'HYBRID_MODAL_SPLIT' }
    });

    const result = await prisma.quotation.findUnique({ where: { id: clone.id }, include: { client: true, groundServiceLegs: true } });
    res.status(201).json(await withIncotermApplicability(withDangerousGoodsCompliance(result || clone)));
  } catch (error: any) {
    console.error('Erro ao duplicar cotação:', error);
    res.status(500).json({ error: error?.message || 'Erro ao duplicar cotação' });
  }
};

// 9. Rota pública de visualização web da cotação convertida para R$ (BRL)
export const getPublicWebView = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: { client: true, groundServiceLegs:true }
    });

    if (!quotation) {
      return res.status(404).send('<h1>Cotação não encontrada</h1>');
    }

    // Buscar taxas de câmbio (dólar via PTAX/BACEN, euro via AwesomeAPI)
    let eurRate = 5.50;
    try {
      const response = await axios.get('https://economia.awesomeapi.com.br/last/EUR-BRL', { timeout: 3000 });
      if (response.data?.EURBRL) eurRate = parseFloat(response.data.EURBRL.bid) || eurRate;
    } catch (err: any) {
      console.error('Erro ao buscar câmbio EUR, usando fallback:', err.message);
    }
    const pricingSettings = await prisma.pricingSettings.upsert({
      where: { id: PRICING_SETTINGS_ID },
      update: {},
      create: { id: PRICING_SETTINGS_ID }
    });
    const usdRate = await getPtaxRate(pricingSettings.ptaxMode === 'D0_OPEN' ? 'D0_OPEN' : 'D1_CLOSE');

    // Lógica de conversão
    const getBrlValue = (val: number, currency: string): number => {
      const cur = (currency || 'USD').toUpperCase();
      if (cur === 'BRL') return val;
      if (cur === 'EUR') return val * eurRate;
      return val * usdRate;
    };

    // Calcular valores
    const isAir = String(quotation.modal).toUpperCase() === 'AIR';
    const isExw = String(quotation.incoterm).toUpperCase() === 'EXW';
    
    // Peso taxável
    const bruto = quotation.totalGrossWeightKg || 0;
    const cbm = quotation.totalCbm || 0;
    const cubado = isAir ? calculateAirCubado(quotation.packages || '', quotation.totalPackages || 1) : parseFloat((cbm * 1000).toFixed(2));
    let taxavel = Math.max(bruto, cubado) || 1; // evitar divisão por zero
    if (isAir && quotation.weightBreak) {
      const minWeight = parseFloat(quotation.weightBreak.replace(/[^0-9]/g, ''));
      if (!isNaN(minWeight) && taxavel < minWeight) {
        taxavel = minWeight;
      }
    }

    // Frete
    let fVal = quotation.freightValue || 0;
    let fCurr = quotation.freightCurrency || (isAir && String(quotation.reference).includes('ACO') ? 'EUR' : 'USD');

    // Detalhar taxas de origem
    let detailedFeesOrigem: any[] = [];
    if (quotation.originServices) {
      try {
        const parsedServices = JSON.parse(quotation.originServices);
        if (Array.isArray(parsedServices) && parsedServices.length > 0) {
          detailedFeesOrigem = parsedServices.map(f => {
            const val = parseFloat(f.totalValue ?? f.value) || 0;
            const curr = f.currency || 'USD';
            return {
              name: f.name,
              val: val,
              unitValue: parseFloat(f.unitValue ?? f.value) || 0,
              billingUnit: f.billingUnit || 'UNKNOWN',
              quantity: f.quantity ?? 1,
              currency: curr,
              brl: getBrlValue(val, curr),
              financialGroup: normalizeFee({ ...f, applicationScope:'ORIGIN' }).financialGroup,
              chargeNature: normalizeFee({ ...f, applicationScope:'ORIGIN' }).chargeNature
            };
          });
        }
      } catch (err) {
        console.error('Erro ao ler originServices na visualização pública:', err);
      }
    }

    // Detalhar taxas de destino
    let detailedFeesDestino: any[] = [];
    if (quotation.destinationServices) {
      try {
        const parsed = JSON.parse(quotation.destinationServices);
        if (Array.isArray(parsed) && parsed.length > 0) {
          detailedFeesDestino = parsed.map(f => {
            const val = parseFloat(f.totalValue ?? f.value) || 0;
            const curr = f.currency || 'USD';
            return {
              name: f.name,
              val: val,
              unitValue: parseFloat(f.unitValue ?? f.value) || 0,
              billingUnit: f.billingUnit || 'UNKNOWN',
              quantity: f.quantity ?? 1,
              currency: curr,
              brl: getBrlValue(val, curr),
              financialGroup: normalizeFee({ ...f, applicationScope:'DESTINATION' }).financialGroup,
              chargeNature: normalizeFee({ ...f, applicationScope:'DESTINATION' }).chargeNature
            };
          });
        }
      } catch (err) {
        console.error('Erro ao ler destinationServices na visualização pública:', err);
      }
    }

    // Aplicar regras de Incoterm do banco se não há taxas salvas manualmente
    const incotermStr = String(quotation.incoterm || 'FCA').toUpperCase();
    const modalStr = String(quotation.modal || 'AIR').toUpperCase();
    const modalForRules = modalStr === 'AIR' ? 'AIR' : (String(quotation.loadType || '').includes('LCL') ? 'SEA_LCL' : 'SEA_FCL');
    const containerInfo = extractContainerInfo(quotation.packages, quotation.totalPackages, quotation.loadType);
    const feeContext = { totalCbm: cbm, containerCount: containerInfo.qty, grossWeightKg: bruto, dangerousGoodsProductCount: quotation.dangerousGoodsProductCount || 0, insuranceRequested: Boolean(quotation.requiresInsurance), customsClearanceContracted: Boolean(quotation.customsClearanceIncluded) };

    const resolvedFreight = shouldHydrateAutomaticCosts(quotation)
      ? await resolveFreightValue(incotermStr, modalForRules, quotation.direction, fVal, fCurr, feeContext)
      : { value:fVal, currency:fCurr, fromFallback:false, items:[] as any[] };
    fVal = resolvedFreight.value;
    fCurr = resolvedFreight.currency;
    let fTotalBrl = getBrlValue(fVal, fCurr);

    if (shouldHydrateAutomaticCosts(quotation) && detailedFeesOrigem.length === 0) {
      try {
        const { originFees } = await getFeesForIncoterm(incotermStr, modalForRules, taxavel, fVal, fCurr, quotation.direction, feeContext);
        if (originFees.length > 0) {
          detailedFeesOrigem = formatFeesForController(originFees, getBrlValue).map(f => ({ ...normalizeFee({ name:f.name, currency:f.currency, applicationScope:'ORIGIN' }), ...f }));
        }
      } catch (err) {
        console.error('Erro ao buscar regras de Incoterm para origem:', err);
      }
    }

    if (quotation.originInlandValue !== null && quotation.originInlandValue !== undefined) {
      const value = parseFloat(String(quotation.originInlandValue)) || 0;
      const currency = quotation.originInlandCurrency || 'USD';
      detailedFeesOrigem.unshift({
        name: `Inland de Origem / Coleta${quotation.originInlandRoute ? ` (${quotation.originInlandRoute})` : ''}`,
        val: value,
        currency,
        brl: getBrlValue(value, currency)
      });
    }

    if (shouldHydrateAutomaticCosts(quotation) && detailedFeesDestino.length === 0) {
      try {
        const { destinationFees } = await getFeesForIncoterm(incotermStr, modalForRules, taxavel, fVal, fCurr, quotation.direction, feeContext);
        if (destinationFees.length > 0) {
          detailedFeesDestino = formatFeesForController(destinationFees, getBrlValue).map(f => ({ ...normalizeFee({ name:f.name, currency:f.currency, applicationScope:'DESTINATION' }), ...f }));
        }
      } catch (err) {
        console.error('Erro ao buscar regras de Incoterm para destino:', err);
      }
    } else if (shouldHydrateAutomaticCosts(quotation)) {
      // Complementar taxas faltantes com regras do banco
      try {
          const { destinationFees } = await getFeesForIncoterm(incotermStr, modalForRules, taxavel, fVal, fCurr, quotation.direction, feeContext);
        const existingNames = new Set(detailedFeesDestino.map(f => f.name.toLowerCase()));
        for (const ruleFee of destinationFees) {
          const nameMatch = existingNames.has(ruleFee.name.toLowerCase()) ||
            (ruleFee.name.toLowerCase().includes('cct') && detailedFeesDestino.some(f => f.name.toLowerCase().includes('cct'))) ||
            (ruleFee.name.toLowerCase().includes('collect') && detailedFeesDestino.some(f => f.name.toLowerCase().includes('collect'))) ||
            (ruleFee.name.toLowerCase().includes('delivery') && detailedFeesDestino.some(f => f.name.toLowerCase().includes('delivery'))) ||
            (ruleFee.name.toLowerCase().includes('desconsolida') && detailedFeesDestino.some(f => f.name.toLowerCase().includes('desconsolida') || f.name.toLowerCase().includes('deconsolidation'))) ||
            (ruleFee.name.toLowerCase().includes('iof') && detailedFeesDestino.some(f => f.name.toLowerCase().includes('iof')));
          if (!nameMatch) {
            detailedFeesDestino.push({
              ...normalizeFee({ name:ruleFee.name, currency:ruleFee.currency, applicationScope:'DESTINATION' }),
              name: ruleFee.name,
              val: ruleFee.value,
              currency: ruleFee.currency,
              brl: getBrlValue(ruleFee.value, ruleFee.currency)
            });
          }
        }
      } catch (err) {
        console.error('Erro ao complementar regras de Incoterm para destino:', err);
      }
    }

    // Desembaraço (Condicional ao flag — independente do Incoterm)
    if (quotation.customsClearanceIncluded && !detailedFeesDestino.some(f => f.name.toLowerCase().includes('desembaraço'))) {
      detailedFeesDestino.push({ name: 'Desembaraço Aduaneiro', val: 900.00, currency: 'BRL', brl: 900.00, financialGroup:'CUSTOMS_CHARGE', chargeNature:'CUSTOMS' });
    }

    // Frete detalhado: se o fallback da árvore trouxe mais de um item e o modo
    // escolhido é "itemizado", mostra só o primeiro como frete principal e o
    // restante entra como componentes de frete (mesmo grupo já usado quando uma
    // taxa extraída é classificada como acessório de frete).
    if (quotation.freightDisplayMode === 'ITEMIZED' && resolvedFreight.fromFallback && resolvedFreight.items.length > 1) {
      const [mainItem, ...accessoryItems] = resolvedFreight.items;
      accessoryItems.forEach(item => {
        detailedFeesDestino.push({
          name: item.name,
          val: item.value,
          currency: item.currency,
          brl: getBrlValue(item.value, item.currency),
          financialGroup: 'FREIGHT_COMPONENT'
        });
      });
      fVal = mainItem!.value;
      fCurr = mainItem!.currency;
      fTotalBrl = getBrlValue(fVal, fCurr);
    }

    quotation.groundServiceLegs.filter(leg => leg.requested && leg.value != null).forEach(leg => {
      const item = { name:leg.serviceType === 'DTA' ? `DTA / Trânsito Aduaneiro${leg.route ? ` (${leg.route})` : ''}` : `Frete Rodoviário Nacional${leg.route ? ` (${leg.route})` : ''}`,
        val:Number(leg.value), currency:leg.currency || 'BRL', brl:getBrlValue(Number(leg.value), leg.currency || 'BRL'),
        financialGroup:leg.serviceType === 'DTA' ? 'FREIGHT_COMPONENT' : 'DESTINATION_CHARGE', chargeNature:'LOCAL_SERVICE' };
      if (leg.serviceType === 'DTA') detailedFeesOrigem.push(item); else detailedFeesDestino.push(item);
    });

    const detailedFeesFreightComponents = [...detailedFeesOrigem, ...detailedFeesDestino].filter(f => f.financialGroup === 'FREIGHT_COMPONENT');
    const additionalGroups = new Set(['DG_CHARGE','CUSTOMS_CHARGE','INSURANCE','TAX_IOF','PROFIT']);
    const additionalLabels: Record<string,string> = { DG_CHARGE:'Taxa DG', CUSTOMS_CHARGE:'Taxa aduaneira', INSURANCE:'Seguro', TAX_IOF:'Impostos / IOF', PROFIT:'Profit' };
    const detailedFeesAdditionalGroups = [...detailedFeesOrigem, ...detailedFeesDestino].filter(f => additionalGroups.has(f.financialGroup)).map(f => ({ ...f, financialGroupLabel: additionalLabels[f.financialGroup] || f.financialGroup }));
    detailedFeesOrigem = detailedFeesOrigem.filter(f => f.financialGroup !== 'FREIGHT_COMPONENT' && !additionalGroups.has(f.financialGroup));
    detailedFeesDestino = detailedFeesDestino.filter(f => f.financialGroup !== 'FREIGHT_COMPONENT' && !additionalGroups.has(f.financialGroup));
    const subtotalFreightComponentsBrl = detailedFeesFreightComponents.reduce((s, f) => s + f.brl, 0);
    const subtotalAdditionalBrl = detailedFeesAdditionalGroups.reduce((s, f) => s + f.brl, 0);
    const subtotalOrigemBrl = detailedFeesOrigem.reduce((s, f) => s + f.brl, 0);
    const subtotalDestinoBrl = detailedFeesDestino.reduce((s, f) => s + f.brl, 0);
    const totalGeralBrl = fTotalBrl + subtotalFreightComponentsBrl + subtotalOrigemBrl + subtotalDestinoBrl + subtotalAdditionalBrl;

    const hasOversized = isAir && hasOversizedCargo(quotation.packages || '');
    const oversizedAlertHtml = hasOversized
      ? `
    <div class="alert-box" style="border-left-color: #ef4444; background: rgba(239, 68, 68, 0.1); color: #fca5a5; margin-bottom: 20px;">
      <strong>⚠️ Atenção - Carga Sobredimensionada:</strong> Esta carga possui caixas que ultrapassam os limites padrão de aviação comercial (comprimento > 300 cm, largura > 200 cm ou altura > 160 cm). Será necessária a confirmação prévia de preço e espaço com a companhia aérea para viabilizar o embarque.
    </div>
      `
      : '';

    // Renderizar página HTML
    res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cotação de Frete - ${quotation.reference || 'Audaz'}</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --navy: #1B2B6B;
      --navy-light: #243572;
      --gold: #F5A623;
      --bg: #0f1629;
      --bg-card: #1a2340;
      --border: #2a3558;
      --text: #e4e8f1;
      --text-muted: #8892a8;
      --success: #34d399;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Outfit', sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 40px 20px;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .container {
      max-width: 900px;
      width: 100%;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 40px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid var(--border);
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header h1 {
      font-size: 24px;
      font-weight: 800;
      color: #fff;
    }
    .header h1 span { color: var(--gold); }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
      background: rgba(0,0,0,0.2);
      padding: 20px;
      border-radius: 12px;
      border: 1px solid var(--border);
    }
    .meta-item {
      display: flex;
      flex-direction: column;
    }
    .meta-label {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .meta-value {
      font-size: 16px;
      font-weight: 600;
      color: #fff;
    }
    .alert-box {
      background: rgba(245, 166, 35, 0.1);
      border-left: 4px solid var(--gold);
      padding: 15px 20px;
      border-radius: 8px;
      font-size: 13px;
      line-height: 1.5;
      margin-bottom: 30px;
      color: #ffd88a;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
    }
    th, td {
      padding: 12px 16px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
    }
    .section-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--gold);
      padding-top: 15px;
      border-bottom: none;
    }
    .t-right { text-align: right; }
    .total-row {
      background: rgba(255,255,255,0.03);
      font-weight: 700;
    }
    .grand-total {
      font-size: 20px;
      color: var(--success);
    }
    .btn {
      display: inline-block;
      background: linear-gradient(135deg, var(--gold), #e8951a);
      color: #1b2b6b;
      padding: 12px 30px;
      border-radius: 30px;
      text-decoration: none;
      font-weight: 700;
      font-size: 14px;
      text-align: center;
      transition: all 0.3s;
      cursor: pointer;
      border: none;
      box-shadow: 0 4px 15px rgba(245,166,35,0.3);
    }
    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(245,166,35,0.5);
    }
    .footer {
      text-align: center;
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 40px;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Audaz <span>Global</span></h1>
      <div><a class="btn" href="/api/quotations/${quotation.id}/pdf" download>📥 Baixar PDF</a></div>
    </div>

    <div class="alert-box">
      <strong>⚠️ Aviso de Variação Cambial:</strong> Os valores abaixo foram convertidos para BRL com base na taxa de câmbio de hoje (USD: R$ ${usdRate.toFixed(4)} | EUR: R$ ${eurRate.toFixed(4)}). A cotação final em BRL varia conforme o câmbio oficial na data do embarque.
    </div>
    \${oversizedAlertHtml}

    <div class="meta-grid" style="grid-template-columns: repeat(3, 1fr);">
      <div class="meta-item">
        <span class="meta-label">Referência</span>
        <span class="meta-value">${quotation.reference || '—'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Cliente</span>
        <span class="meta-value">${quotation.client?.name || '—'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Modal / Incoterm</span>
        <span class="meta-value">${quotation.modal} / ${quotation.incoterm || '—'}</span>
      </div>
      
      <div class="meta-item">
        <span class="meta-label">Origem</span>
        <span class="meta-value">${quotation.originPort || '—'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">País</span>
        <span class="meta-value"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px; margin-top:-2px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>${quotation.originCountry || '—'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Local Inicial</span>
        <span class="meta-value">${quotation.originCity || '—'}</span>
      </div>

      <div class="meta-item">
        <span class="meta-label">Destino</span>
        <span class="meta-value">${quotation.destinationPort || '—'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">País</span>
        <span class="meta-value"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px; margin-top:-2px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>${quotation.destinationCountry || '—'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Destino Final</span>
        <span class="meta-value">${quotation.destinationCity || '—'}</span>
      </div>

      ${quotation.hideCarrierName ? '' : `
      <div class="meta-item">
        <span class="meta-label">Cia Aérea / Armador</span>
        <span class="meta-value">${quotation.carrier || '—'}</span>
      </div>`}
      <div class="meta-item"><span class="meta-label">Navio / Viagem</span><span class="meta-value">${[quotation.vesselName, quotation.voyageNumber].filter(Boolean).join(' / ') || '—'}</span></div>
      <div class="meta-item"><span class="meta-label">Free time</span><span class="meta-value">${quotation.freeTimeDays != null ? quotation.freeTimeDays + ' dias' : '—'}</span></div>
      <div class="meta-item">
        <span class="meta-label">Frequência</span>
        <span class="meta-value">${quotation.frequency || 'Semanal'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Conexões</span>
        <span class="meta-value" style="color: var(--gold);">${quotation.connections || 'Sem conexões'}</span>
      </div>

      <div class="meta-item">
        <span class="meta-label">Peso Bruto / Cubado</span>
        <span class="meta-value">${bruto.toFixed(2)} kg / ${cubado.toFixed(2)} kg</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Peso Taxável</span>
        <span class="meta-value">${taxavel.toFixed(2)} kg</span>
      </div>
      <div class="meta-item">
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Taxa</th>
          <th>Cálculo</th>
          <th class="t-right">Valor Original</th>
          <th class="t-right">Convertido (BRL)</th>
        </tr>
      </thead>
      <tbody>
        <!-- Frete -->
        <tr>
          <td colspan="4" class="section-title">Frete Internacional</td>
        </tr>
        <tr>
          <td>International Freight</td>
          <td>Por Kg/cm3 (6000)</td>
          <td class="t-right">${fCurr} ${(fVal / taxavel).toFixed(2)} / kg</td>
          <td class="t-right">R$ ${(fTotalBrl / taxavel).toFixed(2)} / kg</td>
        </tr>
        ${detailedFeesFreightComponents.map(fee => `
        <tr>
          <td>${fee.name}</td><td>Componente do frete${fee.chargeNature ? ` · ${fee.chargeNature}` : ''}</td>
          <td class="t-right">${fee.currency} ${fee.val.toFixed(2)}</td><td class="t-right">R$ ${fee.brl.toFixed(2)}</td>
        </tr>`).join('')}
        <tr class="total-row">
          <td>Subtotal Frete</td>
          <td></td>
          <td class="t-right">${fCurr} ${fVal.toFixed(2)}</td>
          <td class="t-right">R$ ${(fTotalBrl + subtotalFreightComponentsBrl).toFixed(2)}</td>
        </tr>

        <!-- Origem -->
        <tr>
          <td colspan="4" class="section-title">Origem</td>
        </tr>
        ${detailedFeesOrigem.map(fee => `
        <tr>
          <td>${fee.name}</td>
          <td>Fixo / Unitário</td>
          <td class="t-right">${fee.currency} ${fee.val.toFixed(2)}</td>
          <td class="t-right">R$ ${fee.brl.toFixed(2)}</td>
        </tr>
        `).join('')}
        <tr class="total-row">
          <td>Subtotal Origem</td>
          <td></td>
          <td class="t-right">—</td>
          <td class="t-right">R$ ${subtotalOrigemBrl.toFixed(2)}</td>
        </tr>

        <!-- Destino -->
        <tr>
          <td colspan="4" class="section-title">Destino (Local)</td>
        </tr>
        ${detailedFeesDestino.map(fee => `
        <tr>
          <td>${fee.name}</td>
          <td>Fixo / Variável</td>
          <td class="t-right">${fee.currency} ${fee.val.toFixed(2)}</td>
          <td class="t-right">R$ ${fee.brl.toFixed(2)}</td>
        </tr>
        `).join('')}
        <tr class="total-row">
          <td>Subtotal Destino</td>
          <td></td>
          <td class="t-right">—</td>
          <td class="t-right">R$ ${subtotalDestinoBrl.toFixed(2)}</td>
        </tr>

        ${detailedFeesAdditionalGroups.length ? `
        <tr><td colspan="4" class="section-title">Taxas DG, aduaneiras, seguro, impostos e profit</td></tr>
        ${detailedFeesAdditionalGroups.map(fee => `<tr><td>${fee.financialGroupLabel}: ${fee.name}</td><td>${fee.chargeNature || 'Outra'}</td><td class="t-right">${fee.currency} ${fee.val.toFixed(2)}</td><td class="t-right">R$ ${fee.brl.toFixed(2)}</td></tr>`).join('')}
        <tr class="total-row"><td>Subtotal de outras classificações</td><td></td><td></td><td class="t-right">R$ ${subtotalAdditionalBrl.toFixed(2)}</td></tr>` : ''}

        <!-- Total Geral -->
        <tr class="total-row grand-total">
          <td>TOTAL GERAL ESTIMADO (BRL)</td>
          <td></td>
          <td></td>
          <td class="t-right">R$ ${totalGeralBrl.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>

    <div class="footer">
      AUDAZ GLOBAL LOGISTICA LTDA | https://audazglobal.com<br>
      Gerado automaticamente pelo Audaz System
    </div>
  </div>
</body>
</html>
    `);
  } catch (error: any) {
    res.status(500).send('Erro ao renderizar visualização web: ' + error.message);
  }
};

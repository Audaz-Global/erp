import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  effectiveIncotermRule,
  findOrCreateStandardFeeForLegacyRule,
  standardFeeSnapshot
} from '../services/standardFeeLinkService';

const prisma = new PrismaClient();
const VALID_DIRECTIONS = new Set(['IMPORT', 'EXPORT', 'ALL']);

function normalizeDirection(value: unknown) {
  const direction = String(value || 'ALL').toUpperCase();
  if (!VALID_DIRECTIONS.has(direction)) throw new Error('Direção inválida.');
  return direction;
}

function feeSupportsModal(fee: any, modal: string) {
  const scopes = String(fee?.modalScope || 'ALL').toUpperCase().split(',').map((item: string) => item.trim());
  return scopes.includes('ALL') || scopes.includes(String(modal).toUpperCase()) || String(modal).toUpperCase() === 'ALL';
}

// Lista todas as regras, com filtro opcional por incoterm e modal
export const getIncotermRules = async (req: Request, res: Response) => {
  try {
    const { incoterm, modal, direction } = req.query;
    const where: any = {};
    if (incoterm) where.incoterm = { in: [String(incoterm).toUpperCase(), 'ALL'] };
    if (modal) where.modal = { in: [String(modal).toUpperCase(), 'ALL'] };
    if (direction) where.direction = { in: [String(direction).toUpperCase(), 'ALL'] };

    const rules = await prisma.incotermRule.findMany({
      where,
      include: { standardFee: true },
      orderBy: [
        { incoterm: 'asc' },
        { feeType: 'asc' },
        { sortOrder: 'asc' }
      ]
    });
    res.json(rules.map(effectiveIncotermRule));
  } catch (error) {
    console.error('Erro ao buscar regras de incoterm:', error);
    res.status(500).json({ error: 'Erro ao buscar regras de incoterm.' });
  }
};

// Cria uma nova regra
export const createIncotermRule = async (req: Request, res: Response) => {
  try {
    const { incoterm, modal, direction, originScope, destinationScope, required, standardFeeId, feeType, feeName, chargeType, value, minValue, currency, percentBase, description, sortOrder, active } = req.body;
    let fee = standardFeeId ? await prisma.standardFee.findUnique({ where: { id: standardFeeId } }) : null;
    if (!fee && feeName) {
      fee = await findOrCreateStandardFeeForLegacyRule(prisma, {
        feeName,
        feeType,
        chargeType,
        value: Number(value),
        minValue: minValue !== undefined && minValue !== null ? Number(minValue) : null,
        currency: currency || 'USD',
        percentBase: percentBase || null,
        description: description || null,
        active: active !== undefined ? active : true
      } as any);
    }
    if (!fee) return res.status(400).json({ error: 'Selecione uma taxa local para vincular ao Incoterm.' });

    const normalizedIncoterm = String(incoterm).toUpperCase();
    const normalizedModal = String(modal).toUpperCase();
    const normalizedDirection = normalizeDirection(direction);
    if (!feeSupportsModal(fee, normalizedModal)) return res.status(400).json({ error: 'A taxa selecionada não é compatível com este modal. Ajuste a compatibilidade no cadastro da taxa.' });
    const duplicate = await prisma.incotermRule.findFirst({
      where: { incoterm: normalizedIncoterm, modal: normalizedModal, direction: normalizedDirection, originScope: originScope?.trim() || null, destinationScope: destinationScope?.trim() || null, standardFeeId: fee.id } as any
    });
    if (duplicate) return res.status(409).json({ error: 'Esta taxa já está vinculada ao Incoterm e modal selecionados.' });

    const rule = await prisma.incotermRule.create({
      data: {
        incoterm: normalizedIncoterm,
        modal: normalizedModal,
        direction: normalizedDirection,
        originScope: originScope?.trim() || null,
        destinationScope: destinationScope?.trim() || null,
        required: Boolean(required),
        standardFeeId: fee.id,
        ...standardFeeSnapshot(fee),
        sortOrder: sortOrder !== undefined ? Number(sortOrder) : 0,
        active: active !== undefined ? active : true,
      } as any,
      include: { standardFee: true }
    });
    res.status(201).json(effectiveIncotermRule(rule));
  } catch (error) {
    console.error('Erro ao criar regra de incoterm:', error);
    res.status(500).json({ error: 'Erro ao criar regra de incoterm.' });
  }
};

// Atualiza uma regra
export const updateIncotermRule = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { incoterm, modal, direction, originScope, destinationScope, required, standardFeeId, sortOrder, active } = req.body;
    const current = await prisma.incotermRule.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: 'Regra de Incoterm não encontrada.' });

    const feeId = standardFeeId || current.standardFeeId;
    const fee = feeId ? await prisma.standardFee.findUnique({ where: { id: feeId } }) : null;
    if (!fee) return res.status(400).json({ error: 'Selecione uma taxa local válida.' });

    const normalizedIncoterm = incoterm ? String(incoterm).toUpperCase() : current.incoterm;
    const normalizedModal = modal ? String(modal).toUpperCase() : current.modal;
    const normalizedDirection = direction !== undefined ? normalizeDirection(direction) : current.direction;
    if (!feeSupportsModal(fee, normalizedModal)) return res.status(400).json({ error: 'A taxa selecionada não é compatível com este modal. Ajuste a compatibilidade no cadastro da taxa.' });
    const duplicate = await prisma.incotermRule.findFirst({
      where: {
        id: { not: id },
        incoterm: normalizedIncoterm,
        modal: normalizedModal,
        direction: normalizedDirection,
        ...(originScope !== undefined && { originScope: String(originScope).trim() || null }),
        ...(destinationScope !== undefined && { destinationScope: String(destinationScope).trim() || null }),
        standardFeeId: fee.id
      }
    });
    if (duplicate) return res.status(409).json({ error: 'Esta taxa já está vinculada ao Incoterm e modal selecionados.' });
    
    const rule = await prisma.incotermRule.update({
      where: { id },
      data: {
        incoterm: normalizedIncoterm,
        modal: normalizedModal,
        direction: normalizedDirection,
        ...(required !== undefined && { required: Boolean(required) }),
        standardFeeId: fee.id,
        ...standardFeeSnapshot(fee),
        ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) }),
        ...(active !== undefined && { active })
      },
      include: { standardFee: true }
    });
    res.json(effectiveIncotermRule(rule));
  } catch (error) {
    console.error('Erro ao atualizar regra de incoterm:', error);
    res.status(500).json({ error: 'Erro ao atualizar regra de incoterm.' });
  }
};

// Remove uma regra
export const deleteIncotermRule = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.incotermRule.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error('Erro ao excluir regra de incoterm:', error);
    res.status(500).json({ error: 'Erro ao excluir regra de incoterm.' });
  }
};

// Popula regras padrão baseadas nos Incoterms ICC 2020
export const seedIncotermRules = async (req: Request, res: Response) => {
  try {
    // Limpar regras existentes (opcional, via query param ?clear=true)
    if (req.query.clear === 'true') {
      await prisma.incotermRule.deleteMany({});
    }

    const existing = await prisma.incotermRule.count();
    if (existing > 0) {
      res.json({ message: `Já existem ${existing} regras no banco. Use ?clear=true para resetar.` });
      return;
    }

    const rules = getDefaultRules();
    
    for (const rule of rules) {
      const fee = await findOrCreateStandardFeeForLegacyRule(prisma, rule as any);
      await prisma.incotermRule.create({
        data: { ...rule, standardFeeId: fee.id }
      });
    }

    res.json({ message: `${rules.length} regras de Incoterm criadas com sucesso!` });
  } catch (error) {
    console.error('Erro ao popular regras de incoterm:', error);
    res.status(500).json({ error: 'Erro ao popular regras de incoterm.' });
  }
};

function getDefaultRules() {
  return [
    // ============================
    // EXW - Ex Works (Aéreo)
    // Comprador responsável por TUDO desde a fábrica do vendedor
    // ============================
    {
      incoterm: 'EXW', modal: 'AIR', feeType: 'ORIGIN', feeName: 'Origin Charges (Coleta, Doc, Handling, Despacho)',
      chargeType: 'FIXED', value: 91.00, currency: 'USD', sortOrder: 1,
      description: 'Custos consolidados de coleta na fábrica, documentação, handling e despacho de exportação — responsabilidade do comprador no EXW'
    },

    // ============================
    // FCA - Free Carrier (Aéreo)
    // Vendedor entrega ao transportador. Comprador paga frete + taxas aeroportuárias
    // ============================
    {
      incoterm: 'FCA', modal: 'AIR', feeType: 'ORIGIN', feeName: 'Airport Fee',
      chargeType: 'PER_KG', value: 0.15, minValue: 45.00, currency: 'USD', sortOrder: 1,
      description: 'Taxa aeroportuária por kg (peso taxável), mínimo USD 45'
    },
    {
      incoterm: 'FCA', modal: 'AIR', feeType: 'ORIGIN', feeName: 'AWB Fee',
      chargeType: 'PER_DOCUMENT', value: 16.00, currency: 'USD', sortOrder: 2,
      description: 'Emissão do Air Waybill (conhecimento de transporte aéreo)'
    },
    {
      incoterm: 'FCA', modal: 'AIR', feeType: 'ORIGIN', feeName: 'Handling',
      chargeType: 'FIXED', value: 30.00, currency: 'USD', sortOrder: 3,
      description: 'Manuseio de carga na origem'
    },

    // ============================
    // FOB - Free On Board (Marítimo)
    // Vendedor entrega a bordo do navio. Sem taxas de origem para o comprador.
    // FOB é exclusivo para modal marítimo (ICC 2020)
    // ============================
    // (FOB não tem taxas de origem — o vendedor assume até o bordo do navio)

    // ============================
    // CIF - Cost, Insurance & Freight (Marítimo)
    // Vendedor paga frete + seguro até o porto de destino.
    // Comprador responsável apenas por taxas de destino.
    // CIF é exclusivo para modal marítimo (ICC 2020)
    // ============================
    // (CIF não tem taxas de origem — vendedor paga tudo até destino)

    // ============================
    // CFR - Cost & Freight (Marítimo)
    // Vendedor paga frete até porto de destino, sem seguro.
    // Similar ao CIF mas sem seguro.
    // ============================
    // (CFR não tem taxas de origem — vendedor paga frete)

    // ============================
    // DAP - Delivered at Place
    // Vendedor entrega no local de destino, pronto para descarga.
    // Comprador paga apenas descarga + importação.
    // ============================
    // (DAP não tem taxas de origem — vendedor entrega no destino)

    // ============================
    // DDP - Delivered Duty Paid
    // Vendedor assume TODOS os custos, inclusive impostos de importação.
    // Comprador tem custos mínimos ou nenhum.
    // ============================
    // (DDP não tem taxas de origem nem de destino significativas)

    // ============================
    // TAXAS DE DESTINO — Aplicáveis a TODOS os Incoterms (Modal Aéreo)
    // Estas são taxas locais de importação no Brasil
    // ============================
    {
      incoterm: 'EXW', modal: 'AIR', feeType: 'DESTINATION', feeName: 'CCT fee',
      chargeType: 'FIXED', value: 10.00, currency: 'USD', sortOrder: 1,
      description: 'Taxa de controle de carga terminal'
    },
    {
      incoterm: 'EXW', modal: 'AIR', feeType: 'DESTINATION', feeName: 'Collect Fee',
      chargeType: 'PERCENTAGE', value: 3.00, minValue: 50.00, currency: 'USD',
      percentBase: 'FREIGHT_PLUS_ORIGIN', sortOrder: 2,
      description: 'Taxa de coleta — 3% sobre frete + taxas de origem, mínimo USD 50'
    },
    {
      incoterm: 'EXW', modal: 'AIR', feeType: 'DESTINATION', feeName: 'Delivery Fee',
      chargeType: 'PER_DOCUMENT', value: 55.00, currency: 'USD', sortOrder: 3,
      description: 'Taxa de entrega por documento'
    },
    {
      incoterm: 'EXW', modal: 'AIR', feeType: 'DESTINATION', feeName: 'Desconsolidação / Deconsolidation',
      chargeType: 'PER_DOCUMENT', value: 55.00, currency: 'USD', sortOrder: 4,
      description: 'Taxa de desconsolidação de carga'
    },
    {
      incoterm: 'EXW', modal: 'AIR', feeType: 'DESTINATION', feeName: 'IOF - FRETE + TX ORIGEM',
      chargeType: 'PERCENTAGE', value: 3.50, currency: 'USD',
      percentBase: 'FREIGHT_PLUS_ORIGIN', sortOrder: 5,
      description: 'IOF sobre frete + taxas de origem — 3.5%'
    },

    // FCA - Destino Aéreo
    {
      incoterm: 'FCA', modal: 'AIR', feeType: 'DESTINATION', feeName: 'CCT fee',
      chargeType: 'FIXED', value: 10.00, currency: 'USD', sortOrder: 1,
      description: 'Taxa de controle de carga terminal'
    },
    {
      incoterm: 'FCA', modal: 'AIR', feeType: 'DESTINATION', feeName: 'Collect Fee',
      chargeType: 'PERCENTAGE', value: 3.00, minValue: 50.00, currency: 'USD',
      percentBase: 'FREIGHT_PLUS_ORIGIN', sortOrder: 2,
      description: 'Taxa de coleta — 3% sobre frete + taxas de origem, mínimo USD 50'
    },
    {
      incoterm: 'FCA', modal: 'AIR', feeType: 'DESTINATION', feeName: 'Delivery Fee',
      chargeType: 'PER_DOCUMENT', value: 55.00, currency: 'USD', sortOrder: 3,
      description: 'Taxa de entrega por documento'
    },
    {
      incoterm: 'FCA', modal: 'AIR', feeType: 'DESTINATION', feeName: 'Desconsolidação / Deconsolidation',
      chargeType: 'PER_DOCUMENT', value: 55.00, currency: 'USD', sortOrder: 4,
      description: 'Taxa de desconsolidação de carga'
    },
    {
      incoterm: 'FCA', modal: 'AIR', feeType: 'DESTINATION', feeName: 'IOF - FRETE + TX ORIGEM',
      chargeType: 'PERCENTAGE', value: 3.50, currency: 'USD',
      percentBase: 'FREIGHT_PLUS_ORIGIN', sortOrder: 5,
      description: 'IOF sobre frete + taxas de origem — 3.5%'
    },

    // FOB - Destino Marítimo
    {
      incoterm: 'FOB', modal: 'SEA_FCL', feeType: 'DESTINATION', feeName: 'CCT fee',
      chargeType: 'FIXED', value: 10.00, currency: 'USD', sortOrder: 1,
      description: 'Taxa de controle de carga terminal'
    },
    {
      incoterm: 'FOB', modal: 'SEA_FCL', feeType: 'DESTINATION', feeName: 'Collect Fee',
      chargeType: 'PERCENTAGE', value: 3.00, minValue: 50.00, currency: 'USD',
      percentBase: 'FREIGHT_PLUS_ORIGIN', sortOrder: 2,
      description: 'Taxa de coleta — 3% sobre frete, mínimo USD 50'
    },
    {
      incoterm: 'FOB', modal: 'SEA_FCL', feeType: 'DESTINATION', feeName: 'Delivery Fee',
      chargeType: 'PER_DOCUMENT', value: 55.00, currency: 'USD', sortOrder: 3,
      description: 'Taxa de entrega por documento'
    },
    {
      incoterm: 'FOB', modal: 'SEA_FCL', feeType: 'DESTINATION', feeName: 'IOF - FRETE + TX ORIGEM',
      chargeType: 'PERCENTAGE', value: 3.50, currency: 'USD',
      percentBase: 'FREIGHT_PLUS_ORIGIN', sortOrder: 4,
      description: 'IOF sobre frete — 3.5%'
    },

    // FOB - Destino Marítimo LCL
    {
      incoterm: 'FOB', modal: 'SEA_LCL', feeType: 'DESTINATION', feeName: 'CCT fee',
      chargeType: 'FIXED', value: 10.00, currency: 'USD', sortOrder: 1,
      description: 'Taxa de controle de carga terminal'
    },
    {
      incoterm: 'FOB', modal: 'SEA_LCL', feeType: 'DESTINATION', feeName: 'Collect Fee',
      chargeType: 'PERCENTAGE', value: 3.00, minValue: 50.00, currency: 'USD',
      percentBase: 'FREIGHT_PLUS_ORIGIN', sortOrder: 2,
      description: 'Taxa de coleta — 3% sobre frete, mínimo USD 50'
    },
    {
      incoterm: 'FOB', modal: 'SEA_LCL', feeType: 'DESTINATION', feeName: 'Delivery Fee',
      chargeType: 'PER_DOCUMENT', value: 55.00, currency: 'USD', sortOrder: 3,
      description: 'Taxa de entrega por documento'
    },
    {
      incoterm: 'FOB', modal: 'SEA_LCL', feeType: 'DESTINATION', feeName: 'Desconsolidação / Deconsolidation',
      chargeType: 'PER_DOCUMENT', value: 55.00, currency: 'USD', sortOrder: 4,
      description: 'Taxa de desconsolidação de carga LCL'
    },
    {
      incoterm: 'FOB', modal: 'SEA_LCL', feeType: 'DESTINATION', feeName: 'IOF - FRETE + TX ORIGEM',
      chargeType: 'PERCENTAGE', value: 3.50, currency: 'USD',
      percentBase: 'FREIGHT_PLUS_ORIGIN', sortOrder: 5,
      description: 'IOF sobre frete — 3.5%'
    },

    // CIF - Destino Marítimo (vendedor já pagou frete + seguro)
    {
      incoterm: 'CIF', modal: 'SEA_FCL', feeType: 'DESTINATION', feeName: 'CCT fee',
      chargeType: 'FIXED', value: 10.00, currency: 'USD', sortOrder: 1,
      description: 'Taxa de controle de carga terminal'
    },
    {
      incoterm: 'CIF', modal: 'SEA_FCL', feeType: 'DESTINATION', feeName: 'Delivery Fee',
      chargeType: 'PER_DOCUMENT', value: 55.00, currency: 'USD', sortOrder: 2,
      description: 'Taxa de entrega por documento'
    },
    {
      incoterm: 'CIF', modal: 'SEA_FCL', feeType: 'DESTINATION', feeName: 'IOF - FRETE + TX ORIGEM',
      chargeType: 'PERCENTAGE', value: 3.50, currency: 'USD',
      percentBase: 'FREIGHT', sortOrder: 3,
      description: 'IOF sobre frete — 3.5%'
    },
    {
      incoterm: 'CIF', modal: 'SEA_LCL', feeType: 'DESTINATION', feeName: 'CCT fee',
      chargeType: 'FIXED', value: 10.00, currency: 'USD', sortOrder: 1,
      description: 'Taxa de controle de carga terminal'
    },
    {
      incoterm: 'CIF', modal: 'SEA_LCL', feeType: 'DESTINATION', feeName: 'Delivery Fee',
      chargeType: 'PER_DOCUMENT', value: 55.00, currency: 'USD', sortOrder: 2,
      description: 'Taxa de entrega por documento'
    },
    {
      incoterm: 'CIF', modal: 'SEA_LCL', feeType: 'DESTINATION', feeName: 'Desconsolidação / Deconsolidation',
      chargeType: 'PER_DOCUMENT', value: 55.00, currency: 'USD', sortOrder: 3,
      description: 'Taxa de desconsolidação de carga LCL'
    },
    {
      incoterm: 'CIF', modal: 'SEA_LCL', feeType: 'DESTINATION', feeName: 'IOF - FRETE + TX ORIGEM',
      chargeType: 'PERCENTAGE', value: 3.50, currency: 'USD',
      percentBase: 'FREIGHT', sortOrder: 4,
      description: 'IOF sobre frete — 3.5%'
    },

    // CFR - Destino Marítimo (vendedor paga frete, sem seguro)
    {
      incoterm: 'CFR', modal: 'SEA_FCL', feeType: 'DESTINATION', feeName: 'CCT fee',
      chargeType: 'FIXED', value: 10.00, currency: 'USD', sortOrder: 1,
      description: 'Taxa de controle de carga terminal'
    },
    {
      incoterm: 'CFR', modal: 'SEA_FCL', feeType: 'DESTINATION', feeName: 'Delivery Fee',
      chargeType: 'PER_DOCUMENT', value: 55.00, currency: 'USD', sortOrder: 2,
      description: 'Taxa de entrega por documento'
    },
    {
      incoterm: 'CFR', modal: 'SEA_FCL', feeType: 'DESTINATION', feeName: 'IOF - FRETE + TX ORIGEM',
      chargeType: 'PERCENTAGE', value: 3.50, currency: 'USD',
      percentBase: 'FREIGHT', sortOrder: 3,
      description: 'IOF sobre frete — 3.5%'
    },

    // DAP - Destino (vendedor entrega no destino, comprador descarrega + importação)
    {
      incoterm: 'DAP', modal: 'AIR', feeType: 'DESTINATION', feeName: 'CCT fee',
      chargeType: 'FIXED', value: 10.00, currency: 'USD', sortOrder: 1,
      description: 'Taxa de controle de carga terminal'
    },
    {
      incoterm: 'DAP', modal: 'AIR', feeType: 'DESTINATION', feeName: 'Delivery Fee',
      chargeType: 'PER_DOCUMENT', value: 55.00, currency: 'USD', sortOrder: 2,
      description: 'Taxa de entrega por documento'
    },
    {
      incoterm: 'DAP', modal: 'AIR', feeType: 'DESTINATION', feeName: 'IOF - FRETE + TX ORIGEM',
      chargeType: 'PERCENTAGE', value: 3.50, currency: 'USD',
      percentBase: 'FREIGHT', sortOrder: 3,
      description: 'IOF sobre frete — 3.5%'
    },
    {
      incoterm: 'DAP', modal: 'SEA_FCL', feeType: 'DESTINATION', feeName: 'CCT fee',
      chargeType: 'FIXED', value: 10.00, currency: 'USD', sortOrder: 1,
      description: 'Taxa de controle de carga terminal'
    },
    {
      incoterm: 'DAP', modal: 'SEA_FCL', feeType: 'DESTINATION', feeName: 'Delivery Fee',
      chargeType: 'PER_DOCUMENT', value: 55.00, currency: 'USD', sortOrder: 2,
      description: 'Taxa de entrega por documento'
    },
    {
      incoterm: 'DAP', modal: 'SEA_FCL', feeType: 'DESTINATION', feeName: 'IOF - FRETE + TX ORIGEM',
      chargeType: 'PERCENTAGE', value: 3.50, currency: 'USD',
      percentBase: 'FREIGHT', sortOrder: 3,
      description: 'IOF sobre frete — 3.5%'
    },

    // DDP - Destino (vendedor paga tudo inclusive impostos — custos mínimos para comprador)
    {
      incoterm: 'DDP', modal: 'AIR', feeType: 'DESTINATION', feeName: 'CCT fee',
      chargeType: 'FIXED', value: 10.00, currency: 'USD', sortOrder: 1,
      description: 'Taxa de controle de carga terminal (pode ser isenta em DDP conforme contrato)'
    },
    {
      incoterm: 'DDP', modal: 'SEA_FCL', feeType: 'DESTINATION', feeName: 'CCT fee',
      chargeType: 'FIXED', value: 10.00, currency: 'USD', sortOrder: 1,
      description: 'Taxa de controle de carga terminal (pode ser isenta em DDP conforme contrato)'
    },
  ];
}

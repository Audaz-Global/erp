import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { prisma } from './prisma';
import { backfillIncotermRuleStandardFees } from './services/standardFeeLinkService';
import { normalizeIncotermRuleSortOrders } from './services/incotermRuleOrderService';
import { backfillQuotationHistory, backfillStatusRename } from './services/quotationHistoryService';
import { backfillPartnerLinks } from './services/partnerLinkService';
export { prisma };

const app = express();
const PORT = process.env.PORT || 3001;

// SOMENTE LOCAL (npm run dev / ts-node-dev): o Express 4 não captura erros de rotas
// async, então uma rota sem try/catch com o Postgres local offline derrubava o servidor
// inteiro ("Failed to fetch"). Aqui o erro vai para o handler de erros (JSON 500).
// Em produção (npm start → node dist/index.js) TS_NODE_DEV não existe e nada muda.
if (process.env.TS_NODE_DEV === 'true') {
  const Layer = require('express/lib/router/layer');
  Layer.prototype.handle_request = function (this: any, req: any, res: any, next: any) {
    if (this.handle.length > 3) return next();
    try {
      const result = this.handle(req, res, next);
      if (result && typeof result.catch === 'function') result.catch(next);
    } catch (err) {
      next(err);
    }
  };
  process.on('unhandledRejection', reason => console.error('[dev] Erro assíncrono não tratado (servidor mantido no ar):', reason));
}

// Middlewares
app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));
// E-mails extraídos podem ultrapassar o limite padrão de 100 KB do Express
// quando são reenviados junto com a cotação para gerar o rascunho.
app.use(express.json({ limit: '5mb' }));

// Servir o painel de testes
app.use(express.static(path.join(__dirname, '..', 'public')));

// Routes
import authRoutes from './routes/auth';
import extractRoutes from './routes/extract';
import quotationRoutes from './routes/quotation';
import agentRoutes from './routes/agent';
import fixedFeeRoutes from './routes/fixedFee';
import standardFeeRoutes from './routes/standardFee';
import incotermRuleRoutes from './routes/incotermRule';
import incotermTreeRoutes from './routes/incotermTree';
import outlookRoutes from './routes/outlookRoutes';
import carrierProfileRoutes from './routes/carrierProfile';
import carrierRateRoutes from './routes/carrierRate';
import airlineProfileRoutes from './routes/airlineProfile';

import knowledgeRoutes from './routes/knowledge';
import smartcomexRoutes from './routes/smartcomex';
import agentDraftEmailSettingsRoutes from './routes/agentDraftEmailSettings';
import agentDraftEmailTemplateRoutes from './routes/agentDraftEmailTemplate';
import draftEmailFieldRuleRoutes from './routes/draftEmailFieldRule';
import pricingSettingsRoutes from './routes/pricingSettings';
import deconsolidatorRoutes from './routes/deconsolidator';
import professionalRoutes from './routes/professional';
import groundServiceRoutes from './routes/groundService';
import atlantisRoutes from './routes/atlantis';
import clientRoutes from './routes/client';
import ticketRoutes from './routes/ticket';
import { backfillLegacyRoadLegs } from './services/groundServiceService';

app.use('/api/auth', authRoutes);
app.use('/api/extract', extractRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/fixed-fees', fixedFeeRoutes);
app.use('/api/standard-fees', standardFeeRoutes);
app.use('/api/incoterm-rules', incotermRuleRoutes);
app.use('/api/incoterm-tree', incotermTreeRoutes);
app.use('/api/outlook', outlookRoutes);
app.use('/api/carrier-profiles', carrierProfileRoutes);
app.use('/api/carrier-rates', carrierRateRoutes);
app.use('/api/airline-profiles', airlineProfileRoutes);
app.use('/api/agent-draft-email-settings', agentDraftEmailSettingsRoutes);
app.use('/api/agent-draft-email-templates', agentDraftEmailTemplateRoutes);
app.use('/api/draft-email-field-rules', draftEmailFieldRuleRoutes);
app.use('/api/pricing-settings', pricingSettingsRoutes);
app.use('/api/deconsolidators', deconsolidatorRoutes);
app.use('/api/professionals', professionalRoutes);
app.use('/api/ground-services', groundServiceRoutes);
app.use('/api/atlantis', atlantisRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/tickets', ticketRoutes);

app.post('/api/log-error', (req, res) => {
  console.error('\n[FRONTEND ERROR]', req.body);
  res.sendStatus(200);
});

app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/smartcomex', smartcomexRoutes);

// Basic Route
app.get('/', (req, res) => {
  res.json({ message: '🚀 Audaz Global - Automação de Cotações API' });
});

// Evita que erros do parser (por exemplo, payload acima do limite) retornem
// a página HTML padrão do Express para clientes que esperam JSON.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = Number(err?.status || err?.statusCode) || 500;

  if (status === 413 || err?.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'O conteúdo do e-mail excede o limite de 5 MB. Remova anexos muito grandes ou reduza o texto antes de tentar novamente.'
    });
  }

  if (status === 400 && err instanceof SyntaxError) {
    return res.status(400).json({ error: 'A requisição enviada possui JSON inválido.' });
  }

  console.error('Erro não tratado na API:', err);
  return res.status(status).json({ error: err?.message || 'Erro interno do servidor.' });
});

// Start Server
// Start Server
async function startServer() {
  // READ_ONLY_STARTUP=1 pula backfills/limpezas e o worker do Outlook — útil para rodar
  // localmente apontando para um banco compartilhado sem alterar nenhum dado dele.
  const readOnlyStartup = process.env.READ_ONLY_STARTUP === '1';
  if (readOnlyStartup) console.log('⚠️ READ_ONLY_STARTUP ativo: backfills e worker do Outlook desativados.');
  if (!readOnlyStartup) try {
    const migratedRoadLegs = await backfillLegacyRoadLegs();
    if (migratedRoadLegs > 0) console.log(`✅ ${migratedRoadLegs} transporte(s) legado(s) migrado(s) para Rodoviário Nacional.`);
    const linkedRules = await backfillIncotermRuleStandardFees(prisma);
    if (linkedRules > 0) console.log(`✅ ${linkedRules} regra(s) de Incoterm vinculada(s) às taxas locais.`);

    const deletedRules = await prisma.incotermRule.deleteMany({
      where: {
        feeName: { in: ['Origin Charges (Coleta, Doc, Handling, Despacho)', 'Origin Charges'] }
      }
    });
    if (deletedRules.count > 0) console.log(`✅ ${deletedRules.count} regra(s) legada(s) de Origin Charges removida(s) do banco de dados.`);

    const normalizedOrders = await normalizeIncotermRuleSortOrders(prisma);
    if (normalizedOrders > 0) console.log(`✅ ${normalizedOrders} ordem(ns) de regras de Incoterm corrigida(s).`);

    const renamedStatuses = await backfillStatusRename(prisma);
    if (renamedStatuses > 0) console.log(`✅ ${renamedStatuses} cotação(ões) migrada(s) para os novos nomes de status.`);

    const historyRecords = await backfillQuotationHistory(prisma);
    if (historyRecords > 0) console.log(`✅ ${historyRecords} registro(s) histórico(s) reconstruído(s).`);

    const partnerLinks = await backfillPartnerLinks(prisma);
    if (partnerLinks > 0) console.log(`✅ ${partnerLinks} cadastro(s), taxa(s) ou perfil(is) vinculados à Central de Parceiros.`);
  } catch (e: any) {
    console.warn('⚠️ Conexão inicial com o banco PostgreSQL pendente/offline, iniciando o servidor web em modo de tolerância a falhas:', e?.message || e);
  }

  app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);

    // Iniciar worker de leitura do Outlook
    if (!readOnlyStartup) import('./services/outlookCron').then(cron => {
      cron.startOutlookWatcher();
    }).catch(e => console.error('Erro ao carregar Cron do Outlook', e));
  });
}

startServer().catch(error => {
  console.error('Erro ao preparar dados essenciais antes da inicialização:', error);
});

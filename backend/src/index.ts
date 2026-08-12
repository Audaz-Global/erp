import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { prisma } from './prisma';
import { backfillIncotermRuleStandardFees } from './services/standardFeeLinkService';
import { normalizeIncotermRuleSortOrders } from './services/incotermRuleOrderService';
import { backfillQuotationHistory } from './services/quotationHistoryService';
export { prisma };

const app = express();
const PORT = process.env.PORT || 3001;

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
import outlookRoutes from './routes/outlookRoutes';
import incotermFieldRuleRoutes from './routes/incotermFieldRule';
import carrierProfileRoutes from './routes/carrierProfile';
import carrierRateRoutes from './routes/carrierRate';

import knowledgeRoutes from './routes/knowledge';
import smartcomexRoutes from './routes/smartcomex';
import agentDraftEmailSettingsRoutes from './routes/agentDraftEmailSettings';
import agentDraftEmailTemplateRoutes from './routes/agentDraftEmailTemplate';
import draftEmailFieldRuleRoutes from './routes/draftEmailFieldRule';
import pricingSettingsRoutes from './routes/pricingSettings';
import deconsolidatorRoutes from './routes/deconsolidator';

app.use('/api/auth', authRoutes);
app.use('/api/extract', extractRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/fixed-fees', fixedFeeRoutes);
app.use('/api/standard-fees', standardFeeRoutes);
app.use('/api/incoterm-rules', incotermRuleRoutes);
app.use('/api/outlook', outlookRoutes);
app.use('/api/incoterm-field-rules', incotermFieldRuleRoutes);
app.use('/api/carrier-profiles', carrierProfileRoutes);
app.use('/api/carrier-rates', carrierRateRoutes);
app.use('/api/agent-draft-email-settings', agentDraftEmailSettingsRoutes);
app.use('/api/agent-draft-email-templates', agentDraftEmailTemplateRoutes);
app.use('/api/draft-email-field-rules', draftEmailFieldRuleRoutes);
app.use('/api/pricing-settings', pricingSettingsRoutes);
app.use('/api/deconsolidators', deconsolidatorRoutes);

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
async function startServer() {
  const linkedRules = await backfillIncotermRuleStandardFees(prisma);
  if (linkedRules > 0) console.log(`✅ ${linkedRules} regra(s) de Incoterm vinculada(s) às taxas locais.`);

  const normalizedOrders = await normalizeIncotermRuleSortOrders(prisma);
  if (normalizedOrders > 0) console.log(`✅ ${normalizedOrders} ordem(ns) de regras de Incoterm corrigida(s).`);

  const historyRecords = await backfillQuotationHistory(prisma);
  if (historyRecords > 0) console.log(`✅ ${historyRecords} registro(s) histórico(s) reconstruído(s).`);

  app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);

    // Iniciar worker de leitura do Outlook
    import('./services/outlookCron').then(cron => {
      cron.startOutlookWatcher();
    }).catch(e => console.error('Erro ao carregar Cron do Outlook', e));
  });
}

startServer().catch(error => {
  console.error('Erro ao preparar dados essenciais antes da inicialização:', error);
  process.exit(1);
});

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { prisma } from './prisma';
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

import knowledgeRoutes from './routes/knowledge';
import smartcomexRoutes from './routes/smartcomex';

app.use('/api/auth', authRoutes);
app.use('/api/extract', extractRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/fixed-fees', fixedFeeRoutes);
app.use('/api/standard-fees', standardFeeRoutes);
app.use('/api/incoterm-rules', incotermRuleRoutes);
app.use('/api/outlook', outlookRoutes);

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
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  
  // Iniciar worker de leitura do Outlook
  import('./services/outlookCron').then(cron => {
    cron.startOutlookWatcher();
  }).catch(e => console.error('Erro ao carregar Cron do Outlook', e));
});

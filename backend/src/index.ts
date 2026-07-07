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
app.use(express.json());

// Servir o painel de testes
app.use(express.static(path.join(__dirname, '..', 'public')));

// Routes
import authRoutes from './routes/auth';
import extractRoutes from './routes/extract';
import quotationRoutes from './routes/quotation';
import agentRoutes from './routes/agent';
import fixedFeeRoutes from './routes/fixedFee';
import standardFeeRoutes from './routes/standardFee';
import outlookRoutes from './routes/outlookRoutes';

import knowledgeRoutes from './routes/knowledge';
import smartcomexRoutes from './routes/smartcomex';

app.use('/api/auth', authRoutes);
app.use('/api/extract', extractRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/fixed-fees', fixedFeeRoutes);
app.use('/api/standard-fees', standardFeeRoutes);
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

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  
  // Iniciar worker de leitura do Outlook
  import('./services/outlookCron').then(cron => {
    cron.startOutlookWatcher();
  }).catch(e => console.error('Erro ao carregar Cron do Outlook', e));
});

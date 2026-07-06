import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRoutes } from './routes/authRoutes.js';
import { adminRoutes } from './routes/adminRoutes.js';
import { shopRoutes } from './routes/shopRoutes.js';
import { publicRoutes } from './routes/publicRoutes.js';
import { serviceRoutes } from './routes/serviceRoutes.js';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', async (_req, res) => {
  await pool.query('select 1');
  res.json({ status: 'ok', service: 'smart-oil-change-backend' });
});

app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/shop', shopRoutes);
app.use('/service', serviceRoutes);
app.use('/public', publicRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use(errorHandler);

const server = app.listen(env.port, () => {
  console.log(`API listening on port ${env.port}`);
});

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

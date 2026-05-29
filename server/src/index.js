require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const authRoutes = require('./routes/auth');
const messageRoutes = require('./routes/messages');

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Inject prisma so controllers don't each new their own client.
app.use((req, _res, next) => {
  req.prisma = prisma;
  next();
});

// Health check (handy for Railway).
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// API routes.
app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);

// Serve the built client (single-service deploy on Railway).
const clientDist = path.join(__dirname, '..', 'public');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`dashboardJH server listening on :${PORT}`);
});

// Idempotent owner seed. Runs on every boot (cheap when the row already exists).
// Reads OWNER_EMAIL + OWNER_PASSWORD from env so secrets stay out of git.
require('dotenv').config();
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();
  try {
    const email = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
    const password = process.env.OWNER_PASSWORD || '';

    if (!email || !password) {
      console.warn('[seedOwner] OWNER_EMAIL or OWNER_PASSWORD not set — skipping seed');
      return;
    }
    if (password.length < 6) {
      console.warn('[seedOwner] OWNER_PASSWORD too short — refusing to seed');
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log(`[seedOwner] Owner ${email} already exists (id=${existing.id}). Skipping.`);
      return;
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hashed, name: 'Owner' }
    });
    console.log(`[seedOwner] Created owner ${user.email} (id=${user.id}).`);
  } catch (err) {
    console.error('[seedOwner] ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();

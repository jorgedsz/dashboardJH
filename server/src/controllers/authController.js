const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const generateToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });

// POST /api/auth/login — single-tenant. Email + password against the seeded owner.
const login = async (req, res) => {
  try {
    const { email: rawEmail, password } = req.body || {};
    if (!rawEmail || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const email = String(rawEmail).trim().toLowerCase();
    const user = await req.prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = generateToken(user.id);
    return res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name }
    });
  } catch (err) {
    console.error('login error:', err.message);
    return res.status(500).json({ error: 'Login failed' });
  }
};

// GET /api/auth/me — returns the logged-in user with the latest balance
// and the configurable no-balance message. authMiddleware only carries id
// / email / name on req.user; we re-read to pick up balance changes that
// happen between requests (e.g. a recharge webhook fired mid-session).
const getMe = async (req, res) => {
  const fresh = await req.prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      availableBalance: true,
      totalRecharged: true,
      noBalanceMessage: true
    }
  });
  res.json({ user: fresh || req.user });
};

// PUT /api/auth/settings — owner-only. Updates the no-balance message
// shown to callers when the gate blocks a forward. Anything else added
// in the future (display name, etc.) lands here too.
const updateSettings = async (req, res) => {
  try {
    const { noBalanceMessage } = req.body || {};
    const data = {};
    if (typeof noBalanceMessage === 'string') {
      const trimmed = noBalanceMessage.trim();
      if (trimmed.length > 1000) {
        return res.status(400).json({ error: 'noBalanceMessage too long (max 1000 chars)' });
      }
      data.noBalanceMessage = trimmed || 'Lo siento, tu cuenta no tiene saldo disponible para enviar mensajes.';
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    const updated = await req.prisma.user.update({
      where: { id: req.user.id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        availableBalance: true,
        totalRecharged: true,
        noBalanceMessage: true
      }
    });
    res.json({ user: updated });
  } catch (err) {
    console.error('updateSettings error:', err.message);
    res.status(500).json({ error: 'Failed to update settings' });
  }
};

// GET /api/auth/recharges — last N recharge log entries for the dashboard.
const listRecharges = async (req, res) => {
  try {
    const take = Math.min(100, parseInt(req.query.limit || '20', 10));
    const rows = await req.prisma.rechargeLog.findMany({
      orderBy: { createdAt: 'desc' },
      take
    });
    res.json({ rows });
  } catch (err) {
    console.error('listRecharges error:', err.message);
    res.status(500).json({ error: 'Failed to list recharges' });
  }
};

module.exports = { login, getMe, updateSettings, listRecharges };

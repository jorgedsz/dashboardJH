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

// GET /api/auth/me — returns the logged-in user (the owner).
const getMe = async (req, res) => {
  res.json({ user: req.user });
};

module.exports = { login, getMe };

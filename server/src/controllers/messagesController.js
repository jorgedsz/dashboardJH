// Cost is fixed at $0.01 per message by default; overridable via env so the
// rate can be changed in production without a redeploy.
const COST_PER_MESSAGE = parseFloat(process.env.COST_PER_MESSAGE || '0.01');

// POST /api/messages/ingest — called by n8n on every processed message.
// Authenticated by a shared secret in the x-ingest-secret header so n8n
// doesn't have to maintain a user session.
const ingest = async (req, res) => {
  try {
    const secret = req.headers['x-ingest-secret'];
    if (!secret || secret !== process.env.INGEST_SECRET) {
      return res.status(401).json({ error: 'Invalid ingest secret' });
    }

    const {
      sessionId,
      contactId,
      contactName,
      inputMessage,
      outputMessage,
      status,
      errorMessage
    } = req.body || {};

    if (!inputMessage || typeof inputMessage !== 'string') {
      return res.status(400).json({ error: 'inputMessage is required' });
    }

    const message = await req.prisma.message.create({
      data: {
        sessionId: sessionId || 'default',
        contactId: contactId || null,
        contactName: contactName || null,
        inputMessage,
        outputMessage: outputMessage || null,
        status: status || 'success',
        errorMessage: errorMessage || null,
        costCharged: COST_PER_MESSAGE
      }
    });

    return res.status(201).json({ id: message.id, costCharged: message.costCharged });
  } catch (err) {
    console.error('ingest error:', err.message);
    return res.status(500).json({ error: 'Ingest failed' });
  }
};

// GET /api/messages — paginated list, newest first. Supports search by
// contactId/contactName and date range. Owner only (authMiddleware applied
// in the route file).
const list = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize || '50', 10)));
    const skip = (page - 1) * pageSize;

    const where = {};
    if (req.query.contactId) where.contactId = String(req.query.contactId);
    if (req.query.sessionId) where.sessionId = String(req.query.sessionId);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.search) {
      const s = String(req.query.search);
      where.OR = [
        { contactName: { contains: s, mode: 'insensitive' } },
        { contactId: { contains: s, mode: 'insensitive' } },
        { inputMessage: { contains: s, mode: 'insensitive' } },
        { outputMessage: { contains: s, mode: 'insensitive' } }
      ];
    }
    if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) where.createdAt.gte = new Date(String(req.query.from));
      if (req.query.to) where.createdAt.lte = new Date(String(req.query.to));
    }

    const [rows, total] = await Promise.all([
      req.prisma.message.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize
      }),
      req.prisma.message.count({ where })
    ]);

    return res.json({ rows, total, page, pageSize });
  } catch (err) {
    console.error('list messages error:', err.message);
    return res.status(500).json({ error: 'Failed to list messages' });
  }
};

// GET /api/messages/stats — high-level numbers for the dashboard header
// and the daily-volume chart.
const stats = async (req, res) => {
  try {
    const where = {};
    if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) where.createdAt.gte = new Date(String(req.query.from));
      if (req.query.to) where.createdAt.lte = new Date(String(req.query.to));
    }

    const [agg, byDay, byStatus, distinctContacts] = await Promise.all([
      req.prisma.message.aggregate({
        where,
        _count: true,
        _sum: { costCharged: true }
      }),
      req.prisma.$queryRawUnsafe(buildDailyQuery(where)),
      req.prisma.message.groupBy({
        by: ['status'],
        where,
        _count: true
      }),
      req.prisma.message.findMany({
        where: { ...where, contactId: { not: null } },
        select: { contactId: true },
        distinct: ['contactId']
      })
    ]);

    return res.json({
      totalMessages: agg._count || 0,
      totalCost: Number(agg._sum.costCharged || 0),
      uniqueContacts: distinctContacts.length,
      byStatus: byStatus.reduce((acc, row) => {
        acc[row.status] = row._count;
        return acc;
      }, {}),
      byDay: byDay.map(r => ({
        date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
        count: Number(r.count),
        cost: Number(r.cost)
      }))
    });
  } catch (err) {
    console.error('stats error:', err.message);
    return res.status(500).json({ error: 'Failed to compute stats' });
  }
};

// Daily aggregation built as raw SQL so we can date_trunc in Postgres rather
// than pulling every row and grouping in JS. Range filter is inlined safely
// because the only values are Date instances we already constructed above.
function buildDailyQuery(where) {
  const conds = [];
  if (where.createdAt?.gte) {
    conds.push(`"createdAt" >= '${where.createdAt.gte.toISOString()}'`);
  }
  if (where.createdAt?.lte) {
    conds.push(`"createdAt" <= '${where.createdAt.lte.toISOString()}'`);
  }
  const whereClause = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return `
    SELECT
      date_trunc('day', "createdAt")::date AS date,
      COUNT(*)::int AS count,
      COALESCE(SUM("costCharged"), 0)::float AS cost
    FROM "Message"
    ${whereClause}
    GROUP BY 1
    ORDER BY 1 ASC
  `;
}

module.exports = { ingest, list, stats };

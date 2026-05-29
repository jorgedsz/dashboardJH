const DEFAULT_RATE_PER_MINUTE = 0.10;
const RAW_PAYLOAD_MAX = 32 * 1024; // 32 KB; transcripts can be long

const callRate = () => {
  const n = parseFloat(process.env.CALL_RATE_PER_MINUTE || `${DEFAULT_RATE_PER_MINUTE}`);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_RATE_PER_MINUTE;
};

// POST /api/calls/ingest — sword-ai's webhook controller calls this when
// a VAPI call ends. Authenticated by x-ingest-secret. Cost is computed
// from durationSeconds * (rate/60). If vapiCallId is provided we treat
// it as the idempotency key: a second call with the same id updates the
// existing row instead of duplicating + double-charging.
async function ingest(req, res) {
  try {
    const secret = req.headers['x-ingest-secret'];
    if (!secret || secret !== process.env.INGEST_SECRET) {
      return res.status(401).json({ error: 'Invalid ingest secret' });
    }

    const body = req.body || {};
    const {
      vapiCallId,
      agentId,
      agentName,
      contactId,
      contactName,
      customerNumber,
      fromNumber,
      durationSeconds,
      outcome,
      endedReason,
      summary,
      transcript,
      recordingUrl
    } = body;

    const duration = Math.max(0, parseInt(durationSeconds, 10) || 0);
    const rate = callRate();
    const computedCost = +(duration / 60 * rate).toFixed(6);

    const owner = await req.prisma.user.findFirst({ orderBy: { id: 'asc' } });
    if (!owner) return res.status(500).json({ error: 'No owner configured' });

    // Idempotency by vapiCallId — if the upstream retries we don't
    // re-debit. Update non-cost fields though, transcripts often arrive
    // later than the duration/cost.
    if (vapiCallId) {
      const existing = await req.prisma.call.findUnique({ where: { vapiCallId: String(vapiCallId) } });
      if (existing) {
        const updated = await req.prisma.call.update({
          where: { id: existing.id },
          data: {
            agentId: agentId || existing.agentId,
            agentName: agentName || existing.agentName,
            contactId: contactId || existing.contactId,
            contactName: contactName || existing.contactName,
            customerNumber: customerNumber || existing.customerNumber,
            fromNumber: fromNumber || existing.fromNumber,
            durationSeconds: duration || existing.durationSeconds,
            outcome: outcome || existing.outcome,
            endedReason: endedReason || existing.endedReason,
            summary: summary || existing.summary,
            transcript: transcript || existing.transcript,
            recordingUrl: recordingUrl || existing.recordingUrl,
            rawPayload: safeStringify(body) || existing.rawPayload
          }
        });
        return res.status(200).json({ id: updated.id, deduped: true, cost: updated.costCharged });
      }
    }

    // First record. Debit even if availableBalance goes negative — the
    // call already happened upstream; charging is a record-keeping move,
    // not a permission check. The owner can recharge to come back to 0.
    const [call] = await req.prisma.$transaction([
      req.prisma.call.create({
        data: {
          vapiCallId: vapiCallId ? String(vapiCallId) : null,
          agentId: agentId ? String(agentId) : null,
          agentName: agentName ? String(agentName) : null,
          contactId: contactId ? String(contactId) : null,
          contactName: contactName ? String(contactName) : null,
          customerNumber: customerNumber ? String(customerNumber) : null,
          fromNumber: fromNumber ? String(fromNumber) : null,
          durationSeconds: duration,
          costCharged: computedCost,
          ratePerMinute: rate,
          outcome: outcome ? String(outcome) : 'unknown',
          endedReason: endedReason ? String(endedReason) : null,
          summary: summary ? String(summary) : null,
          transcript: transcript ? String(transcript) : null,
          recordingUrl: recordingUrl ? String(recordingUrl) : null,
          rawPayload: safeStringify(body)
        }
      }),
      req.prisma.user.update({
        where: { id: owner.id },
        data: { availableBalance: { decrement: computedCost } }
      })
    ]);

    return res.status(201).json({
      id: call.id,
      costCharged: call.costCharged,
      ratePerMinute: call.ratePerMinute
    });
  } catch (err) {
    console.error('[calls.ingest] error:', err.message);
    return res.status(500).json({ error: 'Ingest failed' });
  }
}

// GET /api/calls/check-balance?estimatedMinutes=5
// Pre-call gate. sword-ai hits this BEFORE starting an outbound call so
// it can skip dialing when the owner can't afford it. Authenticated by
// x-ingest-secret. Returns the dashboard's view of the balance vs the
// estimated cost.
async function checkBalance(req, res) {
  try {
    const secret = req.headers['x-ingest-secret'];
    if (!secret || secret !== process.env.INGEST_SECRET) {
      return res.status(401).json({ error: 'Invalid ingest secret' });
    }

    const estimatedMinutes = Math.max(0, parseFloat(req.query.estimatedMinutes || '0'));
    const rate = callRate();
    const estimatedCost = +(estimatedMinutes * rate).toFixed(6);

    const owner = await req.prisma.user.findFirst({ orderBy: { id: 'asc' } });
    if (!owner) return res.status(500).json({ error: 'No owner configured' });

    const available = owner.availableBalance;
    // hasBalance: true when there's enough for the estimated cost. If no
    // estimate was provided, fall back to "is the balance positive at all".
    const hasBalance = estimatedMinutes > 0
      ? available >= estimatedCost
      : available > 0;

    return res.json({
      hasBalance,
      availableBalance: available,
      ratePerMinute: rate,
      estimatedMinutes,
      estimatedCost,
      noBalanceMessage: owner.noBalanceMessage
    });
  } catch (err) {
    console.error('[calls.checkBalance] error:', err.message);
    return res.status(500).json({ error: 'Check failed' });
  }
}

// GET /api/calls — owner-only paginated list with the same search / date
// filters as the messages endpoint.
async function list(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize || '50', 10)));
    const skip = (page - 1) * pageSize;

    const where = {};
    if (req.query.contactId) where.contactId = String(req.query.contactId);
    if (req.query.outcome) where.outcome = String(req.query.outcome);
    if (req.query.search) {
      const s = String(req.query.search);
      where.OR = [
        { contactName: { contains: s, mode: 'insensitive' } },
        { contactId: { contains: s, mode: 'insensitive' } },
        { customerNumber: { contains: s, mode: 'insensitive' } },
        { agentName: { contains: s, mode: 'insensitive' } },
        { summary: { contains: s, mode: 'insensitive' } }
      ];
    }
    if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) where.createdAt.gte = new Date(String(req.query.from));
      if (req.query.to) where.createdAt.lte = new Date(String(req.query.to));
    }

    const [rows, total] = await Promise.all([
      req.prisma.call.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize
      }),
      req.prisma.call.count({ where })
    ]);
    return res.json({ rows, total, page, pageSize });
  } catch (err) {
    console.error('[calls.list] error:', err.message);
    return res.status(500).json({ error: 'Failed to list calls' });
  }
}

// GET /api/calls/stats — owner-only aggregates.
async function stats(req, res) {
  try {
    const where = {};
    if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) where.createdAt.gte = new Date(String(req.query.from));
      if (req.query.to) where.createdAt.lte = new Date(String(req.query.to));
    }

    const [agg, byOutcome, distinctContacts] = await Promise.all([
      req.prisma.call.aggregate({
        where,
        _count: true,
        _sum: { costCharged: true, durationSeconds: true }
      }),
      req.prisma.call.groupBy({
        by: ['outcome'],
        where,
        _count: true
      }),
      req.prisma.call.findMany({
        where: { ...where, contactId: { not: null } },
        select: { contactId: true },
        distinct: ['contactId']
      })
    ]);

    return res.json({
      totalCalls: agg._count || 0,
      totalCost: Number(agg._sum.costCharged || 0),
      totalDurationSeconds: Number(agg._sum.durationSeconds || 0),
      ratePerMinute: callRate(),
      uniqueContacts: distinctContacts.length,
      byOutcome: byOutcome.reduce((acc, row) => {
        acc[row.outcome] = row._count;
        return acc;
      }, {})
    });
  } catch (err) {
    console.error('[calls.stats] error:', err.message);
    return res.status(500).json({ error: 'Failed to compute stats' });
  }
}

function safeStringify(obj) {
  try {
    const s = JSON.stringify(obj);
    if (!s) return null;
    return s.length > RAW_PAYLOAD_MAX ? `${s.slice(0, RAW_PAYLOAD_MAX)}…` : s;
  } catch {
    return null;
  }
}

module.exports = { ingest, checkBalance, list, stats };

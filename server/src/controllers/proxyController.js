const COST_PER_MESSAGE = parseFloat(process.env.COST_PER_MESSAGE || '0.01');
const RAW_PAYLOAD_MAX = 16 * 1024; // 16 KB cap to keep rows bounded

// POST /api/proxy/:token
// Authenticated by the URL token matching env PROXY_TOKEN. Receives the
// exact body that the upstream caller (typically a GHL workflow) would
// have sent to n8n. Acts as a balance gate:
//
//   - balance < COST_PER_MESSAGE → record as `blocked`, do NOT forward,
//     respond 200 with { blocked: true, fallback_message: ... } so the
//     caller can branch and send the message to the contact.
//   - balance >= COST_PER_MESSAGE → debit, record as `success`, forward
//     the exact same body to PROXY_TARGET_URL, return whatever the
//     upstream replied with (status + body).
//
// We try to extract sessionId / contactId / contactName / inputMessage
// from common field names so the dashboard view stays populated. The full
// payload is also stored in rawPayload for replay.
async function proxyHandler(req, res) {
  try {
    const expected = process.env.PROXY_TOKEN;
    if (!expected) {
      console.error('[proxy] PROXY_TOKEN env not set — refusing to accept traffic');
      return res.status(503).json({ error: 'Proxy not configured' });
    }
    if (req.params.token !== expected) {
      return res.status(404).json({ error: 'Not found' });
    }

    const targetUrl = process.env.PROXY_TARGET_URL;
    if (!targetUrl) {
      console.error('[proxy] PROXY_TARGET_URL env not set');
      return res.status(503).json({ error: 'Proxy target not configured' });
    }

    const body = req.body || {};
    const extracted = extractFields(body);
    const rawPayloadStr = safeStringify(body);

    // Single-tenant: owner is always the lowest-id user.
    const owner = await req.prisma.user.findFirst({ orderBy: { id: 'asc' } });
    if (!owner) {
      console.error('[proxy] no owner user found — was seedOwner skipped?');
      return res.status(500).json({ error: 'No owner configured' });
    }

    // Balance gate.
    if (owner.availableBalance < COST_PER_MESSAGE) {
      await req.prisma.message.create({
        data: {
          sessionId: extracted.sessionId || 'default',
          contactId: extracted.contactId || null,
          contactName: extracted.contactName || null,
          inputMessage: extracted.inputMessage || '',
          status: 'blocked',
          costCharged: 0,
          rawPayload: rawPayloadStr
        }
      });
      return res.status(200).json({
        blocked: true,
        reason: 'no_balance',
        fallback_message: owner.noBalanceMessage,
        available_balance: owner.availableBalance
      });
    }

    // Debit + record optimistically. We do this BEFORE the upstream call
    // so two simultaneous webhooks can't both pass the balance check
    // (Prisma update is atomic). If the upstream fails afterwards we mark
    // the row as `error` but keep the debit — the gate already let the
    // message through and refunding would let abusers retry for free.
    const message = await req.prisma.message.create({
      data: {
        sessionId: extracted.sessionId || 'default',
        contactId: extracted.contactId || null,
        contactName: extracted.contactName || null,
        inputMessage: extracted.inputMessage || '',
        status: 'success',
        costCharged: COST_PER_MESSAGE,
        rawPayload: rawPayloadStr
      }
    });
    await req.prisma.user.update({
      where: { id: owner.id },
      data: { availableBalance: { decrement: COST_PER_MESSAGE } }
    });

    // Forward to the upstream n8n webhook with the exact body received.
    let upstreamStatus = 0;
    let upstreamBody = null;
    let upstreamContentType = 'application/json';
    try {
      const upstreamRes = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      upstreamStatus = upstreamRes.status;
      upstreamContentType = upstreamRes.headers.get('content-type') || 'application/json';
      upstreamBody = await upstreamRes.text();
      if (!upstreamRes.ok) {
        await req.prisma.message.update({
          where: { id: message.id },
          data: { status: 'error', errorMessage: `Upstream ${upstreamStatus}: ${upstreamBody?.slice(0, 500)}` }
        });
      }
    } catch (err) {
      console.error('[proxy] upstream call failed:', err.message);
      await req.prisma.message.update({
        where: { id: message.id },
        data: { status: 'error', errorMessage: `Upstream fetch failed: ${err.message}` }
      });
      return res.status(502).json({ error: 'Upstream call failed', detail: err.message });
    }

    // Mirror the upstream response verbatim so the caller (GHL workflow)
    // sees what it would have seen calling n8n directly.
    res.status(upstreamStatus);
    res.setHeader('Content-Type', upstreamContentType);
    return res.send(upstreamBody || '');
  } catch (err) {
    console.error('[proxy] unhandled error:', err.message);
    return res.status(500).json({ error: 'Proxy failure', detail: err.message });
  }
}

// POST /api/proxy/recharge
// Shared-secret webhook so a payment provider (Whop, Stripe, manual cURL)
// can credit balance without holding a session.
// Body: { amount: number, source?: string, reference?: string }
// Reference is treated as an idempotency key: same reference twice → no-op
// on the second call.
async function rechargeWebhook(req, res) {
  try {
    const secret = req.headers['x-recharge-secret'];
    if (!secret || secret !== process.env.RECHARGE_SECRET) {
      return res.status(401).json({ error: 'Invalid recharge secret' });
    }

    const { amount, source, reference } = req.body || {};
    const amountNum = parseFloat(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    if (reference) {
      const existing = await req.prisma.rechargeLog.findFirst({ where: { reference: String(reference) } });
      if (existing) {
        return res.status(200).json({
          ok: true,
          deduped: true,
          rechargeLogId: existing.id
        });
      }
    }

    const owner = await req.prisma.user.findFirst({ orderBy: { id: 'asc' } });
    if (!owner) {
      return res.status(500).json({ error: 'No owner configured' });
    }

    const [updated, log] = await req.prisma.$transaction([
      req.prisma.user.update({
        where: { id: owner.id },
        data: {
          availableBalance: { increment: amountNum },
          totalRecharged: { increment: amountNum }
        }
      }),
      req.prisma.rechargeLog.create({
        data: {
          amount: amountNum,
          source: source ? String(source) : null,
          reference: reference ? String(reference) : null
        }
      })
    ]);

    return res.status(200).json({
      ok: true,
      rechargeLogId: log.id,
      availableBalance: updated.availableBalance,
      totalRecharged: updated.totalRecharged
    });
  } catch (err) {
    console.error('[recharge] error:', err.message);
    return res.status(500).json({ error: 'Recharge failed' });
  }
}

function extractFields(body) {
  if (!body || typeof body !== 'object') return {};

  // GHL workflows send two layers:
  //   - top-level: the trigger payload (contact_id, full_name, message {…}, …)
  //   - customData: the key/value pairs the user wired in the webhook step
  // Prefer customData.* because the user controls those names; fall back to
  // common top-level names otherwise.
  const cd = body.customData || {};

  // Some senders (GHL) ship `message` as an object { type, body }. Coerce
  // it to a plain string before Prisma sees it.
  const coerceText = (v) => {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'object') {
      // common shapes: { body: "..." }, { text: "..." }, { message: "..." }
      const candidate = v.body || v.text || v.message || v.content;
      if (typeof candidate === 'string') return candidate;
      try { return JSON.stringify(v); } catch { return ''; }
    }
    return String(v);
  };

  const sessionId =
    cd.sessionId ||
    cd.session_id ||
    body.sessionId ||
    body.session_id ||
    body.contact?.id ||
    cd.contact_id ||
    body.contactId ||
    body.contact_id ||
    null;

  const contactId =
    cd.contactId ||
    cd.contact_id ||
    body.contactId ||
    body.contact_id ||
    body.contact?.id ||
    null;

  const contactName =
    cd.contactName ||
    cd.contact_name ||
    body.contactName ||
    body.contact_name ||
    body.contact?.name ||
    body.full_name ||
    [body.first_name, body.last_name].filter(Boolean).join(' ').trim() ||
    body.name ||
    null;

  const inputMessage = coerceText(
    cd.message ||
    cd.text ||
    cd.body ||
    body.message ||           // could be string or { body: ... }
    body.text ||
    body.input ||
    body.message_body ||
    ''
  );

  return {
    sessionId: sessionId ? String(sessionId) : null,
    contactId: contactId ? String(contactId) : null,
    contactName: contactName ? String(contactName) : null,
    inputMessage
  };
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

module.exports = { proxyHandler, rechargeWebhook };

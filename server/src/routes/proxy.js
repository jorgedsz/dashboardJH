const express = require('express');
const router = express.Router();
const proxyController = require('../controllers/proxyController');

// Both endpoints are public (authenticated by their own shared secrets).
// They MUST NOT be guarded by the owner JWT middleware — the callers
// (GHL workflow, payment provider) never have a user session.

// IMPORTANT ordering: /recharge must be declared BEFORE /:token, otherwise
// "recharge" will be captured as the token param and never hit the
// recharge handler.
router.post('/recharge', proxyController.rechargeWebhook);
router.post('/:token', proxyController.proxyHandler);

module.exports = router;

const express = require('express');
const router = express.Router();
const callsController = require('../controllers/callsController');
const authMiddleware = require('../middleware/authMiddleware');

// Public for sword-ai; authenticated by x-ingest-secret instead of JWT.
// /check-balance must be declared before any other public route that
// might shadow it via a path param.
router.get('/check-balance', callsController.checkBalance);
router.post('/ingest', callsController.ingest);

// Owner-only read endpoints.
router.use(authMiddleware);
router.get('/', callsController.list);
router.get('/stats', callsController.stats);

module.exports = router;

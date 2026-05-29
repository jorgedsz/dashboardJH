const express = require('express');
const router = express.Router();
const messagesController = require('../controllers/messagesController');
const authMiddleware = require('../middleware/authMiddleware');

// Public for n8n; authenticated via x-ingest-secret header instead of JWT.
router.post('/ingest', messagesController.ingest);

// All read endpoints require the owner JWT.
router.use(authMiddleware);
router.get('/', messagesController.list);
router.get('/stats', messagesController.stats);

module.exports = router;

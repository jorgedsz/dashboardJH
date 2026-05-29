const express = require('express');
const router = express.Router();
const messagesController = require('../controllers/messagesController');
const authMiddleware = require('../middleware/authMiddleware');

// Public for n8n; authenticated via x-ingest-secret header instead of JWT.
router.post('/ingest', messagesController.ingest);
// Also public-with-secret: lets the n8n workflow attach the bot reply
// to a row the proxy already created.
router.post('/:id/response', messagesController.setResponse);

// All read endpoints require the owner JWT.
router.use(authMiddleware);
router.get('/', messagesController.list);
router.get('/stats', messagesController.stats);

module.exports = router;

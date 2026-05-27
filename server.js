require('dotenv').config();
const express = require('express');
const { handleMessage, handlePostback } = require('./bot/hamza');

const app = express();
app.use(express.json());

// ─── Facebook Webhook Verification ────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('✅ Webhook verified by Facebook');
    res.status(200).send(challenge);
  } else {
    console.warn('❌ Webhook verification failed — check your VERIFY_TOKEN');
    res.sendStatus(403);
  }
});

// ─── Handle Incoming Messenger Events ─────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  // Always respond 200 immediately so Facebook doesn't retry
  res.sendStatus(200);

  const body = req.body;
  if (body.object !== 'page') return;

  for (const entry of body.entry) {
    const events = entry.messaging || [];
    for (const event of events) {
      try {
        if (event.message && !event.message.is_echo) {
          await handleMessage(event.sender.id, event.message);
        } else if (event.postback) {
          await handlePostback(event.sender.id, event.postback);
        }
      } catch (err) {
        console.error('❌ Error processing event:', err.message);
      }
    }
  }
});

// ─── Health Check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'online', bot: 'Hamza 🎧', business: 'Audoune' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎧 Hamza is online on port ${PORT}`);
  console.log(`📡 Webhook URL: http://localhost:${PORT}/webhook`);
});

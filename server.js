require('dotenv').config();
const express = require('express');
const { handleMessage, handlePostback, handleEchoMessage } = require('./bot/hamza');
const { getMessengerStatus } = require('./bot/messenger');

const app = express();
app.use(express.json());

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err.message || err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message || err);
});

const processedEvents = new Map();
const EVENT_TTL_MS = 10 * 60 * 1000;

function checkRequiredEnv() {
  const required = ['PAGE_ACCESS_TOKEN', 'VERIFY_TOKEN', 'GOOGLE_API_KEY'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
  }
  if (!process.env.PAGE_ACCESS_TOKEN?.startsWith('EAA')) {
    console.warn('PAGE_ACCESS_TOKEN does not look like a Facebook Page token.');
  }
}

function getEventId(event) {
  if (event.message?.mid) return `message:${event.message.mid}`;
  if (event.postback?.mid) return `postback:${event.postback.mid}`;
  if (event.postback?.payload) {
    return `postback:${event.sender?.id}:${event.timestamp}:${event.postback.payload}`;
  }
  return `${event.sender?.id || 'unknown'}:${event.timestamp || Date.now()}`;
}

function alreadyProcessed(event) {
  const now = Date.now();
  for (const [id, timestamp] of processedEvents) {
    if (now - timestamp > EVENT_TTL_MS) processedEvents.delete(id);
  }

  const eventId = getEventId(event);
  if (processedEvents.has(eventId)) {
    console.log('Duplicate Messenger event ignored:', eventId);
    return true;
  }

  processedEvents.set(eventId, now);
  return false;
}

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
        if (alreadyProcessed(event)) continue;

        if (event.message?.is_echo) {
          await handleEchoMessage(event.recipient?.id, event.message);
        } else if (event.message) {
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

// ─── Privacy Policy ────────────────────────────────────────────────────────────
app.get('/privacy', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy — Audoune</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; color: #333; line-height: 1.7; }
    h1 { color: #1877F2; } h2 { color: #444; margin-top: 30px; }
    p { margin: 10px 0; }
  </style>
</head>
<body>
  <h1>Privacy Policy — Audoune Messenger Bot</h1>
  <p><strong>Last updated:</strong> ${new Date().toDateString()}</p>

  <h2>1. Information We Collect</h2>
  <p>When you interact with our Messenger chatbot (Hamza), we collect your Facebook Messenger ID and the messages you send us. This information is used solely to respond to your inquiries about our hearing aid products.</p>

  <h2>2. How We Use Your Information</h2>
  <p>We use the information collected to: respond to your questions, process orders you initiate, improve our customer service, and notify our team of new inquiries.</p>

  <h2>3. Data Storage</h2>
  <p>Conversation history is stored temporarily in memory to maintain context during a conversation. We do not permanently store your personal messages on external databases.</p>

  <h2>4. Sharing of Information</h2>
  <p>We do not sell, trade, or share your personal information with third parties. Your data is only used internally by the Audoune team to serve you better.</p>

  <h2>5. Facebook Data</h2>
  <p>This app uses the Facebook Messenger Platform. By messaging us, you agree to Facebook's Data Policy. We only request the minimum permissions necessary (pages_messaging) to operate the chatbot.</p>

  <h2>6. Contact Us</h2>
  <p>If you have questions about this privacy policy, please contact us through our Facebook Page: <strong>Audoune</strong>.</p>

  <p><em>This privacy policy applies to the Audoune Facebook Messenger chatbot only.</em></p>
</body>
</html>`);
});


app.get('/', (req, res) => {
  res.json({ status: 'online', bot: 'Hamza 🎧', business: 'Audoune' });
});

// ─── Diagnostic (masked) ───────────────────────────────────────────────────────
app.get('/diag', async (req, res) => {
  const mask = (v) => v ? v.substring(0, 6) + '...' : 'MISSING ❌';
  const status = {
    PAGE_ACCESS_TOKEN: mask(process.env.PAGE_ACCESS_TOKEN),
    GOOGLE_API_KEY:    mask(process.env.GOOGLE_API_KEY),
    VERIFY_TOKEN:      mask(process.env.VERIFY_TOKEN),
    ADMIN_PSID:        process.env.ADMIN_PSID || 'MISSING',
    PORT:              process.env.PORT || '3000',
    MESSENGER_STATUS:  getMessengerStatus(),
  };

  // Quick Gemini test
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    await model.generateContent('Say OK');
    status.GEMINI_TEST = 'PASS ✅';
  } catch(e) {
    status.GEMINI_TEST = 'FAIL ❌ ' + e.message.substring(0, 60);
  }

  // Quick Facebook token test without messaging a customer.
  try {
    const axios = require('axios');
    await axios.get('https://graph.facebook.com/v19.0/me/conversations', {
      params: {
        access_token: process.env.PAGE_ACCESS_TOKEN,
        limit: 1,
        fields: 'id,updated_time',
      },
      timeout: 15000,
    });
    status.FACEBOOK_TOKEN = 'PASS ✅';
  } catch(e) {
    status.FACEBOOK_TOKEN = 'FAIL ❌ ' + (e.response?.data?.error?.message || e.message).substring(0, 80);
  }

  res.json(status);
});

// One-time helper: reply to recent conversations that arrived while Send API was broken.
// Call: /admin/backfill?token=VERIFY_TOKEN&hours=24&limit=25
app.get('/admin/backfill', async (req, res) => {
  const token = req.query.token;
  const allowedToken = process.env.BACKFILL_TOKEN || process.env.VERIFY_TOKEN;
  if (!allowedToken || token !== allowedToken) return res.sendStatus(403);

  const axios = require('axios');
  const hours = Math.min(Math.max(parseInt(req.query.hours || '24', 10), 1), 24);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 50);
  const sinceMs = Date.now() - hours * 60 * 60 * 1000;
  const result = {
    checked: 0,
    replied: 0,
    skipped: 0,
    errors: [],
  };

  try {
    const me = await axios.get('https://graph.facebook.com/v19.0/me', {
      params: { access_token: process.env.PAGE_ACCESS_TOKEN },
    });
    const pageId = String(me.data.id);

    const conversations = await axios.get('https://graph.facebook.com/v19.0/me/conversations', {
      params: {
        access_token: process.env.PAGE_ACCESS_TOKEN,
        limit,
        fields: 'id,updated_time,unread_count,participants,messages.limit(10){id,message,from,created_time,attachments}',
      },
    });

    for (const conversation of conversations.data.data || []) {
      result.checked += 1;
      const updatedAt = new Date(conversation.updated_time || 0).getTime();
      if (!updatedAt || updatedAt < sinceMs) {
        result.skipped += 1;
        continue;
      }

      const messages = conversation.messages?.data || [];
      const latestCustomerMessage = messages.find((msg) => String(msg.from?.id) !== pageId);
      if (!latestCustomerMessage) {
        result.skipped += 1;
        continue;
      }

      const messageTime = new Date(latestCustomerMessage.created_time || 0).getTime();
      if (!messageTime || messageTime < sinceMs) {
        result.skipped += 1;
        continue;
      }

      const senderId = String(latestCustomerMessage.from.id);
      const text = (latestCustomerMessage.message || '').trim();
      const attachments = latestCustomerMessage.attachments?.data || [];
      const hasAudio = attachments.some((attachment) =>
        /audio/i.test(`${attachment.mime_type || ''} ${attachment.name || ''} ${attachment.type || ''}`)
      );

      try {
        await handleMessage(senderId, {
          text,
          attachments: !text && hasAudio ? [{ type: 'audio' }] : [],
        });
        result.replied += 1;
      } catch (err) {
        result.errors.push({
          conversationId: conversation.id,
          message: err.message,
        });
      }
    }

    res.json(result);
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ ...result, error: msg });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'online', bot: 'Hamza 🎧', uptime: Math.floor(process.uptime()) + 's' });
});

app.get('/status', (req, res) => {
  res.json({
    status: 'online',
    bot: 'Hamza',
    uptime: Math.floor(process.uptime()) + 's',
    messenger: getMessengerStatus(),
  });
});

const PORT = process.env.PORT || 3000;
checkRequiredEnv();
app.listen(PORT, () => {
  console.log(`🎧 Hamza is online on port ${PORT}`);
  console.log(`📡 Webhook: https://audoune-bot-production.up.railway.app/webhook`);

  // ─── Self-ping every 14 minutes to stay alive 24/7 ──────────────────────────
  const SELF_URL = 'https://audoune-bot-production.up.railway.app/health';
  setInterval(async () => {
    try {
      const axios = require('axios');
      await axios.get(SELF_URL, { timeout: 10000 });
      console.log('💓 Keep-alive ping sent —', new Date().toISOString());
    } catch (e) {
      console.warn('⚠️ Keep-alive ping failed:', e.message);
    }
  }, 14 * 60 * 1000); // every 14 minutes
});

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎧 Hamza is online on port ${PORT}`);
  console.log(`📡 Webhook URL: http://localhost:${PORT}/webhook`);
});

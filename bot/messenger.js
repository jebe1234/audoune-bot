const axios = require('axios');

const GRAPH_API = 'https://graph.facebook.com/v19.0/me/messages';
const SEND_RETRIES = 2;
const SEND_INTERVAL_MS = Math.max(parseInt(process.env.MESSENGER_SEND_INTERVAL_MS || '1200', 10), 0);
let sendQueue = Promise.resolve();
const messengerStatus = {
  ok: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
};

// ─── Core Send API call ────────────────────────────────────────────────────────
async function callSendAPI(body, options = {}) {
  return enqueueSend(() => callSendAPINow(body, options));
}

async function enqueueSend(task) {
  const run = sendQueue
    .catch(() => {})
    .then(async () => {
      const result = await task();
      if (SEND_INTERVAL_MS) await delay(SEND_INTERVAL_MS);
      return result;
    });
  sendQueue = run.catch(() => {});
  return run;
}

async function callSendAPINow(body, options = {}) {
  let lastError;

  for (let attempt = 0; attempt <= SEND_RETRIES; attempt++) {
    try {
      const response = await axios.post(GRAPH_API, body, {
        params: { access_token: process.env.PAGE_ACCESS_TOKEN },
        timeout: 15000,
      });
      messengerStatus.ok = true;
      messengerStatus.lastSuccessAt = new Date().toISOString();
      messengerStatus.lastError = null;
      return response.data;
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const retryable = !status || status >= 500 || status === 429;
      if (!retryable || attempt === SEND_RETRIES) break;
      await delay(500 * (attempt + 1));
    }
  }

  const msg = lastError.response?.data?.error?.message || lastError.message;
  messengerStatus.ok = false;
  messengerStatus.lastErrorAt = new Date().toISOString();
  messengerStatus.lastError = msg;
  console.error('Messenger API error:', msg);

  if (!options.optional) {
    throw new Error(`Messenger API error: ${msg}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMessengerStatus() {
  return { ...messengerStatus };
}

// ─── Send plain text ───────────────────────────────────────────────────────────
async function sendText(recipientId, text) {
  // Facebook has a 2000-char limit per message — split if needed
  const chunks = splitMessage(text, 1900);
  for (const chunk of chunks) {
    await callSendAPI({
      recipient: { id: recipientId },
      message: { text: chunk },
    });
  }
}

// ─── Send image attachment ────────────────────────────────────────────────────
async function sendImage(recipientId, imageUrl) {
  await callSendAPI({
    recipient: { id: recipientId },
    message: {
      attachment: {
        type: 'image',
        payload: {
          url: imageUrl,
          is_reusable: true,
        },
      },
    },
  });
}

// ─── Send phone call button ───────────────────────────────────────────────────
async function sendCallButton(recipientId, text, phoneNumber, title = 'Call') {
  await callSendAPI({
    recipient: { id: recipientId },
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text,
          buttons: [
            {
              type: 'phone_number',
              title,
              payload: phoneNumber,
            },
          ],
        },
      },
    },
  });
}

// ─── Typing indicators ─────────────────────────────────────────────────────────
async function sendTypingOn(recipientId) {
  await callSendAPI({
    recipient: { id: recipientId },
    sender_action: 'typing_on',
  }, { optional: true });
}

async function sendTypingOff(recipientId) {
  await callSendAPI({
    recipient: { id: recipientId },
    sender_action: 'typing_off',
  }, { optional: true });
}

// ─── Quick reply buttons ───────────────────────────────────────────────────────
async function sendQuickReplies(recipientId, text, quickReplies) {
  await callSendAPI({
    recipient: { id: recipientId },
    message: {
      text,
      quick_replies: quickReplies.map((qr) => ({
        content_type: 'text',
        title: qr.title,
        payload: qr.payload,
      })),
    },
  });
}

// ─── Get user's public profile (name) ─────────────────────────────────────────
async function getUserProfile(userId) {
  try {
    const res = await axios.get(`https://graph.facebook.com/v19.0/${userId}`, {
      params: {
        fields: 'first_name,last_name',
        access_token: process.env.PAGE_ACCESS_TOKEN,
      },
    });
    return res.data;
  } catch {
    return { first_name: null, last_name: '' };
  }
}

// ─── Utility: split long text into chunks ─────────────────────────────────────
function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return chunks;
}

module.exports = {
  sendText,
  sendImage,
  sendCallButton,
  sendTypingOn,
  sendTypingOff,
  sendQuickReplies,
  getUserProfile,
  getMessengerStatus,
};

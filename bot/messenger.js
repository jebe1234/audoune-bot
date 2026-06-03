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
  usage: {},
};

function parseUsageHeader(value) {
  if (!value) return null;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

function collectUsageNumbers(value, values = [], regainMinutes = []) {
  if (!value) return { values, regainMinutes };

  if (Array.isArray(value)) {
    for (const item of value) collectUsageNumbers(item, values, regainMinutes);
    return { values, regainMinutes };
  }

  if (typeof value === 'object') {
    for (const key of ['call_count', 'call_volume', 'total_cputime', 'total_time']) {
      const number = Number(value[key]);
      if (Number.isFinite(number)) values.push(number);
    }
    const regain = Number(value.estimated_time_to_regain_access);
    if (Number.isFinite(regain) && regain > 0) regainMinutes.push(regain);

    for (const item of Object.values(value)) {
      if (item && typeof item === 'object') collectUsageNumbers(item, values, regainMinutes);
    }
  }

  return { values, regainMinutes };
}

function getHighestUsagePercent(usage = {}) {
  const { values } = collectUsageNumbers(usage);
  return values.length ? Math.max(...values) : 0;
}

function getEstimatedRegainMinutes(usage = {}) {
  const { regainMinutes } = collectUsageNumbers(usage);
  return regainMinutes.length ? Math.max(...regainMinutes) : 0;
}

function isRateLimitError(err) {
  const code = Number(err.response?.data?.error?.code);
  const subcode = Number(err.response?.data?.error?.error_subcode);
  return (
    [4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014].includes(code) ||
    subcode === 2446079 ||
    /rate limit|too many calls|throttl/i.test(err.response?.data?.error?.message || err.message || '')
  );
}

function getRateLimitWaitMs(err) {
  const headers = err.response?.headers || {};
  const usage = {
    app: parseUsageHeader(headers['x-app-usage']),
    page: parseUsageHeader(headers['x-page-usage']),
    business: parseUsageHeader(headers['x-business-use-case-usage']),
  };
  const regainMinutes = getEstimatedRegainMinutes(usage);
  if (regainMinutes) return Math.min(regainMinutes * 60 * 1000, 30 * 60 * 1000);
  return 5 * 60 * 1000;
}

function captureMetaUsage(headers = {}) {
  const usage = {
    app: parseUsageHeader(headers['x-app-usage']),
    page: parseUsageHeader(headers['x-page-usage']),
    business: parseUsageHeader(headers['x-business-use-case-usage']),
  };
  Object.keys(usage).forEach((key) => {
    if (!usage[key]) delete usage[key];
  });
  if (Object.keys(usage).length) {
    messengerStatus.usage = usage;
    messengerStatus.highestUsagePercent = getHighestUsagePercent(usage);
    messengerStatus.estimatedRegainMinutes = getEstimatedRegainMinutes(usage);
  }
  return usage;
}

async function maybeBackoffForMetaUsage() {
  const highest = messengerStatus.highestUsagePercent || 0;
  const regainMinutes = messengerStatus.estimatedRegainMinutes || 0;
  if (regainMinutes > 0) {
    const waitMs = Math.min(regainMinutes * 60 * 1000, 30 * 60 * 1000);
    console.warn(`Meta asks to regain access in ${regainMinutes} minutes. Backing off.`);
    await delay(waitMs);
  } else if (highest >= 95) {
    console.warn(`Meta usage is very high (${highest}%). Backing off for 10 minutes.`);
    await delay(10 * 60 * 1000);
  } else if (highest >= 85) {
    console.warn(`Meta usage is high (${highest}%). Backing off for 60 seconds.`);
    await delay(60 * 1000);
  }
}

// ─── Core Send API call ────────────────────────────────────────────────────────
async function callSendAPI(body, options = {}) {
  return enqueueSend(() => callSendAPINow(body, options));
}

async function enqueueSend(task) {
  const run = sendQueue
    .catch(() => {})
    .then(async () => {
      await maybeBackoffForMetaUsage();
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
      captureMetaUsage(response.headers);
      messengerStatus.ok = true;
      messengerStatus.lastSuccessAt = new Date().toISOString();
      messengerStatus.lastError = null;
      return response.data;
    } catch (err) {
      lastError = err;
      captureMetaUsage(err.response?.headers || {});
      if (isRateLimitError(err)) {
        const waitMs = getRateLimitWaitMs(err);
        messengerStatus.highestUsagePercent = 100;
        messengerStatus.rateLimitedUntil = new Date(Date.now() + waitMs).toISOString();
        console.warn(`Meta rate limit hit. Backing off until ${messengerStatus.rateLimitedUntil}.`);
        await delay(waitMs);
      }
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
  captureMetaUsage,
};

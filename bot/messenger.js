const axios = require('axios');

const GRAPH_API = 'https://graph.facebook.com/v19.0/me/messages';

// ─── Core Send API call ────────────────────────────────────────────────────────
async function callSendAPI(body) {
  try {
    await axios.post(GRAPH_API, body, {
      params: { access_token: process.env.PAGE_ACCESS_TOKEN },
    });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('Messenger API error:', msg);
  }
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

// ─── Typing indicators ─────────────────────────────────────────────────────────
async function sendTypingOn(recipientId) {
  await callSendAPI({
    recipient: { id: recipientId },
    sender_action: 'typing_on',
  });
}

async function sendTypingOff(recipientId) {
  await callSendAPI({
    recipient: { id: recipientId },
    sender_action: 'typing_off',
  });
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
    return { first_name: 'صديقي', last_name: '' };
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
  sendTypingOn,
  sendTypingOff,
  sendQuickReplies,
  getUserProfile,
};

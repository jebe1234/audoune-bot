const axios = require('axios');

function extractPhoneNumbers(text) {
  const input = String(text || '');
  const matches = input.match(/(?:\+?213|0)(?:[\s.\-()]?\d){8,9}/g) || [];
  return [...new Set(matches.map(normalizePhone).filter(Boolean))];
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;

  if (digits.startsWith('213') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+213${digits.slice(1)}`;
  if (digits.length === 9 && /^[567]/.test(digits)) return `+213${digits}`;

  return null;
}

async function appendLeadToSheet(lead) {
  const url = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  if (!url) return { skipped: true, reason: 'GOOGLE_SHEET_WEBHOOK_URL not set' };

  const payload = {
    secret: process.env.GOOGLE_SHEET_WEBHOOK_SECRET || '',
    source: 'messenger',
    ...lead,
  };

  const response = await axios.post(url, payload, {
    timeout: 12000,
    headers: { 'Content-Type': 'application/json' },
  });

  return response.data;
}

module.exports = {
  extractPhoneNumbers,
  appendLeadToSheet,
};

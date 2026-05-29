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

function inferLeadStatus(text, lead = {}) {
  if (lead.status) return lead.status;
  if (hasLeadDetails(text, lead)) return 'he wants to order';
  return 'status unknown';
}

function hasLeadDetails(text, lead = {}) {
  const input = String(text || '').toLowerCase();
  const hasOrderWords = /(نطلب|نحب نطلب|خلاص|ارسلي|ابعث|ابعت|كوموند|commande|order|نشري)/i.test(input);
  const hasAddressWords = /(عنوان|العنوان|ولاية|بلدية|دايرة|دائرة|حي|شارع|المدية|الوادي|الجزائر|وهران|سطيف|عنابة|باتنة|بسكرة|مستغانم|تيارت|الجلفة|المغير)/i.test(input);
  const hasNameWords = /(الاسم|اسمي|سمية|سميتي|name|nom)/i.test(input);
  const hasStructuredOrder = Boolean(lead.client_name || lead.name || lead.wilaya || lead.address);
  return hasStructuredOrder || hasOrderWords || (hasAddressWords && hasNameWords);
}

module.exports = {
  extractPhoneNumbers,
  inferLeadStatus,
  hasLeadDetails,
  appendLeadToSheet,
};

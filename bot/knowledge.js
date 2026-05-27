const fs   = require('fs');
const path  = require('path');
const { v4: uuidv4 } = require('uuid');

const KB_PATH = path.join(__dirname, '../data/knowledge.json');

// ─── Load / Save ───────────────────────────────────────────────────────────────
function load() {
  try {
    return JSON.parse(fs.readFileSync(KB_PATH, 'utf8'));
  } catch {
    return { business: {}, product: {}, faqs: [], pending_facts: [], learned_facts: [] };
  }
}

function save(data) {
  fs.writeFileSync(KB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// ─── Build context string for the AI ──────────────────────────────────────────
function getContext() {
  const kb = load();
  const b  = kb.business;
  const p  = kb.product;

  let ctx = `
=== AUDOUNE BUSINESS INFO ===
- Company: ${b.name} (${b.name_ar})
- Product: ${p.model} — ${p.style}
- Price: ${b.price} DA (livraison incluse / شاملة التوصيل)
- Delivery: FREE to all ${b.delivery_wilayas} / مجانية لكل الولايات
- Delivery time: ${b.delivery_time}
- Effectiveness: ${b.effectiveness_range}

=== PRODUCT KEY FEATURES ===
${(p.key_features || []).join('\n')}

=== PRODUCT SPECS ===
- Battery life: ${p.specs?.working_time}
- Charging time: ${p.specs?.charging_time}
- Weight: ${p.specs?.weight}
- Colors: ${p.specs?.colors?.join(', ')}
- Frequency range: ${p.specs?.frequency_range}
- Certifications: ${(p.certifications || []).join(', ')}

=== KNOWN Q&A ===`;

  const allFacts = [
    ...kb.faqs,
    ...kb.learned_facts.filter((f) => f.approved),
  ];

  for (const faq of allFacts) {
    ctx += `\nTOPIC: ${faq.question_summary || faq.id}`;
    ctx += `\n  FR: ${faq.answer_fr || faq.answer || ''}`;
    ctx += `\n  AR: ${faq.answer_ar || faq.answer || ''}\n`;
  }

  return ctx;
}

// ─── Save a new pending fact (learned from AI response) ───────────────────────
function savePendingFact({ question, answer, topic, userId, confidence }) {
  const kb   = load();
  const fact = {
    id:               uuidv4(),
    question_summary: question,
    answer:           answer,
    topic:            topic || 'general',
    userId,
    confidence,
    timestamp:        new Date().toISOString(),
    approved:         false,
  };
  kb.pending_facts.push(fact);
  save(kb);
  return fact.id;
}

// ─── Approve a pending fact (admin command) ────────────────────────────────────
function approveFact(shortId) {
  const kb  = load();
  const idx = kb.pending_facts.findIndex((f) => f.id.startsWith(shortId));
  if (idx === -1) return false;

  const fact = kb.pending_facts.splice(idx, 1)[0];
  fact.approved   = true;
  fact.approvedAt = new Date().toISOString();
  kb.learned_facts.push(fact);
  save(kb);
  return true;
}

// ─── Correct + approve a pending fact ─────────────────────────────────────────
function correctFact(shortId, newAnswer) {
  const kb  = load();
  const idx = kb.pending_facts.findIndex((f) => f.id.startsWith(shortId));
  if (idx === -1) return false;

  const fact        = kb.pending_facts.splice(idx, 1)[0];
  fact.answer       = newAnswer;
  fact.approved     = true;
  fact.corrected    = true;
  fact.approvedAt   = new Date().toISOString();
  kb.learned_facts.push(fact);
  save(kb);
  return true;
}

// ─── Admin manually adds a new fact ───────────────────────────────────────────
function addAdminFact(question, answerFr, answerAr) {
  const kb   = load();
  const fact = {
    id:               uuidv4(),
    question_summary: question,
    answer_fr:        answerFr,
    answer_ar:        answerAr || answerFr,
    confidence:       'high',
    source:           'admin',
    timestamp:        new Date().toISOString(),
    approved:         true,
  };
  kb.learned_facts.push(fact);
  save(kb);
  return fact.id;
}

// ─── Get all pending facts ─────────────────────────────────────────────────────
function getPendingFacts() {
  return load().pending_facts;
}

module.exports = {
  load,
  save,
  getContext,
  savePendingFact,
  approveFact,
  correctFact,
  addAdminFact,
  getPendingFacts,
};

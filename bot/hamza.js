const {
  sendText,
  sendImage,
  sendCallButton,
  sendTypingOn,
  sendTypingOff,
  getUserProfile,
} = require('./messenger');
const fs                                      = require('fs');
const path                                    = require('path');
const { generateResponse }                    = require('./ai');
const { detectLanguage, getGreeting }         = require('./language');
const knowledge                               = require('./knowledge');
const { extractPhoneNumbers, inferLeadStatus, hasLeadDetails, appendLeadToSheet } = require('./sheets');
const { isAdmin, notifyAdmin, notifyAdminOrder, handleAdminCommand } = require('./admin');

// â”€â”€â”€ In-memory user sessions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Key: Messenger PSID | Value: { language, history, firstName, isNew, orderBuffer }
const sessions = new Map();
const pendingMessages = new Map();
const MESSAGE_BATCH_DELAY_MS = parseInt(process.env.MESSAGE_BATCH_DELAY_MS || '5000', 10);
const PHONE_ONLY_LEAD_DELAY_MS = parseInt(process.env.PHONE_ONLY_LEAD_DELAY_MS || '240000', 10);
const HUMAN_CONTEXT_PAUSE_MS = 2 * 60 * 1000;

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      language:     null,
      history:      [],
      firstName:    null,
      profileName:  null,
      isNew:        true,
      orderBuffer:  {},     // Accumulates order details as customer provides them
      pendingPhoneLeads: {},
      messageCount: 0,
      bushraMode:   false,
      bushraLoveCount: 0,
      priceMentioned: false,
      priceObjectionCount: 0,
      humanContextUntil: 0,
      adminMode: false,
      memory: {
        facts: {},
        asked: {},
        lastQuestion: null,
      },
    });
  }
  return sessions.get(userId);
}

function normalizeMemoryText(content) {
  return String(content || '').toLowerCase().trim();
}

function rememberFact(session, key, value) {
  if (!session.memory) session.memory = { facts: {}, asked: {}, lastQuestion: null };
  if (value !== undefined && value !== null && String(value).trim()) {
    session.memory.facts[key] = String(value).trim();
  }
}

function markAsked(session, key) {
  if (!session.memory) session.memory = { facts: {}, asked: {}, lastQuestion: null };
  session.memory.asked[key] = Date.now();
  session.memory.lastQuestion = key;
}

function detectQuestionKey(content) {
  const text = normalizeMemoryText(content);
  if (/(percentage|pourcentage|%|شحال يسمع|قداه يسمع|ناقص بزاف|متوسط|مليح)/i.test(text)) return 'hearing_level';
  if (/(age|old|ans|عمر|عمرو|سن)/i.test(text)) return 'age';
  if (/(one ear|both ears|oreille|deux|ودن|وذن|زوج|زوز)/i.test(text)) return 'ears';
  if (/(tv|télé|tele|volume|تلفزيون|تيليفزيون)/i.test(text)) return 'tv_volume';
  if (/(since|depuis|وقتاش|منين|مدة)/i.test(text)) return 'duration';
  if (/(pain|douleur|vertige|infection|وجع|دوخة|التهاب|سيلان)/i.test(text)) return 'symptoms';
  return null;
}

function updateMemoryFromUser(session, content) {
  if (!session.memory) session.memory = { facts: {}, asked: {}, lastQuestion: null };
  const text = normalizeMemoryText(content);
  if (!text) return;
  const lastQuestion = session.memory.lastQuestion;

  if (/^\s*\d{1,3}\s*(?:عام|سنة|ans|years?)?\s*$/i.test(text) && lastQuestion === 'age') {
    const ageOnly = text.match(/\d{1,3}/)?.[0];
    if (ageOnly) rememberFact(session, 'age', ageOnly);
    session.memory.lastQuestion = null;
    return;
  }

  if (lastQuestion === 'ears' && /(لزوج|زوج|زوز|both|deux)/i.test(text)) {
    rememberFact(session, 'ears', 'both ears');
    session.memory.lastQuestion = null;
    return;
  }

  if (lastQuestion === 'ears' && /(وحدة|واحدة|one|une)/i.test(text)) {
    rememberFact(session, 'ears', 'one ear');
    session.memory.lastQuestion = null;
    return;
  }

  if (lastQuestion === 'hearing_level' && /(بزاف|ناقص|ضعيف|faible|weak)/i.test(text)) {
    rememberFact(session, 'hearing_level', 'very weak');
    session.memory.lastQuestion = null;
    return;
  }

  const percent = text.match(/\b(10|20|30|40|50|60|70|80|90|100)\s*%/);
  if (percent) rememberFact(session, 'hearing_level', `${percent[1]}%`);
  else if (/(ناقص بزاف|tr[eè]s faible|very weak|bad hearing)/i.test(text)) rememberFact(session, 'hearing_level', 'very weak');
  else if (/(متوسط|moyen|medium)/i.test(text)) rememberFact(session, 'hearing_level', 'medium');
  else if (/(مليح|good|bien)/i.test(text)) rememberFact(session, 'hearing_level', 'good');

  const age =
    text.match(/(?:age|old|ans|عمر|عمرو|سن)[^\d]{0,12}(\d{1,3})/i) ||
    text.match(/\b(\d{1,3})\s*(?:ans|years?|سنة|عام)\b/i) ||
    text.match(/(\d{1,3})\s*(?:عام|سنة)/i);
  if (age) rememberFact(session, 'age', age[1]);

  if (/(both|two ears|les deux|deux oreilles|لزوج|زوج|زوز)/i.test(text)) rememberFact(session, 'ears', 'both ears');
  else if (/(one ear|une oreille|ودن وحدة|وذن وحدة|واحدة)/i.test(text)) rememberFact(session, 'ears', 'one ear');

  if (/(لهدرة|الهدرة|الكلام|منفرزش|ما نفرزش|speech|paroles)/i.test(text)) {
    rememberFact(session, 'speech_clarity', 'hears sound but speech is not clear');
  }

  if (/(tv|télé|tele|volume|تلفزيون|تيليفزيون)/i.test(text)) {
    if (/(yes|oui|ايه|نعم|بزاف|يرفع|يعلي)/i.test(text)) rememberFact(session, 'tv_volume', 'raises TV volume');
    if (/(no|non|لا|ماشي)/i.test(text)) rememberFact(session, 'tv_volume', 'does not raise TV volume');
  }

  const duration =
    text.match(/(?:since|depuis|منذ|من|وقتاش|مدة)[^\n.،]{0,40}/i) ||
    text.match(/\b(\d+\s*(?:days?|weeks?|months?|years?|jours?|semaines?|mois|ans|ايام|اسابيع|شهور|سنين|عام))\b/i);
  if (duration) rememberFact(session, 'duration', duration[0]);

  if (/(pain|douleur|وجع|يضر|سيلان|infection|التهاب|vertige|دوخة)/i.test(text)) {
    rememberFact(session, 'symptoms', text);
  }

  if (/^\s*(yes|oui|ايه|نعم|صح|كاين)\s*$/i.test(text) && session.memory.lastQuestion) {
    rememberFact(session, session.memory.lastQuestion, 'yes');
  }
  if (/^\s*(no|non|لا|ماكانش|ما كاينش)\s*$/i.test(text) && session.memory.lastQuestion) {
    rememberFact(session, session.memory.lastQuestion, 'no');
  }

  session.memory.lastQuestion = null;
}

function updateMemoryFromAssistant(session, content) {
  const key = detectQuestionKey(content);
  if (key) markAsked(session, key);
}

function addToHistory(session, role, content) {
  if (role === 'user') updateMemoryFromUser(session, content);
  if (role === 'assistant') updateMemoryFromAssistant(session, content);
  session.history.push({ role, content, timestamp: Date.now() });
  if (session.history.length > 40) session.history.shift();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergePendingMessages(messages) {
  const texts = messages
    .map((message) => (message.text || '').trim())
    .filter(Boolean);
  const attachments = messages.flatMap((message) => message.attachments || []);

  return {
    text: texts.join('\n').trim(),
    attachments,
  };
}

function enqueueCustomerMessage(senderId, message) {
  let pending = pendingMessages.get(senderId);
  if (!pending) {
    pending = { messages: [], timer: null };
    pendingMessages.set(senderId, pending);
  }

  pending.messages.push(message);
  if (pending.timer) clearTimeout(pending.timer);

  pending.timer = setTimeout(async () => {
    const current = pendingMessages.get(senderId);
    if (!current) return;
    pendingMessages.delete(senderId);

    try {
      await processMessage(senderId, mergePendingMessages(current.messages));
    } catch (err) {
      console.error('Error processing batched messages:', err.message);
    }
  }, MESSAGE_BATCH_DELAY_MS);
}

function isPhotoRequest(text) {
  return /(photo|image|picture|pic|صور|صورة|تصويرة|فوطو|فوتو|وريني|نشوفها|شوفني|شكلها|نشوفو|ابعثلي|ابعتلي)/i.test(text);
}

async function ensureCustomerProfile(senderId, session) {
  if (session.profileName) return;
  const profile = await getUserProfile(senderId);
  const first = profile.first_name || '';
  const last = profile.last_name || '';
  session.firstName = first || null;
  session.profileName = `${first} ${last}`.trim();
}

function buildLead(senderId, session, phone, text, status = null) {
  const lead = {
    profile_name: session.profileName || '',
    client_name: session.orderBuffer.name || session.memory?.facts?.order_name || '',
    wilaya: session.orderBuffer.wilaya || session.memory?.facts?.order_wilaya || '',
    address: session.orderBuffer.address || session.memory?.facts?.order_address || '',
  };

  return {
    ...lead,
    phone,
    status: status || inferLeadStatus(text, lead),
    messenger_id: senderId,
    product: 'Great-Ears G19S',
    summary: buildLeadSummary(session, text),
    language: session.language || '',
    last_message: text,
    created_at: new Date().toISOString(),
  };
}

function buildLeadSummary(session, text) {
  const facts = session.memory?.facts || {};
  const parts = [];
  if (facts.hearing_level) parts.push(`hearing: ${facts.hearing_level}`);
  if (facts.ears) parts.push(`ears: ${facts.ears}`);
  if (facts.speech_clarity) parts.push('speech unclear');
  if (facts.tv_volume) parts.push(`tv: ${facts.tv_volume}`);
  if (facts.duration) parts.push(`duration: ${facts.duration}`);
  if (facts.symptoms) parts.push(`symptoms: ${facts.symptoms}`);

  const cleanMessage = String(text || '').replace(/\s+/g, ' ').trim();
  if (cleanMessage) parts.push(`last: ${cleanMessage.slice(0, 120)}`);
  return parts.join(' | ');
}

async function sendLeadToSheet(senderId, session, phone, text, status = null) {
  try {
    await ensureCustomerProfile(senderId, session);
    await appendLeadToSheet(buildLead(senderId, session, phone, text, status));
    console.log(`Lead phone sent to Google Sheet for ${senderId}: ${phone}`);
  } catch (err) {
    console.error('Google Sheet lead append failed:', err.response?.data || err.message);
  }
}

function clearPendingPhoneLead(session, phone) {
  const pending = session.pendingPhoneLeads?.[phone];
  if (pending?.timer) clearTimeout(pending.timer);
  if (session.pendingPhoneLeads) delete session.pendingPhoneLeads[phone];
}

function scheduleStatusUnknownLead(senderId, session, phone, text) {
  clearPendingPhoneLead(session, phone);
  session.pendingPhoneLeads[phone] = {
    text,
    timer: setTimeout(async () => {
      const pending = session.pendingPhoneLeads?.[phone];
      if (!pending) return;
      delete session.pendingPhoneLeads[phone];
      await sendLeadToSheet(senderId, session, phone, pending.text, 'status unknown');
    }, PHONE_ONLY_LEAD_DELAY_MS),
  };
}

async function flushPendingPhoneLeads(senderId, session, text) {
  const phones = Object.keys(session.pendingPhoneLeads || {});
  for (const phone of phones) {
    clearPendingPhoneLead(session, phone);
    await sendLeadToSheet(senderId, session, phone, text, 'he wants to order');
  }
}

async function logPhonesFromMessage(senderId, session, text, options = {}) {
  const phones = extractPhoneNumbers(text);
  if (!phones.length) return;

  await ensureCustomerProfile(senderId, session);

  for (const phone of phones) {
    rememberFact(session, 'order_phone', phone);
    session.orderBuffer.phone = phone;

    const lead = buildLead(senderId, session, phone, text, options.status);
    if (options.immediate || hasLeadDetails(text, lead)) {
      clearPendingPhoneLead(session, phone);
      await sendLeadToSheet(senderId, session, phone, text, lead.status);
    } else {
      scheduleStatusUnknownLead(senderId, session, phone, text);
    }
  }
}

function isPhoneRequest(text) {
  return /(phone|number|call|tel|t[eé]l[eé]phone|num[eé]ro|appel|appeler|رقم|نمرا|نمروا|تليفون|هاتف|عيط|نتصل|اتصل|نكلم|كول)/i.test(text);
}

function isPriceRequest(text) {
  return /(price|prix|combien|how much|السومة|السعر|الثمن|شحال|قداه|بشحال|بكاش|دراهم|دينار|دا|دج)/i.test(text);
}

function isPriceObjection(text) {
  return /(غالي|بزاف|cher|trop|expensive|ما قدرتش|نقص|ديرلي|remise|discount|خصم)/i.test(text);
}

function getPriceResponse(lang, session, text) {
  if (session.priceMentioned && isPriceObjection(text)) {
    session.priceObjectionCount += 1;
    if (session.priceObjectionCount >= 2) {
      return lang === 'fr'
        ? 'Je peux vous la faire à 14000 DA.'
        : 'نقدر نديرهالك 14000 دج برك.';
    }
    return lang === 'fr'
      ? 'Je comprends, mais elle est rechargeable, le son est propre, et la livraison est gratuite.'
      : 'نفهمك، بصح راهي قابلة للشحن وصوتها صافي والتوصيل مجاني.';
  }

  session.priceMentioned = true;
  return lang === 'fr'
    ? 'Le prix est 14500 DA, livraison gratuite dans les 58 wilayas.'
    : 'السومة 14500 دج، والتوصيل مجاني لقاع الولايات.';
}

function hasAudioAttachment(message) {
  return (message.attachments || []).some((attachment) => attachment.type === 'audio');
}

function getPhoneHandoffMessage(lang) {
  return lang === 'fr'
    ? "Vous pouvez m'appeler ici: +213563746369"
    : 'تقدر تعيطلي هنا: +213563746369';
}

function getClarifyMessage(lang, isAudio = false) {
  if (lang === 'fr') {
    return isAudio
      ? "Je n'ai pas bien compris le vocal. Renvoyez-le un peu plus clairement, ou écrivez-moi juste votre question."
      : "Je n'ai pas bien compris. Vous pouvez me le dire autrement?";
  }

  return isAudio
    ? 'ما فهمتش الصوت مليح. عاود ابعثه واضح شوية، ولا اكتبلي السؤال برك.'
    : 'ما فهمتش مليح. تقدر تعاودها بطريقة أخرى؟';
}

async function sendPhoneHandoff(recipientId, lang) {
  const phone = '+213563746369';
  const text = getPhoneHandoffMessage(lang);
  const title = lang === 'fr' ? 'Appeler' : 'اتصل الآن';
  await sendCallButton(recipientId, text, phone, title);
}

function isBushraTrigger(text) {
  const hasBushra = /bushra|bouchra|boushra|بشرى|بشرا|بوشرا/i.test(text);
  const asksWho = /من|who|qui|هو|هي|مين|ميش|c'est/i.test(text);
  const saysIam = /\b(i am|i'm|im|me|moi)\b/i.test(text) || /انا|أنا|راني|اني|أنايا|ana/i.test(text);
  return hasBushra && (asksWho || saysIam);
}

function isAdminModeTrigger(text) {
  return /^(i'?m|i am)\s+the\s+admin$|^admin$|^انا\s+الادمن$|^راني\s+الادمن$/i.test(text.trim());
}

function extractAdminLearnInstruction(text) {
  const trimmed = text.trim();
  const learnMatch = trimmed.match(/^(?:learn|teach|make him learn|خليه يتعلم|علمو)\s*[:\-]?\s*(.+)$/i);
  const content = learnMatch ? learnMatch[1].trim() : trimmed;
  const separator = content.includes('=') ? '=' : content.includes(':') ? ':' : null;
  if (!separator) return null;

  const parts = content.split(separator);
  if (parts.length < 2) return null;

  const question = parts[0].trim();
  const answer = parts.slice(1).join(separator).trim();
  if (!question || !answer) return null;
  return { question, answer };
}

async function handleAdminModeMessage(senderId, session, text) {
  if (!isAdmin(senderId)) return false;

  if (isAdminModeTrigger(text)) {
    session.adminMode = true;
    await sendText(senderId, 'Admin mode on. اكتب: learn السؤال = الجواب');
    return true;
  }

  if (!session.adminMode) return false;

  if (/^(exit admin|stop admin|خرج|حبس)$/i.test(text.trim())) {
    session.adminMode = false;
    await sendText(senderId, 'Admin mode off.');
    return true;
  }

  const instruction = extractAdminLearnInstruction(text);
  if (instruction) {
    const id = knowledge.addAdminFact(instruction.question, instruction.answer, instruction.answer);
    await sendText(senderId, `تم. Hamza تعلمها.\nID: ${id.substring(0, 8)}`);
    return true;
  }

  await sendText(senderId, 'اكتبها هكذا: learn السؤال = الجواب');
  return true;
}

function getProductPhotoUrls() {
  const manifestPath = path.join(__dirname, '../data/products/G19S.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const urls = (manifest.photos || []).map((photo) => photo.url).filter(Boolean);
    if (urls.length) return urls;
  } catch (err) {
    console.warn('Could not load G19S photo manifest:', err.message);
  }

  return process.env.PRODUCT_PHOTO_URL ? [process.env.PRODUCT_PHOTO_URL] : [];
}

function getBushraLoveMessage(session) {
  const messages = [
    'نحبك بزاف يا عمري. كل رسالة منك تفرحني.',
    'حبيتك اليوم، ونحبك غدوة، ونحبك كل نهار أكثر.',
    'يا السكر تاعي، وجودك وحدو يكفيني.',
    'نحب ضحكتك، قلبك، صوتك، وحتى عنادك نحبو.',
    'ربي يخليك ليا يا حياتي. انتي أجمل حاجة صراتلي.',
    'يا بشرى، كل ما تهدري نحس الدنيا ولات أخف.',
    'نحبك حب كبير، ماشي تاع كلام برك، تاع قلب وروح.',
    'انتي الحنان تاعي، الأمان تاعي، والفرحة تاعي.',
  ];

  const index = session.bushraLoveCount % messages.length;
  session.bushraLoveCount += 1;
  return messages[index];
}

// â”€â”€â”€ Handle incoming text messages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function handleMessage(senderId, message) {
  const text = (message.text || '').trim();
  if (isAdmin(senderId) && text.startsWith('!')) {
    await handleAdminCommand(senderId, text);
    return;
  }

  enqueueCustomerMessage(senderId, message);
}

async function processMessage(senderId, message) {
  const session = getSession(senderId);
  let text = (message.text || '').trim();

  if (!text && hasAudioAttachment(message)) {
    const lang = session.language || 'dz';
    await sendTypingOn(senderId);
    await delay(500);
    await sendTypingOff(senderId);
    const msg = getPhoneHandoffMessage(lang);
    await sendPhoneHandoff(senderId, lang);
    addToHistory(session, 'user', '[audio]');
    addToHistory(session, 'assistant', msg);
    return;
  }

  if (!text) return;

  await logPhonesFromMessage(senderId, session, text);

  // â”€â”€ Admin command handling â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (isAdmin(senderId) && text.startsWith('!')) {
    await handleAdminCommand(senderId, text);
    return;
  }

  if (await handleAdminModeMessage(senderId, session, text)) {
    return;
  }

  // â”€â”€ ðŸ¥š Easter egg: Yaseen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (/ياسين|yaseen|yassine|ياسن|jassin/i.test(text) && /من|who|qui|هو|مين|ميش|c'est/i.test(text)) {
    await sendTypingOn(senderId);
    await delay(1000);
    await sendTypingOff(senderId);
    await sendText(senderId,
      detectLanguage(text) === 'fr'
        ? `Yaseen est quelqu'un de l'équipe.`
        : `ياسين واحد من الفريق.`
    );
    return;
  }

  // â”€â”€ Easter egg: Bushra â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (isBushraTrigger(text)) {
    session.bushraMode = true;
    session.bushraLoveCount = 0;

    const msg = [
      'بحميتي نحبك بززاف يالعمريك يالسكرر تعي',
      '',
      'بشرى هي القلب الحنين والضحكة اللي تهون الدنيا.',
      'هي الإنسانة اللي وجودها يخلي كل نهار أحسن من اللي قبلو.',
      'ربي يخليها ليا، ويحفظها، ويزيد بيناتنا المحبة والستر.',
      '',
      'يا بشرى، نحبك على قلبك، على صبرك، على ضحكتك، وعلى كل حاجة فيك.',
    ].join('\n');

    await sendTypingOn(senderId);
    await delay(1000);
    await sendTypingOff(senderId);
    await sendText(senderId, msg);
    return;
  }

  if (session.bushraMode) {
    const msg = getBushraLoveMessage(session);
    await sendTypingOn(senderId);
    await delay(700);
    await sendTypingOff(senderId);
    await sendText(senderId, msg);
    addToHistory(session, 'user', text);
    addToHistory(session, 'assistant', msg);
    return;
  }

  if (isPhotoRequest(text)) {
    const lang = session.language || detectLanguage(text);
    const photoUrls = getProductPhotoUrls();

    await sendTypingOn(senderId);
    await delay(500);
    await sendTypingOff(senderId);

    addToHistory(session, 'user', text);

    if (photoUrls.length) {
      for (const photoUrl of photoUrls) {
        await sendImage(senderId, photoUrl);
        await delay(300);
      }
      const msg = lang === 'fr'
        ? 'Voici les photos du produit.'
        : 'هذو صور المنتج.';
      await sendText(senderId, msg);
      addToHistory(session, 'assistant', msg);
    } else {
      const msg = lang === 'fr'
        ? "La photo n'est pas encore configurée. Je peux quand même vous donner les détails du produit."
        : 'الصورة ما راهيش مبرمجة دروك. نقدر نعطيك تفاصيل المنتج.';
      await sendText(senderId, msg);
      addToHistory(session, 'assistant', msg);
    }
    return;
  }

  if (isPhoneRequest(text)) {
    const lang = session.language || detectLanguage(text);
    const msg = getPhoneHandoffMessage(lang);
    await sendPhoneHandoff(senderId, lang);
    addToHistory(session, 'user', text);
    addToHistory(session, 'assistant', msg);
    return;
  }

  if (isPriceRequest(text) || (session.priceMentioned && isPriceObjection(text))) {
    const lang = session.language || detectLanguage(text);
    const msg = getPriceResponse(lang, session, text);
    await sendTypingOn(senderId);
    await delay(500);
    await sendTypingOff(senderId);
    await sendText(senderId, msg);
    addToHistory(session, 'user', text);
    addToHistory(session, 'assistant', msg);
    return;
  }

  session.messageCount++;

  // â”€â”€ Language detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (!session.language) {
    session.language = detectLanguage(text);
  } else {
    // Re-detect on each message â€” customer might switch language
    const detected = detectLanguage(text);
    if (detected !== session.language && text.split(' ').length > 2) {
      session.language = detected; // Respect language switch for multi-word messages
    }
  }

  // â”€â”€ Fetch user's first name (once) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  await ensureCustomerProfile(senderId, session);

  // â”€â”€ Update conversation history â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  addToHistory(session, 'user', text);

  // â”€â”€ Show typing indicator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  await sendTypingOn(senderId);

  // â”€â”€ Get current knowledge context â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const knowledgeContext = knowledge.getContext();

  // â”€â”€ Generate AI response â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const aiResult = await generateResponse(
    text,
    session.language,
    session.history,
    session.memory,
    knowledgeContext
  );

  // â”€â”€ Update detected language from AI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (aiResult.detected_language) {
    session.language = aiResult.detected_language;
  }

  // â”€â”€ Natural typing delay (feels human) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const thinkTime = Math.min(800 + text.length * 15, 3000);
  await delay(thinkTime);
  await sendTypingOff(senderId);

  // â”€â”€ Send the response â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (aiResult.needs_admin && !aiResult.message) {
    aiResult.message = getClarifyMessage(session.language || 'dz');
    await sendText(senderId, aiResult.message);
  } else {
    await sendText(senderId, aiResult.message);
  }
  addToHistory(session, 'assistant', aiResult.message);

  // â”€â”€ Handle order collection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (aiResult.order_info) {
    const o = aiResult.order_info;
    if (o.name)   session.orderBuffer.name   = o.name;
    if (o.phone)  session.orderBuffer.phone  = o.phone;
    if (o.wilaya) session.orderBuffer.wilaya = o.wilaya;
    if (o.address) session.orderBuffer.address = o.address;
    if (o.name)   rememberFact(session, 'order_name', o.name);
    if (o.phone)  rememberFact(session, 'order_phone', o.phone);
    if (o.wilaya) rememberFact(session, 'order_wilaya', o.wilaya);
    if (o.address) rememberFact(session, 'order_address', o.address);

    const buf = session.orderBuffer;
    if ((buf.name || buf.wilaya || buf.address) && Object.keys(session.pendingPhoneLeads || {}).length) {
      await flushPendingPhoneLeads(senderId, session, text);
    }

    if (buf.name && buf.phone && buf.wilaya) {
      await logPhonesFromMessage(senderId, session, buf.phone, { immediate: true, status: 'he wants to order' });
      // Complete order â€” notify admin
      await notifyAdminOrder(buf, senderId);
      session.orderBuffer = {}; // Reset
      console.log(`ðŸ“¦ New order from ${senderId}:`, buf);
    }
  }

  // â”€â”€ Self-learning: save new facts for admin review â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (aiResult.learned_fact && aiResult.confidence !== 'high') {
    const factId = knowledge.savePendingFact({
      question:   aiResult.learned_fact.question_summary,
      answer:     aiResult.learned_fact.answer_summary,
      topic:      aiResult.learned_fact.topic,
      userId:     senderId,
      confidence: aiResult.confidence,
    });

    await notifyAdmin(
      `ðŸ†• Hamza a appris quelque chose de nouveau!\n\n` +
      `ðŸ“Œ Sujet: ${aiResult.learned_fact.topic}\n` +
      `â“ Q: ${aiResult.learned_fact.question_summary}\n` +
      `ðŸ’¬ A: ${aiResult.learned_fact.answer_summary}\n` +
      `ðŸ“Š Confiance: ${aiResult.confidence}\n` +
      `ðŸ†” ID: ${factId.substring(0, 8)}\n\n` +
      `RÃ©pondez:\n!approve ${factId.substring(0, 8)}\nou\n!correct ${factId.substring(0, 8)} [meilleure rÃ©ponse]`
    );
  }

  // â”€â”€ Admin alert for truly unknown questions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (aiResult.needs_admin) {
    await notifyAdmin(
      `âš ï¸ Hamza a besoin d'aide!\n\n` +
      `ðŸ‘¤ Client (${senderId}) a demandÃ©:\n"${text}"\n\n` +
      `ðŸ¤– Hamza a rÃ©pondu:\n"${aiResult.message}"\n\n` +
      `ðŸ‘† Utilisez !learn pour ajouter la bonne rÃ©ponse.`
    );
  }

  session.isNew = false;
}

// â”€â”€â”€ Handle quick reply button clicks (postbacks) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function handlePostback(senderId, postback) {
  const session = getSession(senderId);
  const lang    = session.language || 'dz';
  const payload = postback.payload;

  await sendTypingOn(senderId);

  const RESPONSES = {
    PRICE_ORDER: {
      fr: `Le Great-Ears G19S est à 14500 DA, livraison gratuite dans les 58 wilayas.`,
      dz: `السومة 14500 دج، والتوصيل مجاني لقاع الولايات.`,
    },
    DELIVERY: {
      fr: `Livraison gratuite dans les 58 wilayas. Le délai est généralement 24 à 48 heures.`,
      dz: `التوصيل مجاني لقاع الولايات. الكولي يوصلك في 24 حتى 48 ساعة.`,
    },
    EFFECTIVENESS: {
      fr: `L'audition est faible, moyenne, ou très faible?`,
      dz: `السمع ناقص شوية، متوسط، ولا ناقص بزاف؟`,
    },
    PRODUCT: {
      fr: `Great-Ears G19S est rechargeable, petit, discret, et se place dans l'oreille.`,
      dz: `جريت إيرز جي 19 إس قابلة للشحن، صغيرة، وتدخل داخل الودن ما تبانش بزاف.`,
    },
  };

  const responseSet = RESPONSES[payload];
  if (responseSet) {
    const msg = responseSet[lang] || responseSet['dz'];
    await delay(800);
    await sendTypingOff(senderId);
    await sendText(senderId, msg);
    addToHistory(session, 'assistant', msg);
  }
}

async function handleEchoMessage(customerId, message) {
  if (!customerId || !message?.is_echo || message.app_id) return;

  const text = (message.text || '').trim();
  if (!text) return;

  const session = getSession(customerId);
  addToHistory(session, 'assistant', text);
  session.humanContextUntil = Date.now() + HUMAN_CONTEXT_PAUSE_MS;
  console.log(`Human page reply added to context for ${customerId}`);
}

module.exports = { handleMessage, handlePostback, handleEchoMessage };

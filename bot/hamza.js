const {
  sendText,
  sendImage,
  sendCallButton,
  sendTypingOn,
  sendTypingOff,
  getUserProfile,
} = require('./messenger');
const axios                                   = require('axios');
const fs                                      = require('fs');
const path                                    = require('path');
const { generateResponse, transcribeAudio }   = require('./ai');
const { detectLanguage, getGreeting }         = require('./language');
const knowledge                               = require('./knowledge');
const { isAdmin, notifyAdmin, notifyAdminOrder, handleAdminCommand } = require('./admin');

// ─── In-memory user sessions ───────────────────────────────────────────────────
// Key: Messenger PSID | Value: { language, history, firstName, isNew, orderBuffer }
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      language:     null,
      history:      [],
      firstName:    null,
      isNew:        true,
      orderBuffer:  {},     // Accumulates order details as customer provides them
      messageCount: 0,
      bushraMode:   false,
      bushraLoveCount: 0,
    });
  }
  return sessions.get(userId);
}

function addToHistory(session, role, content) {
  session.history.push({ role, content, timestamp: Date.now() });
  if (session.history.length > 12) session.history.shift(); // Keep last 12 turns
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPhotoRequest(text) {
  return /(photo|image|picture|pic|صور|صورة|تصويرة|فوطو|فوتو|وريني|نشوفها|شوفني|شكلها)/i.test(text);
}

function isPhoneRequest(text) {
  return /(phone|number|call|tel|t[eé]l[eé]phone|num[eé]ro|appel|appeler|رقم|نمر[او]?|تليفون|هاتف|عيط|نتصل|اتصل|نكلم|كول)/i.test(text);
}

function hasAudioAttachment(message) {
  return (message.attachments || []).some((attachment) => attachment.type === 'audio');
}

function getAudioAttachment(message) {
  return (message.attachments || []).find((attachment) => attachment.type === 'audio');
}

function getPhoneHandoffMessage(lang) {
  return lang === 'fr'
    ? 'Vous pouvez m’appeler ici: +213563746369'
    : 'تقدر تعيطلي هنا: +213563746369';
}

async function sendPhoneHandoff(recipientId, lang) {
  const phone = '+213563746369';
  const text = getPhoneHandoffMessage(lang);
  const title = lang === 'fr' ? 'Appeler' : 'اتصل الآن';
  await sendCallButton(recipientId, text, phone, title);
}

async function transcribeMessengerAudio(message) {
  const audio = getAudioAttachment(message);
  const audioUrl = audio?.payload?.url;
  if (!audioUrl) return '';

  const res = await axios.get(audioUrl, {
    responseType: 'arraybuffer',
    timeout: 30000,
  });
  const mimeType = String(res.headers['content-type'] || 'audio/mpeg').split(';')[0];
  return transcribeAudio(Buffer.from(res.data), mimeType);
}

function isBushraTrigger(text) {
  const hasBushra = /bushra|bouchra|boushra|بشرى|بشرا|بوشرا/i.test(text);
  const asksWho = /من|who|qui|هو|هي|مين|ميش|c'est/i.test(text);
  const saysIam = /\b(i am|i'm|im|me|moi)\b/i.test(text) || /انا|أنا|راني|اني|أنايا|ana/i.test(text);
  return hasBushra && (asksWho || saysIam);
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

// ─── Handle incoming text messages ────────────────────────────────────────────
async function handleMessage(senderId, message) {
  const session = getSession(senderId);
  let text = (message.text || '').trim();

  if (!text && hasAudioAttachment(message)) {
    const lang = session.language || 'dz';
    await sendTypingOn(senderId);
    try {
      text = (await transcribeMessengerAudio(message)).trim();
    } catch (err) {
      console.error('Audio transcription failed:', err.message);
    }
    await sendTypingOff(senderId);

    if (!text) {
      const msg = getPhoneHandoffMessage(lang);
      await sendPhoneHandoff(senderId, lang);
      addToHistory(session, 'user', '[audio]');
      addToHistory(session, 'assistant', msg);
      return;
    }
  }

  if (!text) return;

  // ── Admin command handling ───────────────────────────────────────────
  if (isAdmin(senderId) && text.startsWith('!')) {
    await handleAdminCommand(senderId, text);
    return;
  }

  // ── 🥚 Easter egg: Yaseen ────────────────────────────────────────────
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

  // ── Easter egg: Bushra ───────────────────────────────────────────────
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
        : "الصورة ما راهيش مبرمجة دروك. نقدر نعطيك تفاصيل المنتج.";
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

  session.messageCount++;

  // ── Language detection ───────────────────────────────────────────────
  if (!session.language) {
    session.language = detectLanguage(text);
  } else {
    // Re-detect on each message — customer might switch language
    const detected = detectLanguage(text);
    if (detected !== session.language && text.split(' ').length > 2) {
      session.language = detected; // Respect language switch for multi-word messages
    }
  }

  // ── Fetch user's first name (once) ───────────────────────────────────
  if (!session.firstName) {
    const profile      = await getUserProfile(senderId);
    session.firstName  = profile.first_name || null;
  }

  // ── Update conversation history ──────────────────────────────────────
  addToHistory(session, 'user', text);

  // ── Show typing indicator ────────────────────────────────────────────
  await sendTypingOn(senderId);

  // ── Get current knowledge context ───────────────────────────────────
  const knowledgeContext = knowledge.getContext();

  // ── Generate AI response ─────────────────────────────────────────────
  const aiResult = await generateResponse(
    text,
    session.language,
    session.history,
    knowledgeContext
  );

  // ── Update detected language from AI ────────────────────────────────
  if (aiResult.detected_language) {
    session.language = aiResult.detected_language;
  }

  // ── Natural typing delay (feels human) ──────────────────────────────
  const thinkTime = Math.min(800 + text.length * 15, 3000);
  await delay(thinkTime);
  await sendTypingOff(senderId);

  // ── Send the response ────────────────────────────────────────────────
  if (aiResult.needs_admin || aiResult.confidence === 'low') {
    aiResult.message = getPhoneHandoffMessage(session.language || 'dz');
    await sendPhoneHandoff(senderId, session.language || 'dz');
  } else {
    await sendText(senderId, aiResult.message);
  }
  addToHistory(session, 'assistant', aiResult.message);

  // ── Handle order collection ──────────────────────────────────────────
  if (aiResult.order_info) {
    const o = aiResult.order_info;
    if (o.name)   session.orderBuffer.name   = o.name;
    if (o.phone)  session.orderBuffer.phone  = o.phone;
    if (o.wilaya) session.orderBuffer.wilaya = o.wilaya;

    const buf = session.orderBuffer;
    if (buf.name && buf.phone && buf.wilaya) {
      // Complete order — notify admin
      await notifyAdminOrder(buf, senderId);
      session.orderBuffer = {}; // Reset
      console.log(`📦 New order from ${senderId}:`, buf);
    }
  }

  // ── Self-learning: save new facts for admin review ───────────────────
  if (aiResult.learned_fact && aiResult.confidence !== 'high') {
    const factId = knowledge.savePendingFact({
      question:   aiResult.learned_fact.question_summary,
      answer:     aiResult.learned_fact.answer_summary,
      topic:      aiResult.learned_fact.topic,
      userId:     senderId,
      confidence: aiResult.confidence,
    });

    await notifyAdmin(
      `🆕 Hamza a appris quelque chose de nouveau!\n\n` +
      `📌 Sujet: ${aiResult.learned_fact.topic}\n` +
      `❓ Q: ${aiResult.learned_fact.question_summary}\n` +
      `💬 A: ${aiResult.learned_fact.answer_summary}\n` +
      `📊 Confiance: ${aiResult.confidence}\n` +
      `🆔 ID: ${factId.substring(0, 8)}\n\n` +
      `Répondez:\n!approve ${factId.substring(0, 8)}\nou\n!correct ${factId.substring(0, 8)} [meilleure réponse]`
    );
  }

  // ── Admin alert for truly unknown questions ───────────────────────────
  if (aiResult.needs_admin) {
    await notifyAdmin(
      `⚠️ Hamza a besoin d'aide!\n\n` +
      `👤 Client (${senderId}) a demandé:\n"${text}"\n\n` +
      `🤖 Hamza a répondu:\n"${aiResult.message}"\n\n` +
      `👆 Utilisez !learn pour ajouter la bonne réponse.`
    );
  }

  session.isNew = false;
}

// ─── Handle quick reply button clicks (postbacks) ────────────────────────────
async function handlePostback(senderId, postback) {
  const session = getSession(senderId);
  const lang    = session.language || 'dz';
  const payload = postback.payload;

  await sendTypingOn(senderId);

  const RESPONSES = {
    PRICE_ORDER: {
      fr: `Le Great-Ears G19S est à 14500 DA, livraison gratuite dans les 58 wilayas.\n\nPour commander, envoyez votre nom, numéro de téléphone et wilaya. Paiement à la livraison, délai 24-48h.`,
      dz: `السماعة جريت إيرز جي 19 إس بسومة 14500 دج. التوصيل مجاني لكل 58 ولاية.\n\nباش تطلب، ابعث الاسم، رقم الهاتف، والولاية. الدفع كي توصلك، والمدة 24-48 ساعة.`,
    },
    DELIVERY: {
      fr: `La livraison est gratuite dans les 58 wilayas. Le délai est généralement 24 à 48 heures après confirmation. Le paiement se fait à la livraison.`,
      dz: `التوصيل مجاني لكل 58 ولاية. المدة غالبا من 24 حتى 48 ساعة بعد التأكيد. الدفع يكون عند الاستلام.`,
    },
    EFFECTIVENESS: {
      fr: `La personne entend comment: bien, moyen, ou très faible?`,
      dz: `الشخص يسمع كيفاش: مليح، متوسط، ولا ناقص بزاف؟`,
    },
    PRODUCT: {
      fr: `Great-Ears G19S, appareil auditif rechargeable qui se place dans l'oreille.\n\nAutonomie environ 20h, charge environ 2h, réduction du bruit, son propre, couleurs bleu, rouge ou beige.`,
      dz: `جريت إيرز جي 19 إس سماعة قابلة للشحن تدخل داخل الودن.\n\nتخدم حوالي 20 ساعة، تشحن في حوالي 2 ساعات، فيها تقليل الضوضاء وصوت صافي، والألوان أزرق، أحمر، بيج.`,
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

module.exports = { handleMessage, handlePostback };

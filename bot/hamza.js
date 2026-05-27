const {
  sendText,
  sendTypingOn,
  sendTypingOff,
  sendQuickReplies,
  getUserProfile,
} = require('./messenger');
const { generateResponse }                    = require('./ai');
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

// ─── Handle incoming text messages ────────────────────────────────────────────
async function handleMessage(senderId, message) {
  const text = (message.text || '').trim();
  if (!text) return;

  // ── Admin command handling ───────────────────────────────────────────
  if (isAdmin(senderId) && text.startsWith('!')) {
    await handleAdminCommand(senderId, text);
    return;
  }

  const session = getSession(senderId);
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
    session.firstName  = profile.first_name || (session.language === 'fr' ? 'ami(e)' : 'صديقي');
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
  await sendText(senderId, aiResult.message);
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

  // ── First message: show quick reply menu ─────────────────────────────
  if (session.isNew && session.messageCount === 1) {
    session.isNew = false;
    await delay(1200);
    await sendTypingOn(senderId);
    await delay(600);
    await sendTypingOff(senderId);

    const lang = session.language;
    await sendQuickReplies(
      senderId,
      lang === 'fr'
        ? `Comment puis-je vous aider, ${session.firstName}? 😊`
        : `كيفاش نقدر نعاونك، ${session.firstName}؟ 😊`,
      [
        {
          title:   lang === 'fr' ? '💰 Prix & commande' : '💰 السعر والطلب',
          payload: 'PRICE_ORDER',
        },
        {
          title:   lang === 'fr' ? '🚚 Livraison' : '🚚 التوصيل',
          payload: 'DELIVERY',
        },
        {
          title:   lang === 'fr' ? '📊 Efficacité' : '📊 الفعالية',
          payload: 'EFFECTIVENESS',
        },
        {
          title:   lang === 'fr' ? '🎧 Le produit' : '🎧 المنتج',
          payload: 'PRODUCT',
        },
      ]
    );
  }
}

// ─── Handle quick reply button clicks (postbacks) ────────────────────────────
async function handlePostback(senderId, postback) {
  const session = getSession(senderId);
  const lang    = session.language || 'dz';
  const payload = postback.payload;

  await sendTypingOn(senderId);

  const RESPONSES = {
    PRICE_ORDER: {
      fr: `💰 Notre appareil auditif **Great-Ears G19S** est à **14 500 DA**, livraison gratuite incluse 🇩🇿\n\n🛒 Pour commander, dites-moi:\n1. Votre nom complet\n2. Votre numéro de téléphone\n3. Votre wilaya\n\nEt on s'occupe de tout en 24-48h! 🚀`,
      dz: `💰 السماعة الطبية **Great-Ears G19S** بـ**14,500 دج** شاملة التوصيل المجاني لكل الجزائر 🇩🇿\n\n🛒 باش تطلب، عطيني:\n1. اسمك الكامل\n2. رقم هاتفك\n3. ولايتك\n\nونحن نديرو كلشي في 24-48 ساعة! 🚀`,
    },
    DELIVERY: {
      fr: `🚚 Livraison **GRATUITE** dans les 58 wilayas d'Algérie 🇩🇿\n⏱️ Délai: **24 à 48 heures** après confirmation\n💳 Paiement à la livraison (pas de paiement en ligne)`,
      dz: `🚚 التوصيل **مجاني** لكل الـ58 ولاية في الجزائر 🇩🇿\n⏱️ المدة: **24 إلى 48 ساعة** بعد التأكيد\n💳 الدفع عند التوصيل (ماشي أونلاين)`,
    },
    EFFECTIVENESS: {
      fr: `📊 L'efficacité du **G19S** dépend de votre perte auditive:\n\n• Perte légère à modérée → **80 à 90%** d'amélioration\n• Perte sévère → **60 à 75%** d'amélioration\n\nDepuis combien de temps avez-vous des difficultés à entendre? Je peux vous donner une estimation plus précise 🎯`,
      dz: `📊 فاعلية السماعة **G19S** تتوقف على ضعف سمعك:\n\n• ضعف بسيط إلى متوسط → **80 إلى 90%** تحسن\n• ضعف شديد → **60 إلى 75%** تحسن\n\nمن وقتاش عندك مشكل في السمع؟ نقدر نعطيك نسبة أدق 🎯`,
    },
    PRODUCT: {
      fr: `🎧 **Great-Ears G19S** — CIC Rechargeable\n\n✨ Points forts:\n• Pratiquement **invisible** (1.9g, s'insère dans le canal auditif)\n• **20h** d'autonomie par charge\n• Chargeur **magnétique** (2h de charge)\n• **Réduction du bruit** intégrée\n• Certifié **CE, FDA, ISO13485**\n• Couleurs: Bleu, Rouge, Beige\n\nPrix: **14 500 DA** livraison gratuite 🇩🇿`,
      dz: `🎧 **Great-Ears G19S** — CIC قابلة للشحن\n\n✨ المميزات:\n• شبه **غير مرئية** (1.9 غرام، تدخل في قناة الأذن)\n• **20 ساعة** بشحنة واحدة\n• شحن **مغناطيسي** (ساعتين للشحن)\n• **تقليل الضوضاء** مدمج\n• معتمدة **CE, FDA, ISO13485**\n• الألوان: أزرق، أحمر، بيج\n\nالسعر: **14,500 دج** التوصيل مجاني 🇩🇿`,
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

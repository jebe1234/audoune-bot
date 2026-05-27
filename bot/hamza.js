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
        ? `Comment puis-je vous aider, ${session.firstName}?`
        : `كيفاش نقدر نعاونك، ${session.firstName}؟`,
      [
        {
          title:   lang === 'fr' ? 'Prix & commande' : 'السعر والطلب',
          payload: 'PRICE_ORDER',
        },
        {
          title:   lang === 'fr' ? 'Livraison' : 'التوصيل',
          payload: 'DELIVERY',
        },
        {
          title:   lang === 'fr' ? 'Efficacité' : 'الفعالية',
          payload: 'EFFECTIVENESS',
        },
        {
          title:   lang === 'fr' ? 'Le produit' : 'المنتج',
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
      fr: `Le Great-Ears G19S est à 14500 DA. Le prix est fixe, livraison gratuite dans les 58 wilayas.\n\nPour commander, envoyez votre nom complet, numéro de téléphone et wilaya. Paiement à la livraison, délai 24-48h.`,
      dz: `السماعة جريت إيرز جي 19 إس بسومة ثابتة: 14500 دج. التوصيل مجاني لكل 58 ولاية.\n\nباش تطلب، ابعث الاسم الكامل، رقم الهاتف، والولاية. الدفع كي توصلك، والمدة 24-48 ساعة.`,
    },
    DELIVERY: {
      fr: `La livraison est gratuite dans les 58 wilayas. Le délai est généralement 24 à 48 heures après confirmation. Le paiement se fait à la livraison.`,
      dz: `التوصيل مجاني لكل 58 ولاية. المدة غالبا من 24 حتى 48 ساعة بعد التأكيد. الدفع يكون عند الاستلام.`,
    },
    EFFECTIVENESS: {
      fr: `Le G19S aide surtout pour une perte auditive légère à modérée. Il amplifie les sons et peut rendre les conversations plus claires.\n\nDepuis quand avez-vous des difficultés à entendre?`,
      dz: `جي 19 إس تعاون خصوصا في النقص الخفيف ولا المتوسط في السمع. تكبر الصوت وتعاون الهدرة تبان أوضح.\n\nمن وقتاش عندك مشكل في السمع؟`,
    },
    PRODUCT: {
      fr: `Great-Ears G19S, appareil auditif rechargeable qui se place dans l'oreille.\n\nAutonomie environ 20h, charge environ 2h, réduction du bruit, couleurs bleu, rouge ou beige. Prix fixe: 14500 DA avec livraison gratuite.`,
      dz: `جريت إيرز جي 19 إس سماعة قابلة للشحن تدخل داخل الودن.\n\nتخدم حوالي 20 ساعة، تشحن في حوالي 2 ساعات، فيها تقليل الضوضاء، والألوان أزرق، أحمر، بيج. السومة ثابتة: 14500 دج والتوصيل مجاني.`,
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

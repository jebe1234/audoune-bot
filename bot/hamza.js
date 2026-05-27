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
        ? `Yaseen ? 😄 C'est tout simplement le meilleur homme sur terre, ya kho! 🏆👑`
        : `ياسين؟ 😄 هو أحسن راجل فالدنيا يا خو! 🏆👑`
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
      fr: `💰 Notre appareil auditif **Great-Ears G19S** est à **14500 DA**. Le prix est fixe, livraison gratuite incluse dans les 58 wilayas 🇩🇿\n\n🛒 Pour commander, dites-moi:\n1. Votre nom complet\n2. Votre numéro de téléphone\n3. Votre wilaya\n\nPaiement à la livraison seulement, délai 24-48h.`,
      dz: `💰 السماعة الطبية جريت إيرز جي 19 إس بسومة ثابتة: **14500 دج**، والتوصيل مجاني لكل 58 ولاية 🇩🇿\n\n🛒 باش تطلب، عطيني:\n1. اسمك الكامل\n2. رقم هاتفك\n3. ولايتك\n\nالدفع يكون كي توصلك فقط، والمدة 24-48 ساعة.`,
    },
    DELIVERY: {
      fr: `🚚 Livraison **GRATUITE** dans les 58 wilayas d'Algérie 🇩🇿\n⏱️ Délai: **24 à 48 heures** après confirmation\n💳 Paiement à la livraison (pas de paiement en ligne)`,
      dz: `🚚 التوصيل **مجاني** لكل الـ58 ولاية في الجزائر 🇩🇿\n⏱️ المدة: **24 إلى 48 ساعة** بعد التأكيد\n💳 الدفع عند التوصيل (ماشي أونلاين)`,
    },
    EFFECTIVENESS: {
      fr: `📊 Le G19S aide surtout les pertes auditives légères à modérées: il amplifie les sons et peut rendre les conversations plus claires.\n\nIl ne guérit pas la surdité. Si la perte est très forte, soudaine, ou avec douleur, mieux vaut consulter un spécialiste.\n\nDepuis quand avez-vous des difficultés à entendre?`,
      dz: `📊 سماعة جي 19 إس تعاون خصوصا في النقص الخفيف ولا المتوسط في السمع: تكبر الصوت وتعاون الهدرة تبان أوضح.\n\nماشي علاج للصمم. إذا النقص قوي بزاف، ولا جا فجأة، ولا كاين وجع في الودن، الأفضل طبيب مختص.\n\nمن وقتاش عندك مشكل في السمع؟`,
    },
    PRODUCT: {
      fr: `🎧 **Great-Ears G19S** — appareil auditif CIC rechargeable\n\n✨ Points forts:\n• Discret, se place dans le canal auditif\n• Environ **20h** d'autonomie par charge\n• Charge magnétique en environ **2h**\n• Réduction du bruit\n• Certifications: **CE, FDA, ISO13485**\n• Couleurs: Bleu, Rouge, Beige\n\nPrix fixe: **14500 DA**, livraison gratuite 🇩🇿`,
      dz: `🎧 جريت إيرز جي 19 إس — سماعة داخل الودن قابلة للشحن\n\n✨ المميزات:\n• صغيرة وما تبانش بزاف\n• حوالي **20 ساعة** بشحنة واحدة\n• شحن مغناطيسي في حوالي **2 ساعات**\n• فيها تقليل الضوضاء\n• عندها شهادات: سي إي، إف دي إي، إيزو 13485\n• الألوان: أزرق، أحمر، بيج\n\nالسومة ثابتة: **14500 دج**، والتوصيل مجاني 🇩🇿`,
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

const { sendText }        = require('./messenger');
const knowledge            = require('./knowledge');

const ADMIN_PSID = process.env.ADMIN_PSID;

// ─── Check if sender is admin ──────────────────────────────────────────────────
function isAdmin(senderId) {
  return ADMIN_PSID && senderId === ADMIN_PSID;
}

// ─── Notify admin via Messenger ────────────────────────────────────────────────
async function notifyAdmin(message) {
  if (!ADMIN_PSID) {
    console.log('[Admin notification skipped — ADMIN_PSID not set]');
    return;
  }
  try {
    await sendText(ADMIN_PSID, message);
  } catch (err) {
    console.error('Failed to notify admin:', err.message);
  }
}

// ─── Notify admin about a completed order ─────────────────────────────────────
async function notifyAdminOrder(orderInfo, userId) {
  await notifyAdmin(
    `🛒 طلب جديد! / NOUVELLE COMMANDE!\n\n` +
    `👤 Client: ${orderInfo.name}\n` +
    `📞 Tel: ${orderInfo.phone}\n` +
    `📍 Wilaya: ${orderInfo.wilaya}\n` +
    (orderInfo.address ? `🏠 Adresse: ${orderInfo.address}\n` : '') +
    `🆔 Messenger ID: ${userId}\n\n` +
    `✅ Confirmez et préparez la livraison!`
  );
}

// ─── Handle admin commands ─────────────────────────────────────────────────────
async function handleAdminCommand(senderId, text) {
  const trimmed = text.trim();

  // !help
  if (trimmed === '!help') {
    await sendText(senderId,
      `🤖 Commandes Admin de Hamza:\n\n` +
      `📋 !pending — Voir les faits en attente\n` +
      `✅ !approve [id] — Approuver un fait\n` +
      `✏️  !correct [id] [réponse] — Corriger et approuver\n` +
      `📝 !learn [Q] = [A] — Enseigner un fait manuellement\n` +
      `🔐 I'm the admin — Activer le mode apprentissage naturel\n` +
      `❓ !help — Afficher cette aide\n\n` +
      `Exemple: !learn Garantie = 6 mois de garantie constructeur\n` +
      `En mode admin: learn maximum = réponse`
    );
    return;
  }

  // !pending / !list
  if (trimmed === '!pending' || trimmed === '!list') {
    const pending = knowledge.getPendingFacts();
    if (pending.length === 0) {
      await sendText(senderId, '✅ Aucun fait en attente. Hamza tourne bien!');
      return;
    }
    await sendText(senderId, `📋 ${pending.length} fait(s) en attente de révision:`);
    for (const fact of pending.slice(0, 5)) {
      const shortId = fact.id.substring(0, 8);
      await sendText(senderId,
        `━━━━━━━━━━━━━━━━\n` +
        `🆔 ID: ${shortId}\n` +
        `❓ Q: ${fact.question_summary}\n` +
        `💬 A: ${fact.answer}\n` +
        `📊 Confiance: ${fact.confidence}\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `→ !approve ${shortId}\n` +
        `→ !correct ${shortId} [meilleure réponse]`
      );
    }
    return;
  }

  // !approve [id]
  if (trimmed.startsWith('!approve ')) {
    const id      = trimmed.replace('!approve ', '').trim();
    const success = knowledge.approveFact(id);
    await sendText(senderId,
      success
        ? `✅ Fait [${id}] approuvé! Hamza l'utilisera désormais avec confiance.`
        : `❌ Fait [${id}] non trouvé. Vérifiez l'ID avec !pending`
    );
    return;
  }

  // !correct [id] [new answer]
  if (trimmed.startsWith('!correct ')) {
    const rest   = trimmed.replace('!correct ', '');
    const parts  = rest.split(' ');
    const id     = parts[0];
    const answer = parts.slice(1).join(' ');
    if (!answer) {
      await sendText(senderId, '❌ Usage: !correct [id] [nouvelle réponse]');
      return;
    }
    const success = knowledge.correctFact(id, answer);
    await sendText(senderId,
      success
        ? `✅ Fait [${id}] corrigé et approuvé!\nNouvelle réponse: "${answer}"`
        : `❌ Fait [${id}] non trouvé.`
    );
    return;
  }

  // !learn [question] = [answer]
  if (trimmed.startsWith('!learn ')) {
    const content = trimmed.replace('!learn ', '');
    const parts   = content.split('=');
    if (parts.length < 2) {
      await sendText(senderId, '❌ Usage: !learn [question] = [réponse]');
      return;
    }
    const question = parts[0].trim();
    const answer   = parts.slice(1).join('=').trim();
    const id       = knowledge.addAdminFact(question, answer, answer);
    await sendText(senderId,
      `✅ Hamza a appris:\n❓ Q: ${question}\n💬 A: ${answer}\n🆔 ID: ${id.substring(0, 8)}`
    );
    return;
  }

  // Unknown command
  await sendText(senderId, '❓ Commande inconnue. Tapez !help pour voir les commandes disponibles.');
}

module.exports = { isAdmin, notifyAdmin, notifyAdminOrder, handleAdminCommand };

/**
 * Language detection for Algerian Darija, French, and Arabic (MSA).
 * Uses character-set analysis + keyword scoring for accuracy.
 */

// Darija-specific words that appear often in Algerian chat
const DARIJA_MARKERS = [
  'واش', 'كيفاش', 'بزاف', 'راه', 'ولا', 'آه', 'نتا', 'نتي', 'كي',
  'بلا', 'ماشي', 'حتى', 'باه', 'غير', 'كيما', 'دير', 'قول', 'بغيت',
  'نبغي', 'وين', 'كاين', 'هنا', 'دروك', 'مليح', 'شنو',
  'علاه', 'لازم', 'ما عندوش', 'راني', 'راهو', 'حبيت', 'وقيلاه',
  'شحال', 'فلوس', 'شري', 'بصح', 'تاع', 'حاجة', 'ولاية',
];

// Common French words that signal French language
const FRENCH_MARKERS = [
  'bonjour', 'bonsoir', 'merci', 'je', 'vous', 'tu', 'est', 'ce',
  'que', 'qui', 'comment', 'combien', 'où', 'quand', 'pourquoi',
  'le', 'la', 'les', 'un', 'une', 'des', 'et', 'ou', 'mais', 'donc',
  'livraison', 'prix', 'appareil', 'audition', 'entendre', 'oreille',
  'suis', 'ai', 'avoir', 'être', 'faire', 'veux', 'vouloir', 'aller',
  'oui', 'non', 'aussi', 'très', 'bien', 'sil', 'plaît', 'efficacité',
  'efficace', 'gratuit', 'gratuite', 'wilaya', 'livrer', 'commander',
];

/**
 * Detect language from a message string.
 * Returns: 'fr' | 'dz' | 'ar'
 */
function detectLanguage(text) {
  if (!text || text.trim().length === 0) return 'dz';

  const lower = text.toLowerCase().trim();
  const words = lower.split(/\s+/);
  const totalChars = text.replace(/\s/g, '').length;

  // ── Count Arabic Unicode characters ──────────────────────────────────
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars  = (text.match(/[a-zA-Zàâäéèêëîïôùûüç]/g) || []).length;
  const arabicRatio = totalChars > 0 ? arabicChars / totalChars : 0;
  const latinRatio  = totalChars > 0 ? latinChars  / totalChars : 0;

  // ── Score French words ────────────────────────────────────────────────
  let frScore = 0;
  for (const word of words) {
    // Strip punctuation from word edges
    const clean = word.replace(/[^a-zA-Zàâäéèêëîïôùûüç]/g, '');
    if (FRENCH_MARKERS.includes(clean)) frScore++;
  }

  // ── Score Darija words ────────────────────────────────────────────────
  let dzScore = 0;
  for (const marker of DARIJA_MARKERS) {
    if (text.includes(marker)) dzScore++;
  }

  // ── Decision logic ────────────────────────────────────────────────────

  // Mostly Arabic script → Darija (default for Algeria)
  if (arabicRatio > 0.4) {
    return 'dz'; // Could be MSA or Darija — treat as Darija for Algeria
  }

  // Strong French signal
  if (frScore >= 1 || latinRatio > 0.7) {
    return 'fr';
  }

  // Mixed or short messages → default to Darija
  return 'dz';
}

/**
 * Return a greeting based on time of day and language.
 */
function getGreeting(lang) {
  const hour = new Date().getHours();
  if (lang === 'fr') {
    if (hour < 12) return 'Bonjour';
    if (hour < 18) return 'Bon après-midi';
    return 'Bonsoir';
  }
  if (hour < 12) return 'صباح الخير';
  if (hour < 18) return 'مساء الخير';
  return 'مساء النور';
}

module.exports = { detectLanguage, getGreeting };

import { normalizeAnalysis } from './schema.js';

/**
 * Deterministic, offline provider. Used when no AI credential is configured
 * and as a fallback when the AI call fails, so the API always answers.
 */

const INTENT_KEYWORDS = [
  ['withdrawal_issue', ['withdraw', 'payout', 'cash out', 'cashout', 'money back', 'refund', 'pending transfer']],
  ['deposit_issue', ['deposit', 'top up', 'top-up', 'add funds', 'payment failed', 'card declined', 'not credited']],
  ['account_access', ['login', 'log in', 'sign in', 'password', 'locked', 'blocked', 'verify', 'verification', 'kyc', 'access my account', '2fa', 'otp']],
  ['bonus_query', ['bonus', 'promo', 'promotion', 'free spin', 'reward', 'cashback', 'voucher', 'coupon']],
];

const NEGATIVE = ['not', 'never', 'nobody', 'no one', 'still', 'waiting', 'pending', 'angry', 'frustrated', 'terrible', 'worst', 'unacceptable', 'scam', 'bad', 'useless', 'disappointed', 'complaint', 'broken', 'hate', 'crash'];
const POSITIVE = ['thank', 'thanks', 'great', 'love', 'awesome', 'perfect', 'appreciate', 'excellent', 'good', 'resolved', 'works'];
const URGENT = ['urgent', 'asap', 'immediately', 'right now', 'critical', 'emergency', 'locked out', 'cannot access', "can't access", 'hours', 'days'];

const RESPONSES = {
  withdrawal_issue: 'We understand your concern. Let us check your withdrawal status and update you as soon as possible.',
  deposit_issue: 'Sorry for the trouble with your deposit. We are checking the transaction and will confirm once the funds are credited.',
  account_access: 'We can help you regain access to your account. Please confirm the email registered on the account so we can verify you.',
  bonus_query: 'Happy to help with your bonus question. Could you tell us which promotion you are referring to?',
  other: 'Thank you for reaching out. Could you share a few more details so we can assist you properly?',
};

const SCRIPT_LANGUAGES = [
  [/[ऀ-ॿ]/, 'Hindi'],
  [/[؀-ۿ]/, 'Arabic'],
  [/[Ѐ-ӿ]/, 'Russian'],
  [/[一-鿿]/, 'Chinese'],
  [/[぀-ヿ]/, 'Japanese'],
  [/[가-힯]/, 'Korean'],
];
const STOPWORDS = [
  ['Spanish', ['el', 'la', 'de', 'que', 'mi', 'por', 'no', 'está', 'quiero', 'dinero']],
  ['French', ['le', 'la', 'les', 'je', 'mon', 'pas', 'est', 'avec', 'argent', 'retrait']],
  ['German', ['ich', 'nicht', 'und', 'das', 'mein', 'ist', 'auszahlung', 'konto']],
  ['Portuguese', ['não', 'meu', 'está', 'com', 'para', 'dinheiro', 'saque']],
];

export function detectLanguage(message) {
  for (const [re, lang] of SCRIPT_LANGUAGES) if (re.test(message)) return lang;
  const words = message.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  let best = ['English', 1];
  for (const [lang, list] of STOPWORDS) {
    const hits = words.filter((w) => list.includes(w)).length;
    if (hits > best[1]) best = [lang, hits];
  }
  return best[0];
}

function classifyIntent(text) {
  for (const [intent, words] of INTENT_KEYWORDS) {
    if (words.some((w) => text.includes(w))) return intent;
  }
  return 'other';
}

const bump = (p) => (p === 'low' ? 'medium' : 'high');

export function createRuleProvider() {
  return {
    name: 'rules',
    async analyze({ message, history = [] }) {
      const text = message.toLowerCase();
      const intent = classifyIntent(text);

      const neg = NEGATIVE.filter((w) => text.includes(w)).length;
      const pos = POSITIVE.filter((w) => text.includes(w)).length;
      const sentiment = neg > pos ? 'negative' : pos > neg ? 'positive' : 'neutral';

      let priority = 'low';
      if (intent !== 'other' || sentiment === 'negative') priority = 'medium';
      if (URGENT.some((w) => text.includes(w)) || (sentiment === 'negative' && ['withdrawal_issue', 'account_access'].includes(intent))) priority = 'high';

      // Conversation context: a repeat contact about the same unresolved issue
      // is escalated and acknowledged.
      const repeated = history.some((e) => e.analysis?.intent === intent && intent !== 'other');
      let response = RESPONSES[intent];
      if (repeated) {
        priority = bump(priority);
        response = `We see you have already contacted us about this and we are sorry it is still unresolved. ${response}`;
      }

      return normalizeAnalysis({ intent, sentiment, priority, language: detectLanguage(message), response });
    },
  };
}

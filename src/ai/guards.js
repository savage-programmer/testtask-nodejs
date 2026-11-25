/**
 * Safety guards applied around every provider.
 *
 * - Input: detect prompt-injection attempts so they can be flagged. The message
 *   is still analysed (it is a real customer message) but never acted upon.
 * - Output: the model must never claim to have approved, processed or executed
 *   anything. Such claims are replaced with a safe, non-committal response.
 */

const INJECTION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above|earlier) (instructions|prompts|rules)/i,
  /disregard (all |any )?(previous|prior|above) (instructions|rules)/i,
  /you are now (a|an|the) /i,
  /\bsystem prompt\b/i,
  /\b(as|act as) (an? )?(admin|administrator|developer|system|supervisor)\b/i,
  /\bapprove (my|the|this) (withdrawal|deposit|payout|refund|transaction|request)\b/i,
  /\b(override|bypass) (the )?(security|verification|checks?|limits?)\b/i,
];

export function detectInjection(message) {
  return INJECTION_PATTERNS.some((re) => re.test(message));
}

// Claims of completed or promised actions the assistant is not allowed to make.
const ACTION_CLAIM_PATTERNS = [
  /\b(is|has been|have been|was|were|got|been)\s+(approved|processed|refunded|released|completed|unlocked|credited|reversed|transferred)\b/i,
  /\b(i|we)\s+(have|'ve|just|already)?\s*(approved|processed|refunded|released|unlocked|credited|transferred|reversed|sent)\b/i,
  /\b(approving|processing|refunding|releasing) (your|the) (withdrawal|deposit|refund|payout|transaction|account) now\b/i,
  /\byour (withdrawal|deposit|refund|payout|transaction|money|funds) (is|are|will be) (approved|on (its|their) way|released)\b/i,
];

export const SAFE_CLAIM_RESPONSE =
  'We understand your concern. We cannot approve or process transactions through this chat; a member of our team will review your account and update you.';

/** Returns { response, scrubbed } where scrubbed=true means an unsafe claim was replaced. */
export function scrubActionClaims(response) {
  if (ACTION_CLAIM_PATTERNS.some((re) => re.test(response))) {
    return { response: SAFE_CLAIM_RESPONSE, scrubbed: true };
  }
  return { response, scrubbed: false };
}

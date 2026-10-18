/**
 * Leak check: does any real value appear in text that went to the model?
 * Looks for every surface form we can think of, not just the canonical value.
 */
import { renderAmount, renderDate } from './render.js';
import { allForms } from './ru-names.js';
import type { Customer, Lang } from './types.js';
import type { Vault } from './vault.js';

export function forbiddenStrings(customer: Customer, vault: Vault): string[] {
  const out = new Set<string>();
  for (const lang of ['ru', 'he', 'en'] as Lang[]) {
    for (const part of [customer.firstName[lang], customer.lastName[lang]]) {
      if (!part) continue;
      for (const f of lang === 'ru' ? allForms(part, customer.gender) : [part]) out.add(f);
    }
  }
  out.add(customer.nationalId);
  for (const e of customer.emails) out.add(e.toLowerCase());
  for (const p of customer.phones) out.add(p.replace(/\D/g, '').slice(-7));
  for (const { kind, value } of vault.values()) {
    if (kind === 'DATE') {
      out.add(value);
      for (const lang of ['ru', 'he', 'en'] as Lang[]) out.add(renderDate(value, lang).replace(/ \d{4}$/, ''));
    } else if (kind === 'AMOUNT') {
      for (const lang of ['ru', 'he', 'en'] as Lang[]) out.add(renderAmount(value, lang));
    } else if (kind === 'CARD' || kind === 'NATIONAL_ID') out.add(value);
    else if (kind === 'PHONE') out.add(value.replace(/\D/g, '').slice(-7));
    else if (kind === 'EMAIL') out.add(value);
  }
  return [...out].filter((s) => s.length >= 2);
}

/** Returns the forbidden strings found in the payload (case-insensitive, word-bounded). */
export function findLeaks(payload: string, forbidden: string[]): string[] {
  // JSON escapes non-ASCII only if asked to; unescape \\uXXXX defensively anyway.
  const text = payload.replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).toLowerCase();
  const digitsOnly = text.replace(/[\s-]/g, '');
  return forbidden.filter((f) => {
    const needle = f.toLowerCase();
    if (/^\d+$/.test(needle)) return new RegExp(`(?<!\\d)${needle}(?!\\d)`).test(digitsOnly);
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Hebrew words take one-letter prefixes (לדוד = "to David"): a leak check that only
    // looks for whole words would be blind exactly where masking is weakest.
    const prefix = /[֐-׿]/.test(needle) ? '[ושהבכלמ]{0,2}' : '';
    return new RegExp(`(?<![\\p{L}])${prefix}${escaped}(?![\\p{L}])`, 'u').test(text);
  });
}

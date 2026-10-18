/**
 * Minimal declension of Russian first names and surnames — enough for a support reply.
 * Not a morphology engine: it covers the common patterns and leaves the rest unchanged.
 *
 *   Давид, Коэн, Игорь, Андрей      masculine, decline (Давиду, Коэну, Игорю, Андрею)
 *   Иванов, Ильин                   masculine -ов/-ин: instrumental -ым (Ивановым)
 *   Анна, Мария, Маша, Миша         -а/-я: decline for any gender
 *   Иванова, Ильина                 feminine -ова/-ина: adjectival endings (Ивановой)
 *   Моше, Шломо, Ави, Коэн (f)      indeclinable: vowel endings other than -а/-я,
 *                                   and feminine names ending in a consonant
 */
import type { Case, Gender } from './types.js';

const CASES: Case[] = ['nom', 'gen', 'dat', 'acc', 'ins', 'prep'];
const VOWEL_INDECLINABLE = /[оеёиуыэю]$/i;
const SIBILANT_OR_VELAR = /[гкхжшчщ]$/i;

export function inflect(word: string, grammaticalCase: Case, gender: Gender): string {
  if (grammaticalCase === 'nom' || !/[а-яё]$/i.test(word)) return word;
  if (VOWEL_INDECLINABLE.test(word)) return word;

  // Feminine -ова/-ева/-ина/-ына surnames decline like adjectives.
  if (gender === 'f' && /(ов|ев|ин|ын)а$/i.test(word)) {
    const stem = word.slice(0, -1);
    return grammaticalCase === 'acc' ? `${stem}у` : `${stem}ой`;
  }

  if (/ия$/i.test(word)) {
    const stem = word.slice(0, -1); // Мари-
    return { gen: `${stem}и`, dat: `${stem}и`, acc: `${stem}ю`, ins: `${stem}ей`, prep: `${stem}и` }[grammaticalCase];
  }
  if (/а$/i.test(word)) {
    const stem = word.slice(0, -1);
    const gen = SIBILANT_OR_VELAR.test(stem) ? `${stem}и` : `${stem}ы`;
    return { gen, dat: `${stem}е`, acc: `${stem}у`, ins: `${stem}ой`, prep: `${stem}е` }[grammaticalCase];
  }
  if (/я$/i.test(word)) {
    const stem = word.slice(0, -1);
    return { gen: `${stem}и`, dat: `${stem}е`, acc: `${stem}ю`, ins: `${stem}ей`, prep: `${stem}е` }[grammaticalCase];
  }

  if (gender === 'f') return word; // Рахель Коэн: feminine consonant endings do not decline.

  if (/[ьй]$/i.test(word)) {
    const stem = word.slice(0, -1);
    return { gen: `${stem}я`, dat: `${stem}ю`, acc: `${stem}я`, ins: `${stem}ем`, prep: `${stem}е` }[grammaticalCase];
  }
  const ins = /(ов|ев|ин|ын)$/i.test(word) ? `${word}ым` : `${word}ом`;
  return { gen: `${word}а`, dat: `${word}у`, acc: `${word}а`, ins, prep: `${word}е` }[grammaticalCase];
}

/** Every case form of a word, for finding the name in text the customer wrote. */
export function allForms(word: string, gender: Gender): string[] {
  return [...new Set(CASES.map((c) => inflect(word, c, gender)))];
}

/**
 * A suffix the model glued to a token ("<CUSTOMER_FIRST_NAME>у") -> the case it most likely meant.
 * Ambiguous by nature: "-а" is genitive or accusative, "-е" dative or prepositional.
 */
export function caseFromGluedSuffix(suffix: string): Case | undefined {
  return ({ а: 'gen', я: 'gen', у: 'dat', ю: 'dat', ом: 'ins', ем: 'ins', ым: 'ins', ой: 'ins', е: 'prep', ы: 'gen', и: 'gen' } as Record<string, Case>)[
    suffix.toLowerCase()
  ];
}

export function isCase(value: string): value is Case {
  return (CASES as string[]).includes(value);
}

/**
 * Replace personal data in a support ticket with tokens before it reaches the model.
 *
 * Two sources, in this order:
 * 1. The customer record. In support we know who wrote the ticket, so their name
 *    (in every script and Russian case form, with Hebrew prefixes), ID number and
 *    e-mails are found by exact match, not guessed. Cards and phones are NOT matched
 *    from the record: a bare 4-digit card ending would also hit years and amounts,
 *    so they are left to the patterns below (see test/known-gaps.test.ts).
 * 2. Pattern detectors for what the record cannot list: dates, amounts, any valid
 *    Israeli ID number, phones, e-mails, card endings written after a card keyword.
 *
 * Known gap, on purpose: names of OTHER people are not detected. That needs a
 * named-entity model with its own error rate; see test/known-gaps.test.ts.
 */
import { allForms } from './ru-names.js';
import type { Customer, Kind, Lang } from './types.js';
import type { Vault } from './vault.js';

export interface Span {
  start: number;
  end: number;
  kind: Kind;
  value: string;
}

const L = '\\p{L}';
const N = '\\p{N}';
const HE_PREFIX = '[ושהבכלמ]{0,2}';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const EN_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const enMonthRe = EN_MONTHS.map((m) => `${m.slice(0, 3)}(?:${m.slice(3)})?\\.?`).join('|');

/** Israeli ID check digit (Luhn variant over 9 digits). */
export function isValidIsraeliId(id: string): boolean {
  if (!/^\d{5,9}$/.test(id)) return false;
  const digits = id.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(digits[i]) * ((i % 2) + 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}

function iso(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1) return undefined;
  return d.toISOString().slice(0, 10);
}

const fullYear = (y: string | undefined, fallback: number) =>
  y === undefined ? fallback : y.length === 2 ? 2000 + Number(y) : Number(y);

export function parseAmount(raw: string): number {
  let s = raw.replace(/[\s  ]/g, '');
  if (/,\d{3}(?!\d)/.test(s) && !/\.\d{3}/.test(s)) s = s.replace(/,(?=\d{3}(?!\d))/g, ''); // 1,250 -> 1250
  s = s.replace(',', '.');
  return Number(s);
}

/** Every pattern returns spans; the caller resolves overlaps (earlier rule wins, then longer). */
type Rule = (text: string, customer: Customer, year: number) => Span[];

function matchAll(text: string, re: RegExp, fn: (m: RegExpExecArray) => Span | undefined): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(re)) {
    const span = fn(m as RegExpExecArray);
    if (span) out.push(span);
  }
  return out;
}

/** Span for capture group `g` of a match made with the `d` flag. */
function groupSpan(m: RegExpExecArray, g: number, kind: Kind, value: string): Span | undefined {
  const idx = m.indices?.[g];
  return idx ? { start: idx[0], end: idx[1], kind, value } : undefined;
}

function nameForms(customer: Customer, part: 'firstName' | 'lastName', lang: Lang): string[] {
  const name = customer[part][lang];
  if (!name) return [];
  return lang === 'ru' ? allForms(name, customer.gender, part === 'firstName' ? 'first' : 'last') : [name];
}

function nameRe(lang: Lang, alternatives: string[]): RegExp {
  const alt = alternatives.sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  // Hebrew: one-letter prefixes (ל, ב, ו, ש, ה, מ, כ) attach to the word; keep them outside the token.
  const prefix = lang === 'he' ? `(${HE_PREFIX})` : '()';
  return new RegExp(`(?<![${L}])${prefix}(${alt})(?![${L}])`, 'giud');
}

const customerNames: Rule = (text, customer) => {
  const spans: Span[] = [];
  for (const lang of ['ru', 'he', 'en'] as Lang[]) {
    const first = nameForms(customer, 'firstName', lang);
    const last = nameForms(customer, 'lastName', lang);
    const full: string[] = [];
    for (const f of first) for (const l of last) full.push(`${f} ${l}`, `${l} ${f}`);
    const passes: [string[], Kind][] = [
      [full, 'CUSTOMER_FULL_NAME'],
      [last, 'CUSTOMER_LAST_NAME'],
      [first, 'CUSTOMER_FIRST_NAME'],
    ];
    for (const [forms, kind] of passes) {
      if (forms.length === 0) continue;
      spans.push(...matchAll(text, nameRe(lang, forms), (m) => groupSpan(m, 2, kind, customer.id)));
    }
  }
  return spans;
};

const customerKnownNumbers: Rule = (text, customer) => {
  const spans: Span[] = [];
  const exact = (value: string, kind: Kind, canonical = value) =>
    spans.push(
      ...matchAll(text, new RegExp(`(?<![${N}])(${escapeRe(value)})(?![${N}])`, 'gud'), (m) => groupSpan(m, 1, kind, canonical)),
    );
  exact(customer.nationalId, 'NATIONAL_ID');
  for (const e of customer.emails) exact(e, 'EMAIL', e.toLowerCase());
  return spans;
};

const nationalIds: Rule = (text) =>
  matchAll(text, new RegExp(`(?<![${N}])(\\d{9})(?![${N}])`, 'gud'), (m) =>
    isValidIsraeliId(m[1]) ? groupSpan(m, 1, 'NATIONAL_ID', m[1]) : undefined,
  );

const emails: Rule = (text) =>
  matchAll(text, /([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/gud, (m) => groupSpan(m, 1, 'EMAIL', m[1].toLowerCase()));

const phones: Rule = (text) =>
  matchAll(
    text,
    new RegExp(`(?<![${N}+])((?:\\+972[\\s-]?|0)(?:5\\d|7\\d|[2-489])[\\s-]?\\d{3}[\\s-]?\\d{4})(?![${N}])`, 'gud'),
    (m) => {
      const digits = m[1].replace(/\D/g, '');
      return groupSpan(m, 1, 'PHONE', digits.startsWith('972') ? `+${digits}` : `+972${digits.slice(1)}`);
    },
  );

const CARD_CUE = String.raw`(?:(?:[*•xX]|\.){2,}\s?|(?:карт[а-яё]*|כרטיס|card)(?:\s+(?:ending\s+in|ending|№|номер|מס['׳]?|שמסתיים\s+ב-?|заканчивающ[а-яё]*\s+на))?[\s:№#-]*(?:[*•]+|\.{2,})?\s?)`;
const cards: Rule = (text) =>
  matchAll(text, new RegExp(`${CARD_CUE}(\\d{4})(?![${N}])`, 'giud'), (m) => groupSpan(m, 1, 'CARD', m[1]));

const NUM = String.raw`\d{1,3}(?:[   ,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const CUR = String.raw`₪|ש["״']?ח|шек(?:ел(?:ей|я|ь|ями|ях)?)?\.?|NIS|ILS|shekels?`;
const amounts: Rule = (text) => [
  ...matchAll(text, new RegExp(`(?<![${N}])(${NUM})\\s?(?:${CUR})`, 'giud'), (m) => {
    const idx = m.indices![0]!;
    return { start: idx[0], end: idx[1], kind: 'AMOUNT', value: String(parseAmount(m[1])) };
  }),
  ...matchAll(text, new RegExp(`(?:${CUR})\\s?(${NUM})(?![${N}])`, 'giud'), (m) => {
    const idx = m.indices![0]!;
    return { start: idx[0], end: idx[1], kind: 'AMOUNT', value: String(parseAmount(m[1])) };
  }),
];

const dates: Rule = (text, _c, year) => {
  const span = (m: RegExpExecArray, value: string | undefined): Span | undefined =>
    value ? { start: m.index, end: m.index + m[0].length, kind: 'DATE', value } : undefined;
  return [
    ...matchAll(text, /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/gu, (m) => span(m, iso(+m[1], +m[2], +m[3]))),
    ...matchAll(text, /(?<![\d.,])(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?(?![\d.,]\d)/gu, (m) =>
      span(m, iso(fullYear(m[3], year), +m[2], +m[1])),
    ),
    ...matchAll(text, new RegExp(`(?<!\\d)(\\d{1,2})\\s+(${RU_MONTHS.join('|')})(?:\\s+(\\d{4}))?(?:\\s*г\\.?)?`, 'giu'), (m) =>
      span(m, iso(fullYear(m[3], year), RU_MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1])),
    ),
    ...matchAll(text, new RegExp(`(?<!\\d)(\\d{1,2})\\s+(?:ב-?|ל-?)?(${HE_MONTHS.join('|')})(?:\\s+(\\d{4}))?`, 'gu'), (m) =>
      span(m, iso(fullYear(m[3], year), HE_MONTHS.indexOf(m[2]) + 1, +m[1])),
    ),
    ...matchAll(text, new RegExp(`(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?\\s+(${enMonthRe})(?:,?\\s+(\\d{4}))?`, 'giu'), (m) =>
      span(m, iso(fullYear(m[3], year), EN_MONTHS.findIndex((x) => x.startsWith(m[2].slice(0, 3).toLowerCase())) + 1, +m[1])),
    ),
    ...matchAll(text, new RegExp(`(?<![${L}])(${enMonthRe})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, 'giu'), (m) =>
      span(m, iso(fullYear(m[3], year), EN_MONTHS.findIndex((x) => x.startsWith(m[1].slice(0, 3).toLowerCase())) + 1, +m[2])),
    ),
  ];
};

/**
 * Order = priority when spans overlap. E-mails come first: a name inside an address
 * ("moshe.cohen@...") must not split it, or the rest of the address would leak.
 */
export const RULES: Rule[] = [emails, customerKnownNumbers, customerNames, phones, nationalIds, cards, amounts, dates];

export function findSpans(text: string, customer: Customer, year: number, rules: Rule[] = RULES): Span[] {
  const all = rules.flatMap((rule, priority) => rule(text, customer, year).map((s) => ({ ...s, priority })));
  // Greedy: higher priority first, then longer; accept a span only if it overlaps nothing accepted.
  all.sort((a, b) => a.priority - b.priority || b.end - b.start - (a.end - a.start) || a.start - b.start);
  const chosen: Span[] = [];
  for (const s of all) {
    if (!chosen.some((c) => s.start < c.end && c.start < s.end)) chosen.push(s);
  }
  return chosen.sort((a, b) => a.start - b.start).map(({ start, end, kind, value }) => ({ start, end, kind, value }));
}

export function mask(text: string, customer: Customer, vault: Vault, year: number, rules?: Rule[]): string {
  const spans = findSpans(text, customer, year, rules);
  let out = '';
  let pos = 0;
  for (const s of spans) {
    out += text.slice(pos, s.start) + vault.token(s.kind, s.value);
    pos = s.end;
  }
  return out + text.slice(pos);
}

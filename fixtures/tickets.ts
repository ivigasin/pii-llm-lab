/**
 * Invented customers and tickets. All names, ID numbers (valid check digit), cards,
 * phones and e-mails are fictional. Each ticket complains about a duplicate charge,
 * so the expected outcome is exactly one refund proposal.
 */
import type { Charge, Customer, Ticket } from '../src/types.js';

export const customers: Customer[] = [
  {
    id: 'c_david',
    gender: 'm',
    firstName: { ru: 'Давид', he: 'דוד', en: 'David' },
    lastName: { ru: 'Коэн', he: 'כהן', en: 'Cohen' },
    nationalId: '123456782',
    cards: ['4417'],
    phones: ['052-123-4567'],
    emails: ['david.cohen@example.com'],
  },
  {
    id: 'c_moshe',
    gender: 'm',
    firstName: { ru: 'Моше', he: 'משה', en: 'Moshe' },
    lastName: { ru: 'Леви', he: 'לוי', en: 'Levi' },
    nationalId: '000000018',
    cards: ['9031'],
    phones: ['054-765-4321'],
    emails: ['moshe.levi@example.com'],
  },
  {
    id: 'c_irina',
    gender: 'f',
    firstName: { ru: 'Ирина', he: 'אירינה', en: 'Irina' },
    lastName: { ru: 'Фельдман', he: 'פלדמן', en: 'Feldman' },
    nationalId: '000000026',
    cards: ['2280'],
    phones: ['050-555-1234'],
    emails: ['irina.f@example.com'],
  },
];

const dup = (customerId: string, date: string, amount: number, card: string, merchant: string): Charge[] => [
  { id: `${customerId}_a`, customerId, date, amount, cardLast4: card, merchant },
  { id: `${customerId}_b`, customerId, date, amount, cardLast4: card, merchant },
];

export const ledger: Charge[] = [
  ...dup('c_david', '2026-09-03', 1250, '4417', 'SuperPharm'),
  ...dup('c_moshe', '2026-08-14', 389.9, '9031', 'Rami Levy'),
  ...dup('c_irina', '2026-09-21', 2400, '2280', 'El Al'),
  // Someone else's identical charge: tools must never return it.
  { id: 'other_1', customerId: 'c_other', date: '2026-09-03', amount: 1250, cardLast4: '4417', merchant: 'SuperPharm' },
];

export interface Fixture {
  name: string;
  ticket: Ticket;
  /** Personal data that is not in the customer record. Counted as a leak if it reaches the model. */
  alsoSensitive?: string[];
}

export const fixtures: Fixture[] = [
  {
    name: 'ru, declinable name (Давид Коэн)',
    ticket: {
      customerId: 'c_david',
      year: 2026,
      text: 'Здравствуйте, я Давид Коэн, ת.ז. 123456782. 3 сентября с карты ...4417 списали 1 250 ₪ дважды, верните, пожалуйста, одну сумму. Связаться со мной можно по 052-123-4567.',
    },
  },
  {
    name: 'ru, indeclinable first name (Моше Леви)',
    ticket: {
      customerId: 'c_moshe',
      year: 2026,
      text: 'Добрый день. Меня зовут Моше Леви. 14.08 по карте 9031 прошли два одинаковых платежа по 389,90 шек. в Rami Levy. Прошу вернуть лишний. Ответ можно прислать на moshe.levi@example.com.',
    },
  },
  {
    name: 'ru, feminine (Ирина Фельдман)',
    ticket: {
      customerId: 'c_irina',
      year: 2026,
      text: 'Здравствуйте! Это Ирина Фельдман. 21 сентября с моей карты 2280 дважды списали 2 400 ₪ за билет El Al. Пожалуйста, разберитесь.',
    },
  },
  {
    name: 'he',
    ticket: {
      customerId: 'c_david',
      year: 2026,
      text: 'שלום, שמי דוד כהן, ת.ז. 123456782. ב-3 בספטמבר חויבתי פעמיים ב-1,250 ש"ח בכרטיס שמסתיים ב-4417. אבקש להחזיר חיוב אחד.',
    },
  },
  {
    name: 'en',
    ticket: {
      customerId: 'c_irina',
      year: 2026,
      text: 'Hi, this is Irina Feldman. My card ending in 2280 was charged ₪2,400 twice on September 21 for an El Al ticket. Please refund one.',
    },
  },
  {
    name: 'mixed ru + he',
    ticket: {
      customerId: 'c_moshe',
      year: 2026,
      text: 'Здравствуйте, это Моше Леви (משה לוי), ת.ז. 000000018. 14.08 в רמי לוי с карты 9031 два раза списали 389.90 ₪. כתוב בדף החשבון חיוב כפול. Верните, пожалуйста, один.',
    },
  },
  {
    name: 'ru, reply needs a non-nominative case (справка на имя)',
    ticket: {
      customerId: 'c_david',
      year: 2026,
      text: 'Здравствуйте, я Давид Коэн. 3 сентября с карты 4417 дважды списали 1 250 ₪. Верните одну сумму и пришлите, пожалуйста, справку о возврате на имя Давида Коэна.',
    },
  },
  {
    name: 'mixed, with a third person (known gap)',
    ticket: {
      customerId: 'c_david',
      year: 2026,
      text: 'Hello, David Cohen here. My wife Sarah Mizrahi noticed that 3 сентября по карте 4417 списали 1 250 ₪ два раза. Please refund one of them.',
    },
    alsoSensitive: ['Sarah', 'Mizrahi'],
  },
];

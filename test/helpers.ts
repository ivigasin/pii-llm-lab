import type { Charge, Customer } from '../src/types.js';

export const david: Customer = {
  id: 'c_david',
  gender: 'm',
  firstName: { ru: 'Давид', he: 'דוד', en: 'David' },
  lastName: { ru: 'Коэн', he: 'כהן', en: 'Cohen' },
  nationalId: '123456782',
  cards: ['4417'],
  phones: ['052-123-4567'],
  emails: ['david.cohen@example.com'],
};

export const ledger: Charge[] = [
  { id: 'ch_a', customerId: 'c_david', date: '2026-09-03', amount: 1250, cardLast4: '4417', merchant: 'SuperPharm' },
  { id: 'ch_b', customerId: 'c_david', date: '2026-09-03', amount: 1250, cardLast4: '4417', merchant: 'SuperPharm' },
  { id: 'other', customerId: 'c_other', date: '2026-09-03', amount: 1250, cardLast4: '4417', merchant: 'SuperPharm' },
];

export const ticketRu = {
  customerId: 'c_david',
  year: 2026,
  text: 'Здравствуйте, я Давид Коэн, ת.ז. 123456782. 3 сентября с карты ...4417 списали 1 250 ₪ дважды, верните одну сумму. Мой телефон 052-123-4567, почта david.cohen@example.com.',
};

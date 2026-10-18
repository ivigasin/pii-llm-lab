// fast-check writes tickets nobody would write by hand: random people, random formats,
// random languages in random order. Property: nothing real reaches the model.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FakeModel } from '../src/fake-model.js';
import { findLeaks, forbiddenStrings } from '../src/leaks.js';
import { handleTicket } from '../src/pipeline.js';
import { inflect } from '../src/ru-names.js';
import type { Customer, Gender } from '../src/types.js';

const PEOPLE: { gender: Gender; ru: string; he: string; en: string }[] = [
  { gender: 'm', ru: 'Давид', he: 'דוד', en: 'David' },
  { gender: 'm', ru: 'Игорь', he: 'איגור', en: 'Igor' },
  { gender: 'm', ru: 'Моше', he: 'משה', en: 'Moshe' },
  { gender: 'm', ru: 'Борис', he: 'בוריס', en: 'Boris' },
  { gender: 'f', ru: 'Анна', he: 'אנה', en: 'Anna' },
  { gender: 'f', ru: 'Мария', he: 'מריה', en: 'Maria' },
  { gender: 'f', ru: 'Ирина', he: 'אירינה', en: 'Irina' },
];
const SURNAMES: { ru: string; he: string; en: string; f?: string }[] = [
  { ru: 'Коэн', he: 'כהן', en: 'Cohen' },
  { ru: 'Леви', he: 'לוי', en: 'Levi' },
  { ru: 'Фельдман', he: 'פלדמן', en: 'Feldman' },
  { ru: 'Иванов', he: 'איבנוב', en: 'Ivanov', f: 'Иванова' },
];
const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Any 8 digits + the check digit that makes a valid Israeli ID. */
const israeliId = fc.integer({ min: 0, max: 99_999_999 }).map((n) => {
  const body = String(n).padStart(8, '0');
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    let d = Number(body[i]) * ((i % 2) + 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return body + String((10 - (sum % 10)) % 10);
});

const ticketArb = fc
  .record({
    person: fc.constantFrom(...PEOPLE),
    surname: fc.constantFrom(...SURNAMES),
    id: israeliId,
    card: fc.integer({ min: 1000, max: 1899 }).map(String), // not year-like
    amount: fc.oneof(fc.integer({ min: 10, max: 99_999 }), fc.integer({ min: 1000, max: 999_999 }).map((n) => n / 100)),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
    phone: fc.integer({ min: 0, max: 9_999_999 }).map((n) => `05${n % 10}-${String(n).padStart(7, '0').slice(0, 3)}-${String(n).padStart(7, '0').slice(3)}`),
    sentences: fc.shuffledSubarray([0, 1, 2, 3, 4, 5, 6, 7, 8], { minLength: 3 }),
    caseForm: fc.constantFrom('gen', 'dat', 'ins', 'prep' as const),
    hePrefix: fc.constantFrom('ל', 'ב', 'ו', 'ש', 'מ', ''),
  })
  .map((g) => {
    const f = g.person.gender === 'f';
    const last = { ...g.surname, ru: f && g.surname.f ? g.surname.f : g.surname.ru };
    const customer: Customer = {
      id: 'c',
      gender: g.person.gender,
      firstName: { ru: g.person.ru, he: g.person.he, en: g.person.en },
      lastName: { ru: last.ru, he: last.he, en: last.en },
      nationalId: g.id,
      cards: [g.card],
      phones: [g.phone],
      emails: [`${g.person.en.toLowerCase()}.${last.en.toLowerCase()}@example.com`],
    };
    const amountRu = `${g.amount.toLocaleString('ru-RU').replace(/ /g, ' ')} ₪`;
    const amountEn = `₪${g.amount.toLocaleString('en-US')}`;
    const amountHe = `${g.amount.toLocaleString('en-US')} ש"ח`;
    const d = String(g.day).padStart(2, '0');
    const m = String(g.month).padStart(2, '0');
    const all = [
      `Здравствуйте, я ${g.person.ru} ${last.ru}, ת.ז. ${g.id}.`,
      `${g.day} ${RU_MONTHS[g.month - 1]} с карты ...${g.card} списали ${amountRu} дважды.`,
      `Письмо для ${inflect(last.ru, g.caseForm, g.person.gender)} не пришло, передайте ${inflect(g.person.ru, 'dat', g.person.gender)}.`,
      `שלום, אני ${g.person.he} ${last.he}. חויבתי ב-${amountHe} בכרטיס ${g.card} ב-${g.day} ב${HE_MONTHS[g.month - 1]}.`,
      `תשלחו ${g.hePrefix}${g.person.he} תשובה.`,
      `Hi, ${g.person.en} ${last.en} here, charged ${amountEn} on ${EN_MONTHS[g.month - 1]} ${g.day} on card ending in ${g.card}.`,
      `Call me at ${g.phone} or write to ${customer.emails[0]}.`,
      `Дата операции ${d}.${m}, мой номер ${g.id}.`,
      `On ${g.month}/${g.day} I saw it twice.`.replace(`${g.month}/${g.day}`, `${d}/${m}`),
    ];
    return { customer, text: g.sentences.map((i) => all[i]).join(' ') };
  });

describe('property: nothing real reaches the model', () => {
  it('for any generated ticket in any mix of languages', async () => {
    await fc.assert(
      fc.asyncProperty(ticketArb, async ({ customer, text }) => {
        const r = await handleTicket({
          ticket: { customerId: customer.id, text, year: 2026 },
          customer,
          ledger: [],
          model: new FakeModel('markers'),
        });
        const forbidden = forbiddenStrings(customer, r.vault);
        const leaks = r.sent.flatMap((s) => findLeaks(s, forbidden));
        expect(leaks, `ticket: ${text}\nmasked: ${JSON.parse(r.sent[0]!).messages[1].content}`).toEqual([]);
      }),
      { seed: 20261018, numRuns: 1000 },
    );
  });
});

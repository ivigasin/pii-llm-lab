// fast-check writes tickets nobody would write by hand: random people, random formats,
// random languages in random order. Property: nothing real reaches the model.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FakeModel } from '../src/fake-model.js';
import { findLeaks, forbiddenStrings } from '../src/leaks.js';
import { handleTicket } from '../src/pipeline.js';
import type { Customer, Gender } from '../src/types.js';

// Case forms are written by hand, NOT produced by src/ru-names.ts. A generator built on the
// code under test shares its blind spots: when Ирина was declined like the surname Ильина,
// a generator using inflect() never wrote "Ирины", so this test could not see the leak.
type Forms = Record<'gen' | 'dat' | 'ins' | 'prep', string>;
const forms = (gen: string, dat: string, ins: string, prep: string): Forms => ({ gen, dat, ins, prep });
const same = (w: string) => forms(w, w, w, w);

const PEOPLE: { gender: Gender; ru: string; he: string; en: string; forms: Forms }[] = [
  { gender: 'm', ru: 'Давид', he: 'דוד', en: 'David', forms: forms('Давида', 'Давиду', 'Давидом', 'Давиде') },
  { gender: 'm', ru: 'Игорь', he: 'איגור', en: 'Igor', forms: forms('Игоря', 'Игорю', 'Игорем', 'Игоре') },
  { gender: 'm', ru: 'Моше', he: 'משה', en: 'Moshe', forms: same('Моше') },
  { gender: 'm', ru: 'Борис', he: 'בוריס', en: 'Boris', forms: forms('Бориса', 'Борису', 'Борисом', 'Борисе') },
  { gender: 'f', ru: 'Анна', he: 'אנה', en: 'Anna', forms: forms('Анны', 'Анне', 'Анной', 'Анне') },
  { gender: 'f', ru: 'Мария', he: 'מריה', en: 'Maria', forms: forms('Марии', 'Марии', 'Марией', 'Марии') },
  { gender: 'f', ru: 'Ирина', he: 'אירינה', en: 'Irina', forms: forms('Ирины', 'Ирине', 'Ириной', 'Ирине') },
  { gender: 'f', ru: 'Марина', he: 'מרינה', en: 'Marina', forms: forms('Марины', 'Марине', 'Мариной', 'Марине') },
];
const SURNAMES: { he: string; en: string; m: { ru: string; forms: Forms }; f: { ru: string; forms: Forms } }[] = [
  { he: 'כהן', en: 'Cohen', m: { ru: 'Коэн', forms: forms('Коэна', 'Коэну', 'Коэном', 'Коэне') }, f: { ru: 'Коэн', forms: same('Коэн') } },
  { he: 'לוי', en: 'Levi', m: { ru: 'Леви', forms: same('Леви') }, f: { ru: 'Леви', forms: same('Леви') } },
  {
    he: 'פלדמן', en: 'Feldman',
    m: { ru: 'Фельдман', forms: forms('Фельдмана', 'Фельдману', 'Фельдманом', 'Фельдмане') },
    f: { ru: 'Фельдман', forms: same('Фельдман') },
  },
  {
    he: 'איבנוב', en: 'Ivanov',
    m: { ru: 'Иванов', forms: forms('Иванова', 'Иванову', 'Ивановым', 'Иванове') },
    f: { ru: 'Иванова', forms: forms('Ивановой', 'Ивановой', 'Ивановой', 'Ивановой') },
  },
  {
    he: 'אילין', en: 'Ilyin',
    m: { ru: 'Ильин', forms: forms('Ильина', 'Ильину', 'Ильиным', 'Ильине') },
    f: { ru: 'Ильина', forms: forms('Ильиной', 'Ильиной', 'Ильиной', 'Ильиной') },
  },
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
    firstCaseForm: fc.constantFrom('gen', 'dat', 'ins', 'prep' as const),
    hePrefix: fc.constantFrom('ל', 'ב', 'ו', 'ש', 'מ', ''),
  })
  .map((g) => {
    const f = g.person.gender === 'f';
    const ruLast = f ? g.surname.f : g.surname.m;
    const last = { he: g.surname.he, en: g.surname.en, ru: ruLast.ru };
    const handForms = [...Object.values(g.person.forms), ...Object.values(ruLast.forms)];
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
      `Письмо для ${ruLast.forms[g.caseForm]} не пришло, вопрос к ${g.person.forms[g.firstCaseForm]}.`,
      `שלום, אני ${g.person.he} ${last.he}. חויבתי ב-${amountHe} בכרטיס ${g.card} ב-${g.day} ב${HE_MONTHS[g.month - 1]}.`,
      `תשלחו ${g.hePrefix}${g.person.he} תשובה.`,
      `Hi, ${g.person.en} ${last.en} here, charged ${amountEn} on ${EN_MONTHS[g.month - 1]} ${g.day} on card ending in ${g.card}.`,
      `Call me at ${g.phone} or write to ${customer.emails[0]}.`,
      `Дата операции ${d}.${m}, мой номер ${g.id}.`,
      `On ${g.month}/${g.day} I saw it twice.`.replace(`${g.month}/${g.day}`, `${d}/${m}`),
    ];
    return { customer, handForms, text: g.sentences.map((i) => all[i]).join(' ') };
  });

describe('property: nothing real reaches the model', () => {
  it('for any generated ticket in any mix of languages', async () => {
    await fc.assert(
      fc.asyncProperty(ticketArb, async ({ customer, handForms, text }) => {
        const r = await handleTicket({
          ticket: { customerId: customer.id, text, year: 2026 },
          customer,
          ledger: [],
          model: new FakeModel('markers'),
        });
        // The code's own list plus the hand-written forms, so a form the code never generates still counts.
        const forbidden = [...new Set([...forbiddenStrings(customer, r.vault), ...handForms])];
        const leaks = r.sent.flatMap((s) => findLeaks(s, forbidden));
        expect(leaks, `ticket: ${text}\nmasked: ${JSON.parse(r.sent[0]!).messages[1].content}`).toEqual([]);
      }),
      { seed: 20261018, numRuns: 1000 },
    );
  });
});

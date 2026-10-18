import { describe, expect, it } from 'vitest';
import { restore } from '../src/restore.js';
import { inflect, type NamePart } from '../src/ru-names.js';
import type { Case, Gender } from '../src/types.js';
import { Vault } from '../src/vault.js';
import { david } from './helpers.js';

const vaultWith = () => {
  const v = new Vault();
  v.registerCustomer(david.id);
  v.token('AMOUNT', '1250');
  v.token('DATE', '2026-09-03');
  v.token('TXN', 'ch_b');
  return v;
};

describe('Russian name declension', () => {
  const table: [string, Gender, NamePart, Partial<Record<Case, string>>][] = [
    ['Давид', 'm', 'first', { gen: 'Давида', dat: 'Давиду', ins: 'Давидом', prep: 'Давиде' }],
    ['Коэн', 'm', 'last', { gen: 'Коэна', dat: 'Коэну', ins: 'Коэном' }],
    ['Игорь', 'm', 'first', { gen: 'Игоря', dat: 'Игорю', ins: 'Игорем' }],
    ['Андрей', 'm', 'first', { dat: 'Андрею', ins: 'Андреем' }],
    ['Иванов', 'm', 'last', { dat: 'Иванову', ins: 'Ивановым' }],
    ['Мартин', 'm', 'first', { dat: 'Мартину', ins: 'Мартином' }], // a first name in -ин is not a surname
    ['Моше', 'm', 'first', { gen: 'Моше', dat: 'Моше' }], // indeclinable
    ['Анна', 'f', 'first', { gen: 'Анны', dat: 'Анне', acc: 'Анну', ins: 'Анной' }],
    ['Мария', 'f', 'first', { gen: 'Марии', dat: 'Марии', acc: 'Марию' }],
    ['Ирина', 'f', 'first', { gen: 'Ирины', dat: 'Ирине', acc: 'Ирину', ins: 'Ириной', prep: 'Ирине' }], // not like Ильина
    ['Марина', 'f', 'first', { gen: 'Марины', dat: 'Марине' }],
    ['Ильина', 'f', 'last', { gen: 'Ильиной', dat: 'Ильиной', acc: 'Ильину' }],
    ['Иванова', 'f', 'last', { gen: 'Ивановой', acc: 'Иванову' }],
    ['Фельдман', 'f', 'last', { dat: 'Фельдман' }], // feminine consonant ending: indeclinable
    ['Миша', 'm', 'first', { gen: 'Миши', dat: 'Мише' }],
  ];
  for (const [word, gender, part, forms] of table) {
    for (const [c, expected] of Object.entries(forms)) {
      it(`${word} ${c} -> ${expected}`, () => expect(inflect(word, c as Case, gender, part)).toBe(expected));
    }
  }
});

describe('restoring what models write', () => {
  it('case marker', () => {
    const r = restore('Мы сообщим <CUSTOMER_FULL_NAME:dat> о решении.', vaultWith(), david);
    expect(r.text).toBe('Мы сообщим Давиду Коэну о решении.');
    expect(r.styles.marker).toBe(1);
  });

  it('suffix glued to the token', () => {
    const r = restore('Мы сообщим <CUSTOMER_FIRST_NAME>у о решении.', vaultWith(), david);
    expect(r.text).toBe('Мы сообщим Давиду о решении.');
    expect(r.styles.glued).toBe(1);
  });

  it('mangled tokens: spaces, lower case, escaping, missing brackets', () => {
    const r = restore('Здравствуйте, < customer first name >! Сумма \\<AMOUNT\\_1\\> от <DATE 1>, CUSTOMER_LAST_NAME.', vaultWith(), david);
    expect(r.text).toBe('Здравствуйте, Давид! Сумма 1 250 ₪ от 3 сентября 2026, Коэн.');
    expect(r.ok).toBe(true);
  });

  it('renders in the language around the token, keeping Hebrew prefixes', () => {
    const r = restore('שלום <CUSTOMER_FIRST_NAME>, האישור יישלח ל<CUSTOMER_FULL_NAME>. חיוב של <AMOUNT_1> ב-<DATE_1>.', vaultWith(), david);
    expect(r.text).toBe('שלום דוד, האישור יישלח לדוד כהן. חיוב של 1,250 ₪ ב-3 בספטמבר 2026.');
  });

  it('fails closed on an invented token', () => {
    const r = restore('Списание от <DATE_2>.', vaultWith(), david);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([{ kind: 'unknown-token', token: '<DATE_2>' }]);
  });

  it('fails closed on an internal token', () => {
    const r = restore('Операция <TXN_1> будет проверена.', vaultWith(), david);
    expect(r.ok).toBe(false);
    expect(r.problems[0]?.kind).toBe('internal-token');
  });

  it('cannot see a wrong case when the model leaves the name in the nominative', () => {
    // Grammatically wrong ("сообщим Давид"), but nothing in the text says so. Measured by the eval.
    const r = restore('Мы сообщим <CUSTOMER_FIRST_NAME> о решении.', vaultWith(), david);
    expect(r.ok).toBe(true);
    expect(r.text).toBe('Мы сообщим Давид о решении.');
  });
});

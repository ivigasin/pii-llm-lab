import { describe, expect, it } from 'vitest';
import { findLeaks, forbiddenStrings } from '../src/leaks.js';
import { isValidIsraeliId, mask, parseAmount } from '../src/mask.js';
import { Vault } from '../src/vault.js';
import { david, ticketRu } from './helpers.js';

const run = (text: string) => {
  const vault = new Vault();
  return { masked: mask(text, david, vault, 2026), vault };
};

describe('Israeli ID check digit', () => {
  it.each(['123456782', '000000018', '000000026'])('accepts %s', (id) => expect(isValidIsraeliId(id)).toBe(true));
  it.each(['123456789', '111111111'])('rejects %s', (id) => expect(isValidIsraeliId(id)).toBe(false));
});

describe('the customer record finds what patterns cannot', () => {
  it('masks the full Russian ticket with nothing real left', () => {
    const { masked, vault } = run(ticketRu.text);
    expect(masked).toBe(
      'Здравствуйте, я <CUSTOMER_FULL_NAME>, ת.ז. <NATIONAL_ID_1>. <DATE_1> с карты ...<CARD_1> списали <AMOUNT_1> дважды, верните одну сумму. Мой телефон <PHONE_1>, почта <EMAIL_1>.',
    );
    expect(findLeaks(masked, forbiddenStrings(david, vault))).toEqual([]);
  });

  it('finds Russian case forms of the name', () => {
    expect(run('Письмо для Коэна. Передайте Давиду. С Давидом.').masked).toBe(
      'Письмо для <CUSTOMER_LAST_NAME>. Передайте <CUSTOMER_FIRST_NAME>. С <CUSTOMER_FIRST_NAME>.',
    );
  });

  it('keeps Hebrew prefixes outside the token', () => {
    expect(run('שלחו לדוד כהן ובשביל דוד').masked).toBe('שלחו ל<CUSTOMER_FULL_NAME> ובשביל <CUSTOMER_FIRST_NAME>');
  });

  it('does not split an e-mail address that contains the name', () => {
    expect(run('write to david.cohen@example.com').masked).toBe('write to <EMAIL_1>');
  });
});

describe('patterns for values that are not in the record', () => {
  it.each([
    ['1 250 ₪', '1250'],
    ['₪1,250', '1250'],
    ['1,250 ש"ח', '1250'],
    ['389,90 шек.', '389.9'],
    ['389.90 NIS', '389.9'],
  ])('amount %s', (text, value) => {
    const { masked, vault } = run(`списали ${text} вчера`);
    expect(masked).toBe('списали <AMOUNT_1> вчера');
    expect(vault.resolve('<AMOUNT_1>')?.value).toBe(value);
  });

  it.each([
    ['3 сентября', '2026-09-03'],
    ['ב-3 בספטמבר', '2026-09-03'],
    ['September 3, 2026', '2026-09-03'],
    ['3 Sep', '2026-09-03'],
    ['14.08', '2026-08-14'],
    ['14/08/2025', '2025-08-14'],
    ['2026-09-21', '2026-09-21'],
  ])('date %s', (text, value) => {
    const { masked, vault } = run(`on ${text} then`);
    expect(masked).toMatch(/<DATE_1>/);
    expect(vault.resolve('<DATE_1>')?.value).toBe(value);
  });

  it('masks a valid ID number that is not the customer’s', () => {
    expect(run('ID 000000018 please').masked).toBe('ID <NATIONAL_ID_1> please');
  });

  it('leaves a 9-digit number with a wrong check digit alone (it is not an ID)', () => {
    expect(run('order 123456789').masked).toBe('order 123456789');
  });

  it('masks card endings only after a card cue', () => {
    expect(run('карта 4417, card ending in 9031, כרטיס 2280, ****1111, в 2026 году').masked).toBe(
      'карта <CARD_1>, card ending in <CARD_2>, כרטיס <CARD_3>, ****<CARD_4>, в 2026 году',
    );
  });

  it('gives the same value the same token everywhere', () => {
    const { masked } = run('1 250 ₪ и ещё ₪1,250, 3 сентября и 03.09.2026');
    expect(masked).toBe('<AMOUNT_1> и ещё <AMOUNT_1>, <DATE_1> и <DATE_1>');
  });
});

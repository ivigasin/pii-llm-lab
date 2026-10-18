// Things this design does NOT protect against. Tests here pass when the gap is present,
// so the gap stays visible; if you close one, flip its assertion.
import { describe, expect, it } from 'vitest';
import { mask } from '../src/mask.js';
import { Vault } from '../src/vault.js';
import { customers } from '../fixtures/tickets.js';
import { david } from './helpers.js';

describe('known gaps', () => {
  it('names of other people are not masked (needs a named-entity model)', () => {
    const masked = mask('My wife Sarah Mizrahi noticed the double charge.', david, new Vault(), 2026);
    expect(masked).toContain('Sarah Mizrahi');
  });

  it('a card ending written without a card cue is not masked', () => {
    const masked = mask('списали с 4417 дважды', david, new Vault(), 2026);
    expect(masked).toContain('4417');
  });

  it('free-text details can still identify a person (merchant, place, story)', () => {
    const masked = mask('Я единственный клиент из Мицпе-Рамона, у кого списали дважды в El Al', david, new Vault(), 2026);
    expect(masked).toContain('Мицпе-Рамона');
  });

  it('a merchant whose name contains the customer surname is masked too (over-masking)', () => {
    // Customer Моше Леви / משה לוי pays at the supermarket chain רמי לוי (Rami Levy).
    const moshe = customers.find((c) => c.id === 'c_moshe')!;
    const masked = mask('14.08 в רמי לוי списали дважды', moshe, new Vault(), 2026);
    expect(masked).toContain('רמי <CUSTOMER_LAST_NAME>');
  });
});

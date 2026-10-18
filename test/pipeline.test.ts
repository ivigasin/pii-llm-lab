import { describe, expect, it } from 'vitest';
import { FakeModel, type FakeStyle } from '../src/fake-model.js';
import { findLeaks, forbiddenStrings } from '../src/leaks.js';
import { handleTicket } from '../src/pipeline.js';
import { ToolBox } from '../src/tools.js';
import { Vault } from '../src/vault.js';
import { david, ledger, ticketRu } from './helpers.js';

const runWith = (style: FakeStyle) => handleTicket({ ticket: ticketRu, customer: david, ledger, model: new FakeModel(style) });

describe('end to end with a scripted model', () => {
  it.each<FakeStyle>(['markers', 'glued', 'bare-nominative', 'mangled', 'invents-token', 'shows-internal', 'raw-tool-args'])(
    '%s: nothing real is ever sent to the model',
    async (style) => {
      const r = await runWith(style);
      const forbidden = forbiddenStrings(david, r.vault);
      for (const payload of r.sent) expect(findLeaks(payload, forbidden)).toEqual([]);
    },
  );

  it('happy path: one refund proposal for a human, reply restored in Russian', async () => {
    const r = await runWith('markers');
    expect(r.reply.ok).toBe(true);
    expect(r.reply.text).toContain('Мы сообщим Давиду о решении');
    expect(r.reply.text).toContain('1 250 ₪ от 3 сентября 2026');
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ chargeId: 'ch_b', status: 'awaiting-approval' });
    expect(r.proposals[0]!.forStaff).toBe('Duplicate charge ₪1,250 on September 3, 2026');
  });

  it.each<FakeStyle>(['invents-token', 'shows-internal'])('%s: the reply is blocked, not sent', async (style) => {
    const r = await runWith(style);
    expect(r.reply.ok).toBe(false);
  });

  it('raw value as a tool argument is refused', async () => {
    const r = await runWith('raw-tool-args');
    expect(r.toolCalls[0]!.result).toMatch(/must be a DATE token/);
    expect(r.proposals).toHaveLength(0);
  });
});

describe('tools', () => {
  const box = () => {
    const vault = new Vault();
    const date = vault.token('DATE', '2026-09-03');
    return { vault, date, tools: new ToolBox(vault, david, ledger) };
  };

  it('never return another customer’s charge, even with identical date, amount and card', () => {
    const { date, tools } = box();
    const out = JSON.parse(tools.run('find_charges', JSON.stringify({ date })));
    expect(out.charges).toHaveLength(2);
    expect(JSON.stringify(out)).not.toContain('other');
  });

  it('return tokens, never real values', () => {
    const { date, tools } = box();
    const out = tools.run('find_charges', JSON.stringify({ date }));
    expect(out).not.toMatch(/2026-09-03|1250|4417/);
  });

  it('propose_refund is idempotent and moves no money', () => {
    const { date, tools } = box();
    const charge = JSON.parse(tools.run('find_charges', JSON.stringify({ date }))).charges[1].charge;
    const a = tools.run('propose_refund', JSON.stringify({ charge, reason: 'dup' }));
    const b = tools.run('propose_refund', JSON.stringify({ charge, reason: 'dup again' }));
    expect(a).toBe(b);
    expect(tools.proposals).toHaveLength(1);
    expect(tools.proposals[0]!.status).toBe('awaiting-approval');
  });
});

// Score replies collected outside the pipeline (eval-results/claude-agents-replies.json):
// rebuild each ticket's vault exactly as agent-prompts.ts did, restore, and measure.
//   npx tsx scripts/score-replies.ts eval-results/claude-agents-replies.json
import { readFileSync } from 'node:fs';
import { customers, fixtures, ledger } from '../fixtures/tickets.js';
import { mask } from '../src/mask.js';
import { restore } from '../src/restore.js';
import { ToolBox } from '../src/tools.js';
import { Vault } from '../src/vault.js';

interface Collected {
  model: string;
  ticket: number; // 1-based fixture index
  reply: string;
}

function vaultFor(index: number) {
  const fx = fixtures[index]!;
  const customer = customers.find((c) => c.id === fx.ticket.customerId)!;
  const vault = new Vault();
  vault.registerCustomer(customer.id);
  const tools = new ToolBox(vault, customer, ledger);
  const masked = mask(fx.ticket.text, customer, vault, fx.ticket.year);
  const first = (kind: string) => masked.match(new RegExp(`<${kind}_\\d+>`))?.[0];
  const found = JSON.parse(tools.run('find_charges', JSON.stringify({ date: first('DATE'), amount: first('AMOUNT'), card: first('CARD') })));
  const dup = found.charges?.[1];
  tools.run('propose_refund', JSON.stringify({ charge: dup?.charge, reason: 'dup' }));
  return { fx, customer, vault };
}

const collected: Collected[] = JSON.parse(readFileSync(process.argv[2] ?? 'eval-results/claude-agents-replies.json', 'utf8'));
const models = [...new Set(collected.map((c) => c.model))];

console.log('| model | replies | restored OK | invented / internal tokens | tokens: exact | case markers | glued | mangled | replies that use the customer name |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const model of models) {
  const rows = collected.filter((c) => c.model === model).map((c) => {
    const { fx, customer, vault } = vaultFor(c.ticket - 1);
    return { c, fx, r: restore(c.reply, vault, customer) };
  });
  const s = (k: 'exact' | 'marker' | 'glued' | 'mangled') => rows.reduce((a, x) => a + x.r.styles[k], 0);
  const usesName = rows.filter((x) => x.r.tokens.some((t) => t.kind.startsWith('CUSTOMER_'))).length;
  console.log(
    `| ${model} | ${rows.length} | ${rows.filter((x) => x.r.ok).length}/${rows.length} | ${rows.reduce((a, x) => a + x.r.problems.length, 0)} | ${s('exact')} | ${s('marker')} | ${s('glued')} | ${s('mangled')} | ${usesName}/${rows.length} |`,
  );
}

console.log('\nRussian name tokens with a case marker:');
for (const c of collected) {
  const { customer, vault } = vaultFor(c.ticket - 1);
  const r = restore(c.reply, vault, customer);
  for (const t of r.tokens.filter((t) => t.style === 'marker')) {
    const line = r.text.split('\n').find((l) => l.trim()) ?? '';
    console.log(`  ${c.model} #${c.ticket}: ${t.token} -> case ${t.case}; restored: "${line.trim()}"`);
  }
}

console.log('\nWhere Russian replies put the customer name (first line containing it):');
for (const c of collected) {
  const { customer, vault } = vaultFor(c.ticket - 1);
  const r = restore(c.reply, vault, customer);
  const ru = r.tokens.filter((t) => t.lang === 'ru' && t.kind.startsWith('CUSTOMER_'));
  if (!ru.length) continue;
  const raw = c.reply.split('\n').find((l) => /<CUSTOMER_/.test(l)) ?? '';
  console.log(`  ${c.model} #${c.ticket}: ${raw.trim()}`);
}

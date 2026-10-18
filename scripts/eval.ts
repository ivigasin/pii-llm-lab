// Run the fixtures through real models behind LiteLLM and measure what they do with tokens.
//
//   LITELLM_BASE_URL=http://localhost:4000 LITELLM_API_KEY=sk-... \
//   MODELS=claude-sonnet,gpt-4o RUNS=3 npm run eval
//
// Without MODELS it runs the fake model, so the script itself can be checked offline.
// Results go to eval-results/<timestamp>.json; restored replies contain only the
// fictional data from fixtures/, so they are safe to read and share.
import { mkdirSync, writeFileSync } from 'node:fs';
import { customers, fixtures, ledger } from '../fixtures/tickets.js';
import { FakeModel } from '../src/fake-model.js';
import { findLeaks, forbiddenStrings } from '../src/leaks.js';
import { LiteLLMModel } from '../src/litellm.js';
import type { ChatModel } from '../src/model.js';
import { handleTicket } from '../src/pipeline.js';

const modelNames = (process.env.MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const models: ChatModel[] = modelNames.length ? modelNames.map((n) => new LiteLLMModel(n)) : [new FakeModel('markers')];
const runs = Number(process.env.RUNS ?? 3);

interface Row {
  model: string;
  fixture: string;
  run: number;
  error?: string;
  leaks: string[];
  toolErrors: number;
  proposals: number;
  restoredOk: boolean;
  problems: string[];
  styles: Record<string, number>;
  /** Russian replies: name tokens with no case information (nominative assumed). */
  ruNamesWithoutCase: number;
  ruNamesTotal: number;
  rawReply: string;
  reply: string;
}

const rows: Row[] = [];
for (const model of models) {
  for (const fx of fixtures) {
    const customer = customers.find((c) => c.id === fx.ticket.customerId)!;
    for (let run = 1; run <= runs; run++) {
      try {
        const r = await handleTicket({ ticket: fx.ticket, customer, ledger, model });
        const forbidden = [...forbiddenStrings(customer, r.vault), ...(fx.alsoSensitive ?? [])];
        const ruNames = r.reply.tokens.filter((t) => t.lang === 'ru' && t.kind.startsWith('CUSTOMER_'));
        rows.push({
          model: model.name,
          fixture: fx.name,
          run,
          leaks: [...new Set(r.sent.flatMap((s) => findLeaks(s, forbidden)))],
          toolErrors: r.toolCalls.filter((c) => c.result.includes('"error"')).length,
          proposals: r.proposals.length,
          restoredOk: r.reply.ok,
          problems: r.reply.problems.map((p) => `${p.kind}:${p.token}`),
          styles: r.reply.styles,
          ruNamesWithoutCase: ruNames.filter((t) => t.style !== 'marker' && t.style !== 'glued').length,
          ruNamesTotal: ruNames.length,
          rawReply: r.rawReply,
          reply: r.reply.text,
        });
      } catch (e) {
        rows.push({
          model: model.name, fixture: fx.name, run, error: String(e), leaks: [], toolErrors: 0, proposals: 0,
          restoredOk: false, problems: [], styles: {}, ruNamesWithoutCase: 0, ruNamesTotal: 0, rawReply: '', reply: '',
        });
      }
      process.stdout.write('.');
    }
  }
}
console.log('\n');

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
console.log('| model | runs | errors | leaks | tool errors | exactly 1 proposal | restored OK | invented / internal tokens | ru names: case marker | ru names without case (read them) |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const model of models) {
  const r = rows.filter((x) => x.model === model.name);
  const ruTotal = sum(r.map((x) => x.ruNamesTotal));
  const ruNoCase = sum(r.map((x) => x.ruNamesWithoutCase));
  const markers = sum(r.map((x) => x.styles.marker ?? 0));
  console.log(
    `| ${model.name} | ${r.length} | ${r.filter((x) => x.error).length} | ${sum(r.map((x) => x.leaks.length))} | ${sum(r.map((x) => x.toolErrors))} | ${r.filter((x) => x.proposals === 1).length}/${r.length} | ${r.filter((x) => x.restoredOk).length}/${r.length} | ${sum(r.map((x) => x.problems.length))} | ${markers} | ${ruNoCase}/${ruTotal} |`,
  );
}

mkdirSync('eval-results', { recursive: true });
const file = `eval-results/${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(file, JSON.stringify(rows, null, 2));
console.log(`\nDetails, including every restored reply: ${file}`);
console.log('Read the Russian replies yourself: a name left in the nominative where another case is needed cannot be detected automatically.');

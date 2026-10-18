// Build, for each fixture, exactly what the model sees at the moment it writes the reply:
// system prompt, masked ticket, its own tool calls and their (tokenised) results.
// Used to collect replies from models that cannot be called through LiteLLM here.
//   npx tsx scripts/agent-prompts.ts > eval-results/agent-prompts.json
import { customers, fixtures, ledger } from '../fixtures/tickets.js';
import { mask } from '../src/mask.js';
import { SYSTEM_PROMPT } from '../src/pipeline.js';
import { ToolBox } from '../src/tools.js';
import { Vault } from '../src/vault.js';

const out = fixtures.map((fx) => {
  const customer = customers.find((c) => c.id === fx.ticket.customerId)!;
  const vault = new Vault();
  vault.registerCustomer(customer.id);
  const tools = new ToolBox(vault, customer, ledger);
  const masked = mask(fx.ticket.text, customer, vault, fx.ticket.year);
  const first = (kind: string) => masked.match(new RegExp(`<${kind}_\\d+>`))?.[0];

  const findArgs = JSON.stringify({ date: first('DATE'), amount: first('AMOUNT'), card: first('CARD') });
  const found = tools.run('find_charges', findArgs);
  const charges = JSON.parse(found).charges ?? [];
  const refundArgs = JSON.stringify({ charge: charges[1]?.charge, reason: `Duplicate charge ${charges[1]?.amount} on ${charges[1]?.date}` });
  const proposed = tools.run('propose_refund', refundArgs);

  const prompt = [
    'You are the assistant model inside a customer-support system. Below are your system instructions and the conversation so far,',
    'including the tool calls you already made and their results. Write the next assistant message: the reply to the customer.',
    'Output only that reply text. No preamble, no quotes, no explanation. Do not use any tools.',
    '',
    '=== SYSTEM ===',
    SYSTEM_PROMPT,
    '',
    '=== USER (customer ticket) ===',
    masked,
    '',
    '=== ASSISTANT TOOL CALL 1 ===',
    `find_charges(${findArgs})`,
    '=== TOOL RESULT 1 ===',
    found,
    '',
    '=== ASSISTANT TOOL CALL 2 ===',
    `propose_refund(${refundArgs})`,
    '=== TOOL RESULT 2 ===',
    proposed,
    '',
    '=== ASSISTANT (reply to the customer) ===',
  ].join('\n');
  return { fixture: fx.name, prompt };
});

console.log(JSON.stringify(out, null, 2));

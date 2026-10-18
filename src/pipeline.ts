/**
 * One support ticket, end to end:
 *   mask -> model (with tools, on tokens only) -> restore -> draft reply + refund proposals for a human.
 * Every request sent to the model is recorded, so tests can prove nothing real left our side.
 */
import { mask } from './mask.js';
import type { ChatModel, Message } from './model.js';
import { restore, type RestoreResult } from './restore.js';
import { TOOL_SPECS, ToolBox, type RefundProposal } from './tools.js';
import type { Charge, Customer, Ticket } from './types.js';
import { Vault } from './vault.js';

export const SYSTEM_PROMPT = `You are a support agent for a payments company. You draft a reply to the customer.

Personal data in the ticket has been replaced with tokens in angle brackets:
<CUSTOMER_FIRST_NAME>, <CUSTOMER_LAST_NAME>, <CUSTOMER_FULL_NAME>, <DATE_1>, <AMOUNT_1>, <CARD_1>, <NATIONAL_ID_1>, <PHONE_1>, <EMAIL_1>.
Rules:
1. Copy tokens exactly. Never invent a token that you have not seen, never change its spelling, never translate it.
2. In Russian, if a name token needs a grammatical case other than nominative, add the case after a colon:
   <CUSTOMER_FIRST_NAME:dat>, <CUSTOMER_FULL_NAME:gen>. Cases: nom, gen, dat, acc, ins, prep.
   Do not add endings to a token yourself.
3. You cannot compute with dates or amounts: you do not know them. Use the tools; they accept and return tokens.
4. You cannot refund. Use propose_refund; a human approves it. Tell the customer the request is being reviewed; do not promise a refund.
5. Never show <TXN_...> or <PROPOSAL_...> tokens to the customer.
6. Reply in the language of the customer's ticket. If the ticket mixes languages, use the language of most of it.`;

export interface TicketResult {
  reply: RestoreResult;
  /** The reply exactly as the model wrote it, with tokens. */
  rawReply: string;
  proposals: (RefundProposal & { forStaff: string })[];
  /** Every request sent to the model, serialised. */
  sent: string[];
  toolCalls: { name: string; arguments: string; result: string }[];
  vault: Vault;
}

export async function handleTicket(opts: {
  ticket: Ticket;
  customer: Customer;
  ledger: Charge[];
  model: ChatModel;
  maxSteps?: number;
}): Promise<TicketResult> {
  const { ticket, customer, ledger, model, maxSteps = 6 } = opts;
  const vault = new Vault();
  vault.registerCustomer(customer.id);
  const tools = new ToolBox(vault, customer, ledger);

  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: mask(ticket.text, customer, vault, ticket.year) },
  ];
  const sent: string[] = [];
  const toolCalls: TicketResult['toolCalls'] = [];
  let rawReply = '';

  for (let step = 0; step < maxSteps; step++) {
    const request = { messages: [...messages], tools: TOOL_SPECS };
    sent.push(JSON.stringify(request));
    const response = await model.chat(request);

    if (response.tool_calls?.length) {
      messages.push({ role: 'assistant', content: response.content, tool_calls: response.tool_calls });
      for (const call of response.tool_calls) {
        const result = tools.run(call.function.name, call.function.arguments);
        toolCalls.push({ name: call.function.name, arguments: call.function.arguments, result });
        messages.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
      continue;
    }
    rawReply = response.content ?? '';
    break;
  }

  const reply = rawReply
    ? restore(rawReply, vault, customer)
    : { ok: false, text: '', problems: [], styles: { exact: 0, marker: 0, glued: 0, mangled: 0, bare: 0 }, tokens: [] };

  // Staff see the proposal with real values; the customer never sees it.
  const proposals = tools.proposals.map((p) => ({
    ...p,
    forStaff: restore(p.reason, vault, customer).text,
  }));

  return { reply, rawReply, proposals, sent, toolCalls, vault };
}

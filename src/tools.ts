/**
 * Tools run on our side, with real values. The model only ever sends and receives tokens.
 *
 * - The customer is never a tool argument: tools are scoped to the authenticated
 *   customer of the conversation, so a model cannot look up someone else.
 * - Arguments must be tokens from this conversation. A raw value (the model guessing
 *   "2026-09-03") is refused: we do not want the model to handle real values at all.
 * - propose_refund moves no money. It creates a proposal a human approves.
 */
import type { ToolSpec } from './model.js';
import type { Charge, Customer, Kind } from './types.js';
import type { Vault } from './vault.js';

export interface RefundProposal {
  id: string;
  chargeId: string;
  amount: number;
  reason: string;
  status: 'awaiting-approval';
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'find_charges',
      description:
        "Find the customer's card charges. Every argument must be a token from the conversation, e.g. <DATE_1>. Returns tokens.",
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date token, e.g. <DATE_1>' },
          amount: { type: 'string', description: 'Amount token, e.g. <AMOUNT_1>' },
          card: { type: 'string', description: 'Card token, e.g. <CARD_1>' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_refund',
      description:
        'Propose refunding one charge. Does NOT refund: a human reviews and approves. Use the charge token returned by find_charges.',
      parameters: {
        type: 'object',
        properties: {
          charge: { type: 'string', description: 'Charge token, e.g. <TXN_2>' },
          reason: { type: 'string', description: 'Short reason, no personal data' },
        },
        required: ['charge', 'reason'],
      },
    },
  },
];

export class ToolBox {
  readonly proposals: RefundProposal[] = [];

  constructor(
    private readonly vault: Vault,
    private readonly customer: Customer,
    private readonly ledger: Charge[],
  ) {}

  run(name: string, rawArgs: string): string {
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(rawArgs || '{}');
    } catch {
      return JSON.stringify({ error: 'arguments must be JSON' });
    }
    if (name === 'find_charges') return this.findCharges(args);
    if (name === 'propose_refund') return this.proposeRefund(args);
    return JSON.stringify({ error: `unknown tool ${name}` });
  }

  private argument(args: Record<string, unknown>, field: string, kind: Kind): { value?: string; error?: string } {
    const raw = args[field];
    if (raw === undefined || raw === null || raw === '') return {};
    const entry = this.vault.resolve(String(raw).trim());
    if (!entry || entry.kind !== kind) return { error: `${field} must be a ${kind} token from the conversation, got ${String(raw)}` };
    return { value: entry.value };
  }

  private findCharges(args: Record<string, unknown>): string {
    const date = this.argument(args, 'date', 'DATE');
    const amount = this.argument(args, 'amount', 'AMOUNT');
    const card = this.argument(args, 'card', 'CARD');
    const error = date.error ?? amount.error ?? card.error;
    if (error) return JSON.stringify({ error });

    const charges = this.ledger.filter(
      (c) =>
        c.customerId === this.customer.id &&
        (!date.value || c.date === date.value) &&
        (!amount.value || c.amount === Number(amount.value)) &&
        (!card.value || c.cardLast4 === card.value),
    );
    return JSON.stringify({
      charges: charges.map((c) => ({
        charge: this.vault.token('TXN', c.id),
        date: this.vault.token('DATE', c.date),
        amount: this.vault.token('AMOUNT', String(c.amount)),
        card: this.vault.token('CARD', c.cardLast4),
        merchant: c.merchant, // a business name is not personal data
      })),
    });
  }

  private proposeRefund(args: Record<string, unknown>): string {
    const charge = this.argument(args, 'charge', 'TXN');
    if (charge.error || !charge.value) return JSON.stringify({ error: charge.error ?? 'charge is required' });
    const found = this.ledger.find((c) => c.id === charge.value && c.customerId === this.customer.id);
    if (!found) return JSON.stringify({ error: 'no such charge for this customer' });

    // Idempotent: proposing the same charge twice returns the existing proposal.
    let proposal = this.proposals.find((p) => p.chargeId === found.id);
    if (!proposal) {
      proposal = {
        id: `prop_${this.proposals.length + 1}`,
        chargeId: found.id,
        amount: found.amount,
        reason: String(args.reason ?? ''),
        status: 'awaiting-approval',
      };
      this.proposals.push(proposal);
    }
    return JSON.stringify({ proposal: this.vault.token('PROPOSAL', proposal.id), status: 'awaiting human approval' });
  }
}

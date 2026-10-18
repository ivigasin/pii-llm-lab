import type { Kind } from './types.js';

export interface Entry {
  kind: Kind;
  /** Canonical value: ISO date, number of shekels, digits, customer id, charge id... */
  value: string;
}

/**
 * Per-conversation mapping between real values and tokens. Lives only on our side.
 * The same value always gets the same token, so the model can reason about
 * "<AMOUNT_1> twice" without ever seeing the amount.
 */
export class Vault {
  private readonly byValue = new Map<string, string>();
  private readonly byToken = new Map<string, Entry>();
  private readonly counters = new Map<Kind, number>();

  token(kind: Kind, value: string): string {
    const key = `${kind}\u0000${value}`;
    const existing = this.byValue.get(key);
    if (existing) return existing;

    let token: string;
    if (kind.startsWith('CUSTOMER_')) {
      token = `<${kind}>`; // one customer per conversation: a role name is clearer than a number
    } else {
      const n = (this.counters.get(kind) ?? 0) + 1;
      this.counters.set(kind, n);
      token = `<${kind}_${n}>`;
    }
    this.byValue.set(key, token);
    this.byToken.set(token, { kind, value });
    return token;
  }

  resolve(token: string): Entry | undefined {
    return this.byToken.get(token);
  }

  /**
   * Register the customer's name tokens up front: the model may greet the customer by
   * first name even if the ticket only contained the full name.
   */
  registerCustomer(customerId: string): void {
    for (const kind of ['CUSTOMER_FIRST_NAME', 'CUSTOMER_LAST_NAME', 'CUSTOMER_FULL_NAME'] as const) {
      this.token(kind, customerId);
    }
  }

  /** All real values, for leak checks. */
  values(): Entry[] {
    return [...this.byToken.values()];
  }
}

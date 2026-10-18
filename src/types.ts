export type Lang = 'ru' | 'he' | 'en';
export type Gender = 'm' | 'f';
export type Case = 'nom' | 'gen' | 'dat' | 'acc' | 'ins' | 'prep';

/** What the support system already knows about the authenticated customer. */
export interface Customer {
  id: string;
  gender: Gender;
  /** The same name in each script the customer may use or be addressed in. */
  firstName: Partial<Record<Lang, string>>;
  lastName: Partial<Record<Lang, string>>;
  /** Israeli ID number (ת.ז.), 9 digits. */
  nationalId: string;
  /** Last four digits of the customer's cards. */
  cards: string[];
  phones: string[];
  emails: string[];
}

export interface Charge {
  id: string;
  customerId: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** Shekels. */
  amount: number;
  cardLast4: string;
  merchant: string;
}

export interface Ticket {
  customerId: string;
  text: string;
  /** Year used for dates written without one ("3 сентября"). */
  year: number;
}

/** Kinds of values that are replaced by tokens before anything reaches the model. */
export type Kind =
  | 'CUSTOMER_FIRST_NAME'
  | 'CUSTOMER_LAST_NAME'
  | 'CUSTOMER_FULL_NAME'
  | 'NATIONAL_ID'
  | 'CARD'
  | 'DATE'
  | 'AMOUNT'
  | 'PHONE'
  | 'EMAIL'
  /** Internal references created by tools. Never shown to the customer. */
  | 'TXN'
  | 'PROPOSAL';

export const CUSTOMER_NAME_KINDS: Kind[] = ['CUSTOMER_FIRST_NAME', 'CUSTOMER_LAST_NAME', 'CUSTOMER_FULL_NAME'];
export const INTERNAL_KINDS: Kind[] = ['TXN', 'PROPOSAL'];

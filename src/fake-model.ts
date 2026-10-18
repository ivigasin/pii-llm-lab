/**
 * A scripted model for tests. It follows the happy path (find charges, propose a refund,
 * reply) and misbehaves with tokens in one chosen way, so each failure mode has a test.
 * It never sees real values, so it cannot leak them; what it can do is break restoration.
 * Whether real models behave like this is what `npm run eval` measures.
 */
import type { ChatModel, ChatRequest, ChatResponse, ToolCall } from './model.js';
import { scriptOf } from './render.js';

export type FakeStyle =
  | 'markers' //          <CUSTOMER_FIRST_NAME:dat>, as the prompt asks
  | 'glued' //            <CUSTOMER_FIRST_NAME>у
  | 'bare-nominative' //  <CUSTOMER_FIRST_NAME> where Russian needs dative: undetectable
  | 'mangled' //          < customer first name >, \<AMOUNT\_1\>, CARD_1
  | 'invents-token' //    <DATE_2> that was never issued
  | 'shows-internal' //   tells the customer about <TXN_2>
  | 'raw-tool-args'; //   passes "2026-09-03" to a tool instead of a token

const REPLIES: Record<'ru' | 'he' | 'en', Record<FakeStyle, string>> = {
  ru: {
    markers: 'Здравствуйте, <CUSTOMER_FIRST_NAME>! Мы видим два списания по <AMOUNT_1> от <DATE_1> с карты <CARD_1>. Запрос на возврат одного из них передан сотруднику. Мы сообщим <CUSTOMER_FIRST_NAME:dat> о решении в течение рабочего дня.',
    glued: 'Здравствуйте, <CUSTOMER_FIRST_NAME>! Мы видим два списания по <AMOUNT_1> от <DATE_1> с карты <CARD_1>. Запрос на возврат одного из них передан сотруднику. Мы сообщим <CUSTOMER_FIRST_NAME>у о решении в течение рабочего дня.',
    'bare-nominative': 'Здравствуйте, <CUSTOMER_FIRST_NAME>! Мы видим два списания по <AMOUNT_1> от <DATE_1> с карты <CARD_1>. Запрос на возврат одного из них передан сотруднику. Мы сообщим <CUSTOMER_FIRST_NAME> о решении в течение рабочего дня.',
    mangled: 'Здравствуйте, < customer first name >! Мы видим два списания по \\<AMOUNT\\_1\\> от <DATE 1> с карты CARD_1. Запрос на возврат одного из них передан сотруднику.',
    'invents-token': 'Здравствуйте, <CUSTOMER_FIRST_NAME>! Мы видим два списания по <AMOUNT_1> от <DATE_2> с карты <CARD_1>. Запрос на возврат передан сотруднику.',
    'shows-internal': 'Здравствуйте, <CUSTOMER_FIRST_NAME>! Операция <TXN_2> на <AMOUNT_1> будет проверена сотрудником.',
    'raw-tool-args': 'Здравствуйте, <CUSTOMER_FIRST_NAME>! Мы не смогли найти операции, сотрудник свяжется с вами.',
  },
  he: {
    markers: 'שלום <CUSTOMER_FIRST_NAME>, אנחנו רואים שני חיובים של <AMOUNT_1> מ-<DATE_1> בכרטיס <CARD_1>. בקשת ההחזר הועברה לנציג, והתשובה תישלח ל<CUSTOMER_FULL_NAME> במהלך יום העסקים.',
    glued: 'שלום <CUSTOMER_FIRST_NAME>, אנחנו רואים שני חיובים של <AMOUNT_1> מ-<DATE_1> בכרטיס <CARD_1>. בקשת ההחזר הועברה לנציג, והתשובה תישלח ל<CUSTOMER_FULL_NAME> במהלך יום העסקים.',
    'bare-nominative': 'שלום <CUSTOMER_FIRST_NAME>, אנחנו רואים שני חיובים של <AMOUNT_1> מ-<DATE_1> בכרטיס <CARD_1>. בקשת ההחזר הועברה לנציג.',
    mangled: 'שלום < customer first name >, אנחנו רואים שני חיובים של \\<AMOUNT\\_1\\> מ-<DATE 1> בכרטיס CARD_1.',
    'invents-token': 'שלום <CUSTOMER_FIRST_NAME>, אנחנו רואים שני חיובים של <AMOUNT_1> מ-<DATE_2>.',
    'shows-internal': 'שלום <CUSTOMER_FIRST_NAME>, העסקה <TXN_2> תיבדק על ידי נציג.',
    'raw-tool-args': 'שלום <CUSTOMER_FIRST_NAME>, לא מצאנו את החיובים, נציג יחזור אליך.',
  },
  en: {
    markers: 'Hello <CUSTOMER_FIRST_NAME>, we can see two charges of <AMOUNT_1> on <DATE_1> on card <CARD_1>. A refund request for one of them has been passed to a specialist, who will reply within one business day.',
    glued: 'Hello <CUSTOMER_FIRST_NAME>, we can see two charges of <AMOUNT_1> on <DATE_1> on card <CARD_1>. A refund request has been passed to a specialist.',
    'bare-nominative': 'Hello <CUSTOMER_FIRST_NAME>, we can see two charges of <AMOUNT_1> on <DATE_1> on card <CARD_1>. A refund request has been passed to a specialist.',
    mangled: 'Hello < customer first name >, we can see two charges of \\<AMOUNT\\_1\\> on <DATE 1> on card CARD_1.',
    'invents-token': 'Hello <CUSTOMER_FIRST_NAME>, we can see two charges of <AMOUNT_1> on <DATE_2>.',
    'shows-internal': 'Hello <CUSTOMER_FIRST_NAME>, charge <TXN_2> will be reviewed by a specialist.',
    'raw-tool-args': 'Hello <CUSTOMER_FIRST_NAME>, we could not find the charges; a specialist will contact you.',
  },
};

let callSeq = 0;
const call = (name: string, args: Record<string, unknown>): ToolCall => ({
  id: `call_${++callSeq}`,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

export class FakeModel implements ChatModel {
  readonly name: string;
  constructor(private readonly style: FakeStyle = 'markers') {
    this.name = `fake:${style}`;
  }

  async chat({ messages }: ChatRequest): Promise<ChatResponse> {
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    const toolResults = messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content as string));
    const first = (kind: string) => user.match(new RegExp(`<${kind}_\\d+>`))?.[0];

    if (toolResults.length === 0) {
      if (this.style === 'raw-tool-args') return { content: null, tool_calls: [call('find_charges', { date: '2025-01-01' })] };
      return {
        content: null,
        tool_calls: [call('find_charges', { date: first('DATE'), amount: first('AMOUNT'), card: first('CARD') })],
      };
    }
    const found = toolResults[0];
    if (toolResults.length === 1 && Array.isArray(found.charges) && found.charges.length >= 2) {
      const dup = found.charges[1];
      return {
        content: null,
        tool_calls: [call('propose_refund', { charge: dup.charge, reason: `Duplicate charge ${dup.amount} on ${dup.date}` })],
      };
    }
    const lang = scriptOf(user.replace(/<[^>]+>/g, ' '));
    return { content: REPLIES[lang][this.style] };
  }
}

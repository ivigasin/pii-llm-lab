/**
 * Turn the model's reply back into text for the customer.
 *
 * What models actually do with tokens, and how each case is handled:
 *   <CUSTOMER_FIRST_NAME>            exact                     restore
 *   <CUSTOMER_FIRST_NAME:dat>        case marker (we ask)      restore in that case (Russian)
 *   <CUSTOMER_FIRST_NAME>у           case glued as a suffix    guess the case, drop the suffix
 *   < customer first name >, \_ ...  mangled                   normalise, then restore
 *   CUSTOMER_FIRST_NAME              brackets dropped          restore
 *   <DATE_7>                         invented                  FAIL CLOSED: a human must look
 *   <TXN_2>, <PROPOSAL_1>            internal reference        FAIL CLOSED: never shown to the customer
 * A token in the nominative where Russian needs another case cannot be detected
 * here; it is measured by the eval and is why the prompt asks for case markers.
 */
import { renderAmount, renderDate, renderName, scriptOf } from './render.js';
import { caseFromGluedSuffix, isCase } from './ru-names.js';
import { CUSTOMER_NAME_KINDS, INTERNAL_KINDS, type Case, type Customer } from './types.js';
import type { Vault } from './vault.js';

export type TokenStyle = 'exact' | 'marker' | 'glued' | 'mangled' | 'bare';

export interface RestoreProblem {
  kind: 'unknown-token' | 'internal-token';
  token: string;
}

export interface RestoredToken {
  token: string;
  kind: string;
  style: TokenStyle;
  lang: string;
  case: Case;
}

export interface RestoreResult {
  ok: boolean;
  text: string;
  problems: RestoreProblem[];
  styles: Record<TokenStyle, number>;
  /** Every token that was restored, for measuring how a model writes them. */
  tokens: RestoredToken[];
}

const KNOWN_NAMES = String.raw`CUSTOMER_(?:FIRST|LAST|FULL)_NAME|(?:DATE|AMOUNT|CARD|NATIONAL_ID|PHONE|EMAIL|TXN|PROPOSAL)_\d+`;
// Bracketed (possibly mangled) or bare token, optional ":case", optional glued Cyrillic suffix.
const TOKEN_RE = new RegExp(
  String.raw`<\s*([A-Za-z][A-Za-z0-9_ \-]*?)\s*(?::\s*([a-z]{3,4}))?\s*>` +
    String.raw`|(?<![A-Za-z0-9_])(${KNOWN_NAMES})(?::([a-z]{3,4}))?(?![A-Za-z0-9_])`,
  'g',
);
const GLUED = /^([а-яё]{1,2})(?![а-яё])/i;

function normaliseName(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, '_').replace(/_+/g, '_').replace(/^([A-Z_]+?)_?(\d+)$/, '$1_$2');
}

export function restore(reply: string, vault: Vault, customer: Customer): RestoreResult {
  const styles: Record<TokenStyle, number> = { exact: 0, marker: 0, glued: 0, mangled: 0, bare: 0 };
  const problems: RestoreProblem[] = [];
  const tokens: RestoredToken[] = [];
  // Undo markdown/HTML escaping models sometimes apply to angle brackets and underscores.
  const text = reply.replace(/\\([<>_])/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

  let out = '';
  let pos = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const start = m.index;
    let end = start + m[0].length;
    const bracketedRaw = m[1];
    const name = normaliseName(bracketedRaw ?? m[3]);
    const marker = m[2] ?? m[4];
    const token = `<${name}>`;
    const entry = vault.resolve(token);

    out += text.slice(pos, start);
    pos = end;

    if (!entry) {
      problems.push({ kind: 'unknown-token', token: m[0] });
      out += m[0];
      continue;
    }
    if (INTERNAL_KINDS.includes(entry.kind)) {
      problems.push({ kind: 'internal-token', token: m[0] });
      out += m[0];
      continue;
    }

    const window = text.slice(Math.max(0, start - 60), end + 60).replace(TOKEN_RE, ' ');
    const lang = scriptOf(window);

    let grammaticalCase: Case = 'nom';
    let style: TokenStyle =
      bracketedRaw === undefined ? 'bare' : bracketedRaw === name && m[0] === `<${name}>` ? 'exact' : 'mangled';
    if (marker && isCase(marker)) {
      grammaticalCase = marker;
      if (style === 'exact' || m[0] === `<${name}:${marker}>`) style = 'marker';
    } else if (lang === 'ru' && CUSTOMER_NAME_KINDS.includes(entry.kind)) {
      const glued = GLUED.exec(text.slice(end));
      const guessed = glued ? caseFromGluedSuffix(glued[1]) : undefined;
      if (glued && guessed) {
        grammaticalCase = guessed;
        end += glued[1].length;
        pos = end;
        style = 'glued';
      }
    }
    styles[style]++;
    tokens.push({ token: m[0], kind: entry.kind, style, lang, case: grammaticalCase });

    if (CUSTOMER_NAME_KINDS.includes(entry.kind)) out += renderName(customer, entry.kind, lang, grammaticalCase);
    else if (entry.kind === 'DATE') out += renderDate(entry.value, lang);
    else if (entry.kind === 'AMOUNT') out += renderAmount(entry.value, lang);
    else out += entry.value; // ID, card ending, phone, e-mail: as is
  }
  out += text.slice(pos);

  return { ok: problems.length === 0, text: out, problems, styles, tokens };
}

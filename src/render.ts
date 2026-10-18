/** Render a real value in the language of the surrounding reply. */
import { inflect, type NamePart } from './ru-names.js';
import type { Case, Customer, Kind, Lang } from './types.js';

const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Language of a stretch of text by majority script. */
export function scriptOf(text: string): Lang {
  const he = (text.match(/[֐-׿]/g) ?? []).length;
  const ru = (text.match(/[а-яё]/gi) ?? []).length;
  const en = (text.match(/[a-z]/gi) ?? []).length;
  if (he >= ru && he >= en && he > 0) return 'he';
  if (ru >= en && ru > 0) return 'ru';
  return 'en';
}

function pick(names: Partial<Record<Lang, string>>, lang: Lang): string {
  return names[lang] ?? names.en ?? names.ru ?? names.he ?? '';
}

export function renderName(customer: Customer, kind: Kind, lang: Lang, grammaticalCase: Case = 'nom'): string {
  const decline = (w: string, part: NamePart) => (lang === 'ru' ? inflect(w, grammaticalCase, customer.gender, part) : w);
  const first = decline(pick(customer.firstName, lang), 'first');
  const last = decline(pick(customer.lastName, lang), 'last');
  if (kind === 'CUSTOMER_FIRST_NAME') return first;
  if (kind === 'CUSTOMER_LAST_NAME') return last;
  return `${first} ${last}`;
}

export function renderDate(isoDate: string, lang: Lang): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (lang === 'ru') return `${d} ${RU_MONTHS[m - 1]} ${y}`;
  if (lang === 'he') return `${d} ב${HE_MONTHS[m - 1]} ${y}`;
  return `${EN_MONTHS[m - 1]} ${d}, ${y}`;
}

export function renderAmount(value: string, lang: Lang): string {
  const n = Number(value);
  const opts = { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 };
  if (lang === 'ru') return `${n.toLocaleString('ru-RU', opts).replace(/ /g, ' ')} ₪`;
  if (lang === 'he') return `${n.toLocaleString('en-US', opts)} ₪`;
  return `₪${n.toLocaleString('en-US', opts)}`;
}

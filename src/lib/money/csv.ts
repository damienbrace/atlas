// Reading bank CSV exports. Safe in the browser (preview and column picking) and on
// the server. Australian banks differ: CommBank and ANZ have no header row (date,
// amount, description[, balance]); Westpac, NAB, Bankwest, Up and others name their
// columns, sometimes with separate debit and credit columns. Columns are found by
// name where there's a header, and by what the cells look like otherwise.

export type DateOrder = "dmy" | "mdy" | "ymd";

export interface Mapping {
  hasHeader: boolean;
  date: number;
  description: number;
  /** Who was paid, when the bank keeps it apart from the description (Up, NAB). */
  payee: number | null;
  /** One signed amount column, or else separate debit and credit columns. */
  amount: number | null;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  /** Each row's account, for exports that cover several (Up's Spending plus savers). */
  account: number | null;
  /** The bank's own transaction type, used only to spot moves between my own accounts. */
  type: number | null;
  dateOrder: DateOrder;
  /** Some card exports show spending as positive; flip so money out is negative. */
  flip: boolean;
}

export interface CsvRow {
  day: string;
  amountCents: number;
  description: string;
  balanceCents: number | null;
  /** The row's own account, when the file says; otherwise the upload's. */
  account: string | null;
  /** The bank marked it as a move between my own accounts (Up's "Transfer" and "Round Up"). */
  transfer: boolean;
  /** Nth identical transaction (same day, amount and description) in the file. */
  seq: number;
}

const BOM = String.fromCharCode(0xfeff);

/** Splits CSV text into trimmed cells. Handles quotes, "" escapes and CRLF; drops empty rows. */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  const lineEnd = source.indexOf("\n");
  const firstLine = lineEnd === -1 ? source : source.slice(0, lineEnd);
  const delimiter = [",", ";", "\t"].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ",");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (source[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((cell) => cell.trim())).filter((r) => r.some((cell) => cell !== ""));
}

// ---- Values -----------------------------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthNumber = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

function toDay(y: number, m: number, d: number) {
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// "(?!\d)" rather than "\b" so a time can follow straight on, as in "2026-10-03T09:15:00+08:00".
const NUMERIC_DATE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?!\d)/;

/** "03/10/2026", "3/10/26", "2026-10-03", "2026-10-03T09:15:00+08:00", "03 Oct 2026", "03-Oct-26" → "2026-10-03". */
export function parseDate(text: string, order: DateOrder = "dmy"): string | null {
  const s = text.trim();
  // A date with a time keeps the date as written: that's the bank's local day.
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/);
  if (m) return toDay(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/. ]+([A-Za-z]{3,9})[-/., ]+(\d{2}|\d{4})(?!\d)/);
  if (m && monthNumber(m[2])) return toDay(fullYear(+m[3]), monthNumber(m[2]), +m[1]);
  m = s.match(/^([A-Za-z]{3,9})[ -]+(\d{1,2}),?[ -]+(\d{4})(?!\d)/);
  if (m && monthNumber(m[1])) return toDay(+m[3], monthNumber(m[1]), +m[2]);
  m = s.match(NUMERIC_DATE);
  if (m) {
    const [day, month] = order === "mdy" ? [+m[2], +m[1]] : [+m[1], +m[2]];
    return toDay(fullYear(+m[3]), month, day);
  }
  return null;
}

/** Australian banks write day first; only switch when a value proves otherwise. */
export function guessDateOrder(values: string[]): DateOrder {
  let firstOver12 = false;
  let secondOver12 = false;
  for (const v of values) {
    const m = v.trim().match(NUMERIC_DATE);
    if (!m) continue;
    if (+m[1] > 12) firstOver12 = true;
    if (+m[2] > 12) secondOver12 = true;
  }
  return secondOver12 && !firstOver12 ? "mdy" : "dmy";
}

/** "-1,234.50", "$12.00", "+5", "(12.50)", "12.50 DR" → cents. Empty or not a number → null. */
export function parseAmount(text: string): number | null {
  let s = text.trim();
  if (!s) return null;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\s*DR$/i.test(s)) {
    negative = !negative;
    s = s.replace(/\s*DR$/i, "");
  }
  s = s.replace(/\s*CR$/i, "").replace(/^AUD/i, "").replace(/[$\s]/g, "");
  // A decimal comma ("33,00" or "1.234,56") has two digits after it; a thousands comma has three.
  if (/^[-−+]?(\d{1,3}(\.\d{3})+|\d+),\d{2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  s = s.replace(/,/g, "");
  if (s.startsWith("-") || s.startsWith("−")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  return negative ? -cents : cents;
}

// ---- Working out the columns --------------------------------------------------

type Role = "date" | "description" | "payee" | "amount" | "debit" | "credit" | "balance" | "account" | "type";

// Names banks give their columns, best first (lowercase, letters and spaces only).
const HEADER_NAMES: Record<Role, string[]> = {
  date: ["date", "transaction date", "time", "transaction time", "date time", "datetime", "created", "created at", "posted date", "posting date", "effective date", "processed date", "completed date", "value date", "settled date"],
  description: ["description", "transaction details", "narrative", "narration", "details", "transaction description", "memo", "particulars", "reference"],
  payee: ["payee", "merchant name", "merchant", "counterparty", "name"],
  // Up's Subtotal is the purchase itself; its Total adds the round-up that goes to a saver.
  amount: ["amount", "transaction amount", "amount aud", "subtotal aud", "total aud", "net amount", "value", "total"],
  debit: ["debit", "debit amount", "debits", "debit aud", "withdrawal", "withdrawals", "withdrawal amount", "money out", "paid out"],
  credit: ["credit", "credit amount", "credits", "credit aud", "deposit", "deposits", "deposit amount", "money in", "paid in"],
  balance: ["balance", "running balance", "closing balance", "balance aud"],
  account: ["account name", "account nickname", "account"],
  type: ["transaction type", "type"],
};

// Only types that always mean "between my own accounts". Others ("TFR", "Transfer debit") can be
// payments to other people, so those are left for Atlas to read.
const OWN_ACCOUNT_TYPES = /^(transfer|round ?up|internal transfer|transfer between (my )?accounts)$/i;

const headerName = (cell: string) => cell.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();

const share = (values: string[], test: (v: string) => boolean) =>
  values.length ? values.filter(test).length / values.length : 0;

/** Best guess at the columns, or null if it can't find a date, a description and an amount. */
export function detectMapping(rows: string[][]): Mapping | null {
  if (rows.length === 0) return null;
  const width = Math.max(...rows.slice(0, 30).map((r) => r.length));
  const indexes = Array.from({ length: width }, (_, i) => i);
  const first = rows[0];
  // Every transaction has a date, so a first row without one is the column names.
  const hasHeader = rows.length > 1 && !first.some((cell) => parseDate(cell) !== null);
  const sample = rows.slice(hasHeader ? 1 : 0, 31);
  const column = (i: number) => sample.map((r) => r[i] ?? "");
  const filled = (i: number) => column(i).filter((v) => v !== "");

  // Either day-first or month-first counts here; guessDateOrder settles which one below.
  const isDate = (i: number) => share(column(i), (v) => parseDate(v, "dmy") !== null || parseDate(v, "mdy") !== null) >= 0.8;
  // Debit and credit columns are half empty, so judge numbers by the cells that have something.
  const isNumber = (i: number) => filled(i).length > 0 && share(filled(i), (v) => parseAmount(v) !== null) >= 0.8;
  const isText = (i: number) => filled(i).length > 0 && share(filled(i), (v) => /[a-z]/i.test(v) && parseAmount(v) === null) >= 0.8;
  const letters = (i: number) => column(i).reduce((sum, v) => sum + (v.match(/[a-z]/gi)?.length ?? 0), 0);

  // A named column only counts if its cells look right, so a mislabelled export can't fool it.
  const names = hasHeader ? first.map(headerName) : [];
  // Account numbers, BSBs and references are numbers too, but never the amount.
  const isId = (i: number) => /\b(account|bsb|number|no|cheque|serial|reference|ref|id|card)\b/.test(names[i] ?? "");
  // A named debit or credit column can be empty in the sample (a page of only spending).
  const isMoneyColumn = (i: number) => filled(i).length === 0 || isNumber(i);
  const named = (role: Role, fits: (i: number) => boolean) => {
    for (const name of HEADER_NAMES[role]) {
      const i = names.indexOf(name);
      if (i !== -1 && fits(i)) return i;
    }
    return null;
  };

  const date = named("date", isDate) ?? indexes.find(isDate) ?? null;
  if (date === null) return null;
  const numbers = indexes.filter((i) => i !== date && isNumber(i) && !isId(i));

  let amount = named("amount", isNumber);
  let debit = named("debit", isMoneyColumn);
  let credit = named("credit", isMoneyColumn);
  if (amount !== null || debit === null || credit === null || (!isNumber(debit) && !isNumber(credit))) [debit, credit] = [null, null];
  const balanceByName = named("balance", isNumber);
  if (amount === null && debit === null) amount = numbers.find((i) => i !== balanceByName) ?? null;
  if (amount === null && debit === null) return null;
  // Without names, the number after the amount is usually the running balance (CommBank).
  const balance = balanceByName ?? (hasHeader ? null : (numbers.find((i) => i !== amount) ?? null));

  const used = new Set([date, amount, debit, credit, balance].filter((i) => i !== null));
  const payee = named("payee", isText);
  const description =
    named("description", (i) => isText(i) || filled(i).length < column(i).length) ??
    payee ??
    indexes.filter((i) => !used.has(i) && !numbers.includes(i) && !isDate(i)).sort((a, b) => letters(b) - letters(a))[0] ??
    null;
  if (description === null) return null;

  return {
    hasHeader,
    date,
    description,
    payee: payee !== description ? payee : null,
    amount,
    debit,
    credit,
    balance,
    account: named("account", isText),
    type: named("type", isText),
    dateOrder: guessDateOrder(column(date)),
    flip: false,
  };
}

/** The description, with the payee in front when the description leaves them out (Up: "Transfer" to "Japan"). */
function describe(description: string, payee: string) {
  if (!payee) return description;
  if (!description) return payee;
  return description.toLowerCase().includes(payee.toLowerCase()) ? description : `${payee} · ${description}`;
}

const tidy = (text: string | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/** The transactions in the file, plus how many rows couldn't be read. */
export function readRows(rows: string[][], mapping: Mapping): { rows: CsvRow[]; unreadable: number } {
  const out: CsvRow[] = [];
  const seen = new Map<string, number>();
  let unreadable = 0;
  for (const r of rows.slice(mapping.hasHeader ? 1 : 0)) {
    const day = parseDate(r[mapping.date] ?? "", mapping.dateOrder);
    const description = describe(tidy(r[mapping.description]), mapping.payee !== null ? tidy(r[mapping.payee]) : "").slice(0, 300);
    let amount: number | null;
    if (mapping.amount !== null) amount = parseAmount(r[mapping.amount] ?? "");
    else {
      const debit = parseAmount(r[mapping.debit ?? -1] ?? "");
      const credit = parseAmount(r[mapping.credit ?? -1] ?? "");
      amount = debit === null && credit === null ? null : Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (!day || amount === null || !description) {
      unreadable++;
      continue;
    }
    const amountCents = mapping.flip ? -amount : amount;
    const account = mapping.account !== null ? tidy(r[mapping.account]).slice(0, 60) || null : null;
    const key = `${account}|${day}|${amountCents}|${description}`;
    const seq = seen.get(key) ?? 0;
    seen.set(key, seq + 1);
    const balance = mapping.balance !== null ? parseAmount(r[mapping.balance] ?? "") : null;
    const transfer = mapping.type !== null && OWN_ACCOUNT_TYPES.test(tidy(r[mapping.type]));
    out.push({ day, amountCents, description, balanceCents: balance, account, transfer, seq });
  }
  return { rows: out, unreadable };
}

export type TransactionKind = "CASH_IN" | "CASH_OUT" | "TRANSFER" | "EXPENSE";

export type AccountId =
  | "cash-drawer"
  | "kbzpay"
  | "wavemoney"
  | "ayapay"
  | "kbzmmqr"
  | "ayammqr"
  | "kbzbank"
  | "ayabank";

export interface AccountDefinition {
  id: AccountId;
  name: string;
  shortName: string;
  kind: "cash" | "wallet" | "qr" | "bank";
  color: string;
  mark: string;
}

export interface DailySession {
  date: string;
  openingBalance: number;
  closingBalance: number | null;
  openedAt: string;
  closedAt: string | null;
}

export interface LedgerTransaction {
  id: string;
  date: string;
  time: string;
  kind: TransactionKind;
  customer: string;
  phone: string;
  amount: number;
  commission: number;
  note: string;
  fromAccountId: AccountId;
  toAccountId: AccountId | null;
}

export interface LedgerData {
  sessions: DailySession[];
  transactions: LedgerTransaction[];
}

export const STORAGE_KEY = "cash-ledger-v1";

export const accounts: AccountDefinition[] = [
  { id: "cash-drawer", name: "Cash in drawer", shortName: "Cash drawer", kind: "cash", color: "mint", mark: "C" },
  { id: "kbzpay", name: "KBZPay", shortName: "KBZPay", kind: "wallet", color: "sky", mark: "K" },
  { id: "wavemoney", name: "Wave Money", shortName: "Wave Money", kind: "wallet", color: "gold", mark: "W" },
  { id: "ayapay", name: "AYA Pay", shortName: "AYA Pay", kind: "wallet", color: "rose", mark: "A" },
  { id: "kbzmmqr", name: "KBZ MMQR", shortName: "KBZ MMQR", kind: "qr", color: "sky", mark: "Q" },
  { id: "ayammqr", name: "AYA MMQR", shortName: "AYA MMQR", kind: "qr", color: "rose", mark: "Q" },
  { id: "kbzbank", name: "KBZ Bank", shortName: "KBZ Bank", kind: "bank", color: "gold", mark: "B" },
  { id: "ayabank", name: "AYA Bank", shortName: "AYA Bank", kind: "bank", color: "rose", mark: "B" },
];

export const emptyLedger = (): LedgerData => ({ sessions: [], transactions: [] });

export function formatMMK(amount: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount);
}

export function kindLabel(kind: TransactionKind): string {
  return {
    CASH_IN: "Cash in",
    CASH_OUT: "Cash out",
    TRANSFER: "Transfer",
    EXPENSE: "Expense",
  }[kind];
}

export function computeSystemClosing(openingBalance: number, dayTransactions: LedgerTransaction[]): number {
  const cashIn = dayTransactions
    .filter((transaction) => transaction.kind === "CASH_IN")
    .reduce((total, transaction) => total + transaction.amount, 0);
  const cashOut = dayTransactions
    .filter((transaction) => transaction.kind === "CASH_OUT" || transaction.kind === "EXPENSE")
    .reduce((total, transaction) => total + transaction.amount, 0);
  const commissions = dayTransactions.reduce((total, transaction) => total + transaction.commission, 0);

  return openingBalance + cashIn - cashOut + commissions;
}

export function computeAccountBalances(
  openingBalance: number,
  dayTransactions: LedgerTransaction[],
): Record<AccountId, number> {
  const balances = Object.fromEntries(accounts.map((account) => [account.id, 0])) as Record<AccountId, number>;
  balances["cash-drawer"] = openingBalance;

  for (const transaction of dayTransactions) {
    balances[transaction.fromAccountId] -= transaction.amount;
    if (transaction.toAccountId) balances[transaction.toAccountId] += transaction.amount;
    balances["cash-drawer"] += transaction.commission;
  }

  return balances;
}

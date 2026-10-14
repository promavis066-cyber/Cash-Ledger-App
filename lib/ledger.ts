export type TransactionKind = "CASH_IN" | "CASH_OUT" | "TRANSFER" | "EXPENSE";

export type AccountId = string;

export type AccountKind = "cash" | "wallet" | "qr" | "bank";

export interface AccountDefinition {
  id: AccountId;
  name: string;
  shortName: string;
  kind: AccountKind;
  accountNumber: string;
  color: string;
  mark: string;
  deletedAt?: string | null;
}

export interface SessionAccountBalances {
  opening: Record<AccountId, number>;
  groundClosing: Record<AccountId, number | null>;
}

export interface AuditCheckpoint {
  id: string;
  timestamp: string;
  expectedCash: number;
  countedCash: number;
  variance: number;
  stackAmounts: number[];
  afterTransactionId: string | null;
}

export interface DailySession {
  date: string;
  activeAccountIds: AccountId[];
  accountBalances: SessionAccountBalances;
  auditCheckpoints?: AuditCheckpoint[];
  /** Legacy fields retained so saved sessions from v1 remain readable. */
  openingBalance: number;
  closingBalance: number | null;
  openedAt: string;
  closedAt: string | null;
}

export interface LedgerTransaction {
  id: string;
  user_id?: string;
  session_id?: string | null;
  created_at?: string;
  createdAt?: string;
  recorded_at?: string;
  timestamp?: string;
  updated_at?: string | null;
  date: string;
  time: string;
  kind: TransactionKind;
  customer: string;
  phone: string;
  amount: number;
  commission: number;
  commissionAccountId?: AccountId;
  commission_wallet?: string;
  commission_wallet_id?: string;
  commissionReceivedIn?: string;
  commission_location?: string;
  note: string;
  fromAccountId: AccountId;
  toAccountId: AccountId | null;
}

export interface LedgerData {
  accounts: AccountDefinition[];
  sessions: DailySession[];
  transactions: LedgerTransaction[];
}

export const defaultAccounts: AccountDefinition[] = [
  {
    id: "cash-drawer",
    name: "Cash in drawer",
    shortName: "Cash drawer",
    kind: "cash",
    accountNumber: "",
    color: "mint",
    mark: "C",
  },
  {
    id: "kbzpay",
    name: "KBZPay",
    shortName: "KBZPay",
    kind: "wallet",
    accountNumber: "",
    color: "sky",
    mark: "K",
  },
  {
    id: "wavemoney",
    name: "Wave Money",
    shortName: "Wave Money",
    kind: "wallet",
    accountNumber: "",
    color: "gold",
    mark: "W",
  },
  {
    id: "ayapay",
    name: "AYA Pay",
    shortName: "AYA Pay",
    kind: "wallet",
    accountNumber: "",
    color: "rose",
    mark: "A",
  },
  {
    id: "kbzmmqr",
    name: "KBZ MMQR",
    shortName: "KBZ MMQR",
    kind: "qr",
    accountNumber: "",
    color: "sky",
    mark: "Q",
  },
  {
    id: "ayammqr",
    name: "AYA MMQR",
    shortName: "AYA MMQR",
    kind: "qr",
    accountNumber: "",
    color: "rose",
    mark: "Q",
  },
  {
    id: "kbzbank",
    name: "KBZ Bank",
    shortName: "KBZ Bank",
    kind: "bank",
    accountNumber: "",
    color: "gold",
    mark: "B",
  },
  {
    id: "ayabank",
    name: "AYA Bank",
    shortName: "AYA Bank",
    kind: "bank",
    accountNumber: "",
    color: "rose",
    mark: "B",
  },
];

export const emptyLedger = (): LedgerData => ({
  accounts: defaultAccounts.map((account) => ({ ...account })),
  sessions: [],
  transactions: [],
});

function firstValidTimestamp(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string =>
      typeof value === "string" &&
      value.length > 0 &&
      Number.isFinite(new Date(value).getTime()),
  );
}

function isAuditCheckpoint(value: unknown): value is AuditCheckpoint {
  if (value === null || typeof value !== "object") return false;
  if (
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("timestamp" in value) ||
    typeof value.timestamp !== "string" ||
    !Number.isFinite(new Date(value.timestamp).getTime()) ||
    !("expectedCash" in value) ||
    typeof value.expectedCash !== "number" ||
    !Number.isFinite(value.expectedCash) ||
    !("countedCash" in value) ||
    typeof value.countedCash !== "number" ||
    !Number.isFinite(value.countedCash) ||
    !("variance" in value) ||
    typeof value.variance !== "number" ||
    !Number.isFinite(value.variance) ||
    !("stackAmounts" in value) ||
    !Array.isArray(value.stackAmounts) ||
    !value.stackAmounts.every(
      (amount) => typeof amount === "number" && Number.isFinite(amount),
    ) ||
    !("afterTransactionId" in value) ||
    (value.afterTransactionId !== null &&
      typeof value.afterTransactionId !== "string")
  ) {
    return false;
  }
  return true;
}

export function normalizeLedger(value: unknown): LedgerData {
  if (!value || typeof value !== "object") return emptyLedger();
  const saved = value as Partial<LedgerData>;
  const accountList =
    Array.isArray(saved.accounts) && saved.accounts.length
      ? saved.accounts
      : defaultAccounts;
  const normalizeCommissionAccount = (
    transaction: LedgerTransaction,
  ): AccountId => {
    const candidates = [
      transaction.commissionAccountId,
      transaction.commission_wallet_id,
      transaction.commission_wallet,
      transaction.commissionReceivedIn,
      transaction.commission_location,
    ].filter((candidate): candidate is string => typeof candidate === "string");

    for (const candidate of candidates) {
      const normalizedCandidate = candidate.trim().toLocaleLowerCase();
      if (!normalizedCandidate) continue;
      const matchingAccount = accountList.find(
        (account) =>
          account.id.toLocaleLowerCase() === normalizedCandidate ||
          account.name.trim().toLocaleLowerCase() === normalizedCandidate ||
          account.shortName.trim().toLocaleLowerCase() === normalizedCandidate,
      );
      if (matchingAccount) return matchingAccount.id;
      if (
        normalizedCandidate === "cash" ||
        normalizedCandidate.includes("cash drawer") ||
        normalizedCandidate.includes("cash in drawer")
      ) {
        return "cash-drawer";
      }
    }
    return "cash-drawer";
  };
  const transactions = Array.isArray(saved.transactions)
    ? saved.transactions.map((transaction) => ({
        ...transaction,
        created_at: firstValidTimestamp(
          transaction.created_at,
          transaction.createdAt,
          transaction.recorded_at,
          transaction.timestamp,
        ),
        commissionAccountId: normalizeCommissionAccount(transaction),
      }))
    : [];
  const sessions = Array.isArray(saved.sessions)
    ? saved.sessions.map((session) => {
        const legacyOpening = Number(session.openingBalance) || 0;
        const activeAccountIds = Array.isArray(session.activeAccountIds)
          ? session.activeAccountIds
          : accountList
              .filter((account) => !account.deletedAt)
              .map((account) => account.id);
        const opening =
          session.accountBalances?.opening ??
          Object.fromEntries(
            activeAccountIds.map((id) => [
              id,
              id === "cash-drawer" ? legacyOpening : 0,
            ]),
          );
        const groundClosing =
          session.accountBalances?.groundClosing ??
          Object.fromEntries(
            activeAccountIds.map((id) => [
              id,
              id === "cash-drawer" ? (session.closingBalance ?? null) : null,
            ]),
          );
        return {
          ...session,
          activeAccountIds,
          accountBalances: { opening, groundClosing },
          auditCheckpoints: Array.isArray(session.auditCheckpoints)
            ? session.auditCheckpoints.filter(isAuditCheckpoint)
            : [],
        };
      })
    : [];

  return {
    accounts: accountList.map((account) => ({
      ...account,
      accountNumber: account.accountNumber ?? "",
    })),
    sessions,
    transactions,
  };
}

export function formatMMK(amount: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    amount,
  );
}

export function kindLabel(kind: TransactionKind): string {
  return {
    CASH_IN: "Cash in",
    CASH_OUT: "Cash out",
    TRANSFER: "Transfer",
    EXPENSE: "Expense",
  }[kind];
}

export function computeSystemClosing(
  openingBalance: number,
  dayTransactions: LedgerTransaction[],
): number {
  const cashIn = dayTransactions
    .filter((transaction) => transaction.kind === "CASH_IN")
    .reduce((total, transaction) => total + transaction.amount, 0);
  const cashOut = dayTransactions
    .filter(
      (transaction) =>
        transaction.kind === "CASH_OUT" || transaction.kind === "EXPENSE",
    )
    .reduce((total, transaction) => total + transaction.amount, 0);
  const commissions = dayTransactions.reduce(
    (total, transaction) =>
      total +
      ((transaction.commissionAccountId ?? "cash-drawer") === "cash-drawer"
        ? transaction.commission
        : 0),
    0,
  );

  return openingBalance + cashIn - cashOut + commissions;
}

export function computeAccountBalances(
  accountList: AccountDefinition[],
  openingBalances: Record<AccountId, number>,
  dayTransactions: LedgerTransaction[],
  activeAccountIds: AccountId[],
): Record<AccountId, number> {
  const activeIds = new Set(activeAccountIds);
  const balances = Object.fromEntries(
    accountList.map((account) => [account.id, 0]),
  ) as Record<AccountId, number>;
  for (const id of activeIds) balances[id] = openingBalances[id] ?? 0;

  for (const transaction of dayTransactions) {
    if (!activeIds.has(transaction.fromAccountId)) continue;
    balances[transaction.fromAccountId] -= transaction.amount;
    if (transaction.toAccountId && activeIds.has(transaction.toAccountId))
      balances[transaction.toAccountId] += transaction.amount;
    const commissionAccountId =
      transaction.commissionAccountId ?? "cash-drawer";
    if (activeIds.has(commissionAccountId))
      balances[commissionAccountId] += transaction.commission;
  }

  return balances;
}

export function accountClosingBalances(
  accountList: AccountDefinition[],
  openingBalances: Record<AccountId, number>,
  dayTransactions: LedgerTransaction[],
  activeAccountIds: AccountId[],
): Record<AccountId, number> {
  return computeAccountBalances(
    accountList,
    openingBalances,
    dayTransactions,
    activeAccountIds,
  );
}

export function accountDifference(
  systemClosing: number,
  groundClosing: number | null | undefined,
): number | null {
  return groundClosing == null ? null : groundClosing - systemClosing;
}

"use client";

import {
  Activity,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock3,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  Pencil,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  Search,
  Trash2,
  TrendingUp,
  WalletCards,
  X,
} from "lucide-react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  accountClosingBalances,
  accountDifference,
  emptyLedger,
  formatMMK,
  kindLabel,
  LedgerData,
  LedgerTransaction,
  TransactionKind,
  AccountDefinition,
  AccountId,
  AccountKind,
  STORAGE_KEY,
  normalizeLedger,
} from "@/lib/ledger";

type ModalKind = "open" | "close" | "accounts" | "admin" | null;
type AppTab =
  | "overview"
  | "wallet"
  | "transactions"
  | "reconciliation"
  | "reports";
type IconComponent = typeof Activity;
type AdminAction = "reopen" | "date";

const ADMIN_PASSWORD = "admin";
const accountColorOptions = [
  {
    id: "mint",
    name: "Cash green",
    swatch: "#c6f36b",
    badge: "bg-[#e6f4cf] text-[#43712c]",
  },
  {
    id: "sky",
    name: "KPay blue",
    swatch: "#64b5f6",
    badge: "bg-[#dceffd] text-[#27618c]",
  },
  {
    id: "gold",
    name: "Wave yellow",
    swatch: "#f2c77d",
    badge: "bg-[#fff1d6] text-[#9b7530]",
  },
  {
    id: "rose",
    name: "AYA coral",
    swatch: "#edaaa7",
    badge: "bg-[#f8e6e5] text-[#a46060]",
  },
  {
    id: "violet",
    name: "Violet",
    swatch: "#b8a6e8",
    badge: "bg-[#eee9fa] text-[#685293]",
  },
  {
    id: "slate",
    name: "Slate",
    swatch: "#a5b1ad",
    badge: "bg-[#e9edeb] text-[#586660]",
  },
];

function accountColorBadge(color: string) {
  return (
    accountColorOptions.find((option) => option.id === color)?.badge ??
    accountColorOptions[0].badge
  );
}

function AccountBadge({
  account,
  compact = false,
}: {
  account: AccountDefinition;
  compact?: boolean;
}) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-[6px] ${compact ? "px-1.5 py-0.5 text-[8px]" : "px-2 py-1 text-[9px]"} font-medium ${accountColorBadge(account.color)}`}
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{
          backgroundColor:
            accountColorOptions.find((option) => option.id === account.color)
              ?.swatch ?? "#c6f36b",
        }}
      />
      {account.shortName}
    </span>
  );
}

function TransactionChannels({
  accountList,
  transaction,
}: {
  accountList: AccountDefinition[];
  transaction: LedgerTransaction;
}) {
  const from = accountList.find(
    (account) => account.id === transaction.fromAccountId,
  );
  const to = accountList.find(
    (account) => account.id === transaction.toAccountId,
  );
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {from && <AccountBadge account={from} compact />}
      {to && (
        <>
          <span className="text-[#98a39b]">→</span>
          <AccountBadge account={to} compact />
        </>
      )}
    </span>
  );
}

const kindIcons: Record<TransactionKind, IconComponent> = {
  CASH_IN: ArrowDownLeft,
  CASH_OUT: ArrowUpRight,
  TRANSFER: ArrowLeftRight,
  EXPENSE: ReceiptText,
};
const kindColors: Record<TransactionKind, string> = {
  CASH_IN: "bg-[#e9f6d9] text-[#437629]",
  CASH_OUT: "bg-[#ffede7] text-[#b35c3b]",
  TRANSFER: "bg-[#e8f2f9] text-[#477a9c]",
  EXPENSE: "bg-[#f3edf5] text-[#835b8b]",
};

function getDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function formatDate(
  dateKey: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  },
) {
  return new Intl.DateTimeFormat("en-US", options).format(
    new Date(`${dateKey}T12:00:00`),
  );
}

function accountName(accountList: AccountDefinition[], id: AccountId | null) {
  return (
    accountList.find((account) => account.id === id)?.shortName ??
    "Unknown account"
  );
}

function transactionParty(
  accountList: AccountDefinition[],
  transaction: LedgerTransaction,
) {
  if (transaction.kind === "TRANSFER")
    return `${accountName(accountList, transaction.fromAccountId)} → ${accountName(accountList, transaction.toAccountId)}`;
  if (transaction.kind === "CASH_IN")
    return `${accountName(accountList, transaction.fromAccountId)} → ${accountName(accountList, transaction.toAccountId)}`;
  if (transaction.kind === "CASH_OUT")
    return `${accountName(accountList, transaction.fromAccountId)} → ${accountName(accountList, transaction.toAccountId)}`;
  return `Paid from ${accountName(accountList, transaction.fromAccountId)}`;
}

function commissionAccountId(transaction: LedgerTransaction): AccountId {
  return transaction.commissionAccountId ?? "cash-drawer";
}

export default function Home() {
  const today = getDateKey(new Date());
  const [activeDate, setActiveDate] = useState(today);
  const [unlockedDate, setUnlockedDate] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerData>(emptyLedger);
  const [hydrated, setHydrated] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("overview");
  const [adminAction, setAdminAction] = useState<AdminAction>("reopen");
  const [pendingDate, setPendingDate] = useState(today);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminError, setAdminError] = useState("");
  const [editingTransactionId, setEditingTransactionId] = useState<
    string | null
  >(null);
  const [transactionKind, setTransactionKind] =
    useState<TransactionKind>("CASH_IN");
  const [serviceAccountId, setServiceAccountId] = useState<AccountId>("kbzpay");
  const [fromAccountId, setFromAccountId] = useState<AccountId>("kbzpay");
  const [toAccountId, setToAccountId] = useState<AccountId>("wavemoney");
  const [commissionDestinationId, setCommissionDestinationId] =
    useState("cash-drawer");
  const [accountForm, setAccountForm] = useState<
    Pick<
      AccountDefinition,
      "name" | "shortName" | "kind" | "accountNumber" | "color"
    >
  >({
    name: "",
    shortName: "",
    kind: "wallet",
    accountNumber: "",
    color: "sky",
  });
  const [editingAccountId, setEditingAccountId] = useState<AccountId | null>(
    null,
  );
  const [openingAccountIds, setOpeningAccountIds] = useState<AccountId[]>([]);
  const [openingAmounts, setOpeningAmounts] = useState<
    Record<AccountId, string>
  >({});
  const [closingAmounts, setClosingAmounts] = useState<
    Record<AccountId, string>
  >({});
  const [amountInput, setAmountInput] = useState("");
  const [commissionInput, setCommissionInput] = useState("");
  const [customerInput, setCustomerInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const savedLedger = window.localStorage.getItem(STORAGE_KEY);
        if (savedLedger) {
          const parsed = JSON.parse(savedLedger) as LedgerData;
          setLedger(normalizeLedger(parsed));
        }
      } catch {
        setMessage("Saved ledger data could not be read on this device.");
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (hydrated)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
  }, [hydrated, ledger]);

  const todaySession =
    ledger.sessions.find((session) => session.date === activeDate) ?? null;
  const accounts = ledger.accounts.filter((account) => !account.deletedAt);
  const todayActiveAccounts = todaySession
    ? ledger.accounts.filter((account) =>
        todaySession.activeAccountIds.includes(account.id),
      )
    : [];
  const openingAccounts = todaySession
    ? ledger.accounts.filter((account) =>
        todaySession.activeAccountIds.includes(account.id),
      )
    : accounts;
  const todayTransactions = useMemo(
    () =>
      ledger.transactions.filter(
        (transaction) => transaction.date === activeDate,
      ),
    [ledger.transactions, activeDate],
  );
  const filteredTransactions = useMemo(
    () =>
      ledger.transactions.filter(
        (transaction) =>
          transaction.date >= dateFrom && transaction.date <= dateTo,
      ),
    [dateFrom, dateTo, ledger.transactions],
  );
  const openingBalances = todaySession?.accountBalances.opening ?? {};
  const accountBalances = accountClosingBalances(
    ledger.accounts,
    openingBalances,
    todayTransactions,
    todaySession?.activeAccountIds ?? [],
  );
  const openingBalance = openingBalances["cash-drawer"] ?? 0;
  const systemClosing =
    todaySession?.activeAccountIds.reduce(
      (total, id) => total + (accountBalances[id] ?? 0),
      0,
    ) ?? 0;
  const commissions = todayTransactions.reduce(
    (total, transaction) => total + transaction.commission,
    0,
  );
  const cashInTotal = todayTransactions
    .filter((transaction) => transaction.kind === "CASH_IN")
    .reduce((total, transaction) => total + transaction.amount, 0);
  const cashOutTotal = todayTransactions
    .filter((transaction) => transaction.kind === "CASH_OUT")
    .reduce((total, transaction) => total + transaction.amount, 0);
  const expenseTotal = todayTransactions
    .filter((transaction) => transaction.kind === "EXPENSE")
    .reduce((total, transaction) => total + transaction.amount, 0);
  const balances = accountBalances;
  const isUnlocked = unlockedDate === activeDate;
  const isOpen = Boolean(
    todaySession && (todaySession.closedAt === null || isUnlocked),
  );
  const isClosed = Boolean(todaySession?.closedAt && !isUnlocked);
  const transactionAccounts = isOpen
    ? todayActiveAccounts.filter((account) => !account.deletedAt)
    : accounts;
  const closingDifference =
    todaySession?.closingBalance == null
      ? null
      : todaySession.closingBalance - systemClosing;
  const reportSessions = ledger.sessions
    .filter((session) => session.date >= dateFrom && session.date <= dateTo)
    .sort((left, right) => left.date.localeCompare(right.date));
  const reportDailyRows = reportSessions.flatMap((session) => {
    const dayTransactions = filteredTransactions.filter(
      (transaction) => transaction.date === session.date,
    );
    const closing = accountClosingBalances(
      ledger.accounts,
      session.accountBalances.opening,
      dayTransactions,
      session.activeAccountIds,
    );
    return session.activeAccountIds.map((id) => {
      const incoming = dayTransactions
        .filter((transaction) => transaction.toAccountId === id)
        .reduce((sum, transaction) => sum + transaction.amount, 0);
      const outgoing = dayTransactions
        .filter((transaction) => transaction.fromAccountId === id)
        .reduce((sum, transaction) => sum + transaction.amount, 0);
      const commission = dayTransactions
        .filter((transaction) => commissionAccountId(transaction) === id)
        .reduce((sum, transaction) => sum + transaction.commission, 0);
      const commissionCredit = dayTransactions
        .filter((transaction) => commissionAccountId(transaction) === id)
        .reduce((sum, transaction) => sum + transaction.commission, 0);
      const system = closing[id] ?? 0;
      const ground = session.accountBalances.groundClosing[id] ?? null;
      return {
        date: session.date,
        accountId: id,
        opening: session.accountBalances.opening[id] ?? 0,
        inflow: incoming + commissionCredit,
        outflow: outgoing,
        commission,
        systemClosing: system,
        groundClosing: ground,
        difference: accountDifference(system, ground),
      };
    });
  });
  const reportAccountIds = new Set(reportDailyRows.map((row) => row.accountId));
  const reportWalletRows = ledger.accounts
    .filter((account) => reportAccountIds.has(account.id))
    .map((account) => {
      const rows = reportDailyRows.filter(
        (row) => row.accountId === account.id,
      );
      return {
        account,
        opening: rows.reduce((sum, row) => sum + row.opening, 0),
        inflow: rows.reduce((sum, row) => sum + row.inflow, 0),
        outflow: rows.reduce((sum, row) => sum + row.outflow, 0),
        commission: rows.reduce((sum, row) => sum + row.commission, 0),
        net: rows.reduce((sum, row) => sum + row.inflow - row.outflow, 0),
        closing: rows.at(-1)?.systemClosing ?? 0,
      };
    });
  const reportOpeningBalance = reportDailyRows
    .filter((row) => row.date === dateFrom)
    .reduce((total, row) => total + row.opening, 0);
  const reportSystemClosing = reportDailyRows
    .filter((row) => row.date === dateTo)
    .reduce((sum, row) => sum + row.systemClosing, 0);
  const reportCommissions = filteredTransactions.reduce(
    (total, transaction) => total + transaction.commission,
    0,
  );

  function notify(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 3500);
  }

  function startOpeningFlow() {
    const activeIds =
      todaySession?.activeAccountIds ?? accounts.map((account) => account.id);
    setOpeningAccountIds(activeIds);
    setOpeningAmounts(
      Object.fromEntries(
        activeIds.map((id) => [
          id,
          String(todaySession?.accountBalances.opening[id] ?? 0),
        ]),
      ),
    );
    setModal("open");
  }

  function startClosingFlow() {
    setClosingAmounts(
      Object.fromEntries(
        todayActiveAccounts.map((account) => [account.id, ""]),
      ),
    );
    setModal("close");
  }

  function requestAdminUnlock(action: AdminAction, date = activeDate) {
    setAdminAction(action);
    setPendingDate(date);
    setAdminPassword("");
    setAdminError("");
    setModal("admin");
  }

  function selectSessionDate(date: string) {
    if (!date || date === activeDate) return;
    if (date < today) {
      requestAdminUnlock("date", date);
      return;
    }
    setUnlockedDate(null);
    setActiveDate(date);
    setDateFrom(date);
    setDateTo(date);
  }

  function confirmAdminUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adminPassword !== ADMIN_PASSWORD) {
      setAdminError("That admin password is not correct.");
      return;
    }
    const targetDate = adminAction === "date" ? pendingDate : activeDate;
    setActiveDate(targetDate);
    setUnlockedDate(targetDate);
    if (adminAction === "date") {
      setDateFrom(targetDate);
      setDateTo(targetDate);
    }
    setModal(null);
    setAdminPassword("");
    setAdminError("");
    notify(
      `Session unlocked for ${formatDate(targetDate, { month: "short", day: "numeric", year: "numeric" })}.`,
    );
  }

  function openSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedAccounts = (todaySession ? ledger.accounts : accounts).filter(
      (account) => openingAccountIds.includes(account.id),
    );
    if (!selectedAccounts.length) {
      notify("Select at least one account for today’s session.");
      return;
    }
    const opening = Object.fromEntries(
      selectedAccounts.map((account) => [
        account.id,
        Number(openingAmounts[account.id] || 0),
      ]),
    );
    if (
      selectedAccounts.some(
        (account) =>
          !Number.isFinite(opening[account.id]) || opening[account.id] < 0,
      )
    )
      return;
    const newSession = {
      date: activeDate,
      activeAccountIds: selectedAccounts.map((account) => account.id),
      accountBalances: {
        opening,
        groundClosing: Object.fromEntries(
          selectedAccounts.map((account) => [account.id, null]),
        ),
      },
      openingBalance: opening["cash-drawer"] ?? 0,
      closingBalance: null,
      openedAt: todaySession?.openedAt ?? new Date().toISOString(),
      closedAt: null,
    };
    setLedger((current) => ({
      ...current,
      sessions: [
        ...current.sessions.filter((session) => session.date !== activeDate),
        newSession,
      ],
    }));
    setModal(null);
    notify("Morning session opened. Opening balance recorded.");
  }

  function closeSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!todaySession || !isOpen) return;
    const groundClosing = Object.fromEntries(
      todayActiveAccounts.map((account) => [
        account.id,
        Number(closingAmounts[account.id] || 0),
      ]),
    );
    if (
      todayActiveAccounts.some(
        (account) =>
          !Number.isFinite(groundClosing[account.id]) ||
          groundClosing[account.id] < 0,
      )
    )
      return;
    const totalGround = Object.values(groundClosing).reduce(
      (total, amount) => total + Number(amount),
      0,
    );
    setLedger((current) => ({
      ...current,
      sessions: current.sessions.map((session) =>
        session.date === activeDate
          ? {
              ...session,
              accountBalances: { ...session.accountBalances, groundClosing },
              closingBalance: totalGround,
              closedAt: new Date().toISOString(),
            }
          : session,
      ),
    }));
    setUnlockedDate(null);
    setModal(null);
    notify("Session closed. Reconciliation is ready.");
  }

  function addTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(amountInput);
    const commission = Number(commissionInput || 0);
    if (!isOpen) {
      notify("Open or unlock this session before recording transactions.");
      return;
    }
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isFinite(commission) ||
      commission < 0
    )
      return;
    if (transactionKind === "TRANSFER" && fromAccountId === toAccountId) {
      notify("Choose two different accounts for a transfer.");
      return;
    }
    const activeIds = new Set(todaySession?.activeAccountIds ?? []);
    const selectedSource =
      transactionKind === "CASH_IN"
        ? serviceAccountId
        : transactionKind === "CASH_OUT" || transactionKind === "EXPENSE"
          ? "cash-drawer"
          : fromAccountId;
    const selectedDestination =
      transactionKind === "CASH_IN"
        ? "cash-drawer"
        : transactionKind === "CASH_OUT"
          ? serviceAccountId
          : transactionKind === "TRANSFER"
            ? toAccountId
            : null;
    if (
      !activeIds.has(selectedSource) ||
      (selectedDestination && !activeIds.has(selectedDestination))
    ) {
      notify("Choose accounts that are active in today’s session.");
      return;
    }
    const isCashIn = transactionKind === "CASH_IN";
    const isCashOut = transactionKind === "CASH_OUT";
    const source: AccountId = isCashIn
      ? serviceAccountId
      : isCashOut || transactionKind === "EXPENSE"
        ? "cash-drawer"
        : fromAccountId;
    const destination: AccountId | null = isCashIn
      ? "cash-drawer"
      : isCashOut
        ? serviceAccountId
        : transactionKind === "TRANSFER"
          ? toAccountId
          : null;
    const commissionDestination =
      commissionDestinationId === "related"
        ? transactionKind === "CASH_IN"
          ? source
          : transactionKind === "CASH_OUT" || transactionKind === "TRANSFER"
            ? (destination ?? source)
            : "cash-drawer"
        : commissionDestinationId;
    if (commission > 0 && !activeIds.has(commissionDestination)) {
      notify("Choose an active account to receive the commission.");
      return;
    }
    const now = new Date();
    const existingTransaction = editingTransactionId
      ? ledger.transactions.find((item) => item.id === editingTransactionId)
      : undefined;
    const transaction: LedgerTransaction = {
      id: crypto.randomUUID(),
      date: activeDate,
      time:
        existingTransaction?.time ??
        now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      kind: transactionKind,
      customer: customerInput.trim(),
      phone: phoneInput.trim(),
      amount,
      commission,
      commissionAccountId: commissionDestination,
      note: noteInput.trim(),
      fromAccountId: source,
      toAccountId: destination,
    };
    setLedger((current) => ({
      ...current,
      transactions: editingTransactionId
        ? current.transactions.map((item) =>
            item.id === editingTransactionId
              ? { ...transaction, id: editingTransactionId }
              : item,
          )
        : [transaction, ...current.transactions],
    }));
    setEditingTransactionId(null);
    setAmountInput("");
    setCommissionInput("");
    setCustomerInput("");
    setPhoneInput("");
    setNoteInput("");
    notify(
      editingTransactionId
        ? "Transaction updated."
        : `${kindLabel(transactionKind)} recorded.`,
    );
  }

  function editTransaction(transaction: LedgerTransaction) {
    setEditingTransactionId(transaction.id);
    setTransactionKind(transaction.kind);
    setAmountInput(String(transaction.amount));
    setCommissionInput(String(transaction.commission));
    setCommissionDestinationId(
      transaction.commissionAccountId ?? "cash-drawer",
    );
    setCustomerInput(transaction.customer);
    setPhoneInput(transaction.phone);
    setNoteInput(transaction.note);
    if (transaction.kind === "CASH_IN")
      setServiceAccountId(transaction.fromAccountId);
    if (transaction.kind === "CASH_OUT")
      setServiceAccountId(transaction.toAccountId ?? "cash-drawer");
    if (transaction.kind === "TRANSFER") {
      setFromAccountId(transaction.fromAccountId);
      setToAccountId(transaction.toAccountId ?? transaction.fromAccountId);
    }
    setTimeout(
      () =>
        document
          .getElementById("transaction-entry")
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      0,
    );
  }

  function removeTransaction(id: string) {
    setLedger((current) => ({
      ...current,
      transactions: current.transactions.filter(
        (transaction) => transaction.id !== id,
      ),
    }));
    if (editingTransactionId === id) setEditingTransactionId(null);
    notify("Transaction removed from this device.");
  }

  function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = accountForm.name.trim();
    if (!name) return;
    const shortName = accountForm.shortName.trim() || name;
    if (editingAccountId) {
      setLedger((current) => ({
        ...current,
        accounts: current.accounts.map((account) =>
          account.id === editingAccountId
            ? {
                ...account,
                name,
                shortName,
                kind: accountForm.kind,
                accountNumber: accountForm.accountNumber.trim(),
                color: accountForm.color,
                mark: name.slice(0, 1).toUpperCase(),
              }
            : account,
        ),
      }));
      notify("Account details updated.");
    } else {
      const id = `account-${crypto.randomUUID()}`;
      const colors = ["sky", "gold", "rose", "mint"];
      setLedger((current) => ({
        ...current,
        accounts: [
          ...current.accounts,
          {
            id,
            name,
            shortName,
            kind: accountForm.kind,
            accountNumber: accountForm.accountNumber.trim(),
            color:
              accountForm.color ||
              colors[current.accounts.length % colors.length],
            mark: name.slice(0, 1).toUpperCase(),
          },
        ],
      }));
      notify("Account added.");
    }
    setEditingAccountId(null);
    setAccountForm({
      name: "",
      shortName: "",
      kind: "wallet",
      accountNumber: "",
      color: "sky",
    });
  }

  function editAccount(account: AccountDefinition) {
    setEditingAccountId(account.id);
    setAccountForm({
      name: account.name,
      shortName: account.shortName,
      kind: account.kind,
      accountNumber: account.accountNumber,
      color: account.color,
    });
  }

  function deleteAccount(account: AccountDefinition) {
    if (account.id === "cash-drawer") {
      notify("Cash drawer is required and cannot be deleted.");
      return;
    }
    const inUse =
      ledger.sessions.some((session) =>
        session.activeAccountIds.includes(account.id),
      ) ||
      ledger.transactions.some(
        (transaction) =>
          transaction.fromAccountId === account.id ||
          transaction.toAccountId === account.id,
      );
    if (inUse) {
      setLedger((current) => ({
        ...current,
        accounts: current.accounts.map((item) =>
          item.id === account.id
            ? { ...item, deletedAt: new Date().toISOString() }
            : item,
        ),
      }));
      notify(
        "Account archived. Historical sessions and reports are preserved.",
      );
    } else {
      setLedger((current) => ({
        ...current,
        accounts: current.accounts.filter((item) => item.id !== account.id),
      }));
      notify("Account deleted.");
    }
    if (editingAccountId === account.id) setEditingAccountId(null);
  }

  function restoreAccount(accountId: AccountId) {
    setLedger((current) => ({
      ...current,
      accounts: current.accounts.map((account) =>
        account.id === accountId ? { ...account, deletedAt: null } : account,
      ),
    }));
    notify("Account restored for future sessions.");
  }

  function exportExcel() {
    const transactions = filteredTransactions.map((transaction) => ({
      Date: transaction.date,
      Time: transaction.time,
      Type: kindLabel(transaction.kind),
      Customer: transaction.customer || "-",
      Phone: transaction.phone || "-",
      Channel_or_Wallet: transactionParty(ledger.accounts, transaction),
      Amount_MMK: transaction.amount,
      Commission_MMK: transaction.commission,
      Commission_Received_In: accountName(
        ledger.accounts,
        commissionAccountId(transaction),
      ),
      Note: transaction.note || "-",
    }));
    const workbook = XLSX.utils.book_new();
    const sessions = reportDailyRows.map((row) => ({
      Date: row.date,
      Wallet: accountName(ledger.accounts, row.accountId),
      Opening_MMK: row.opening,
      Inflow_MMK: row.inflow,
      Outflow_MMK: row.outflow,
      System_Closing_MMK: row.systemClosing,
      Ground_Closing_MMK: row.groundClosing ?? "",
      Difference_MMK: row.difference ?? "",
    }));
    const wallets = reportWalletRows.map((row) => ({
      Wallet: row.account.name,
      Net_Volume_MMK: row.net,
      Inflow_MMK: row.inflow,
      Outflow_MMK: row.outflow,
      Commission_MMK: row.commission,
      Latest_System_Closing_MMK: row.closing,
    }));
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(sessions),
      "Daily sessions",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(wallets),
      "Wallet summary",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        transactions.length
          ? transactions
          : [{ Note: "No transactions in selected date range" }],
      ),
      "Transactions",
    );
    XLSX.writeFile(workbook, `ledger-${dateFrom}-to-${dateTo}.xlsx`);
  }

  function exportPdf() {
    const document = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });
    document.setFont("helvetica", "bold");
    document.setFontSize(19);
    document.text("Daily cash ledger", 16, 19);
    document.setFont("helvetica", "normal");
    document.setFontSize(10);
    document.text(`Statement period: ${dateFrom} to ${dateTo}`, 16, 27);
    document.text(
      `Start-day opening: MMK ${formatMMK(reportOpeningBalance)}`,
      16,
      34,
    );
    document.text(
      `End-day system close: MMK ${formatMMK(reportSystemClosing)}`,
      16,
      41,
    );
    document.text(
      `Commissions in period: MMK ${formatMMK(reportCommissions)}`,
      16,
      48,
    );
    autoTable(document, {
      startY: 56,
      head: [
        [
          "Date",
          "Wallet",
          "Opening",
          "Inflow",
          "Outflow",
          "System",
          "Ground",
          "Diff.",
        ],
      ],
      body: reportDailyRows.map((row) => [
        row.date,
        accountName(ledger.accounts, row.accountId),
        formatMMK(row.opening),
        formatMMK(row.inflow),
        formatMMK(row.outflow),
        formatMMK(row.systemClosing),
        row.groundClosing == null ? "-" : formatMMK(row.groundClosing),
        row.difference == null ? "-" : formatMMK(row.difference),
      ]),
      styles: { fontSize: 6.5, cellPadding: 1.8 },
      headStyles: { fillColor: [23, 60, 49] },
      margin: { left: 10, right: 10 },
    });
    const tableDocument = document as jsPDF & {
      lastAutoTable?: { finalY: number };
    };
    autoTable(document, {
      startY: (tableDocument.lastAutoTable?.finalY ?? 56) + 7,
      head: [["Wallet", "Net volume", "Inflow", "Outflow", "Commission"]],
      body: reportWalletRows.map((row) => [
        row.account.name,
        formatMMK(row.net),
        formatMMK(row.inflow),
        formatMMK(row.outflow),
        formatMMK(row.commission),
      ]),
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [60, 91, 65] },
      margin: { left: 12, right: 12 },
    });
    autoTable(document, {
      startY: (tableDocument.lastAutoTable?.finalY ?? 56) + 7,
      head: [
        [
          "Date",
          "Time",
          "Type",
          "Customer",
          "Channel / wallet",
          "Amount",
          "Fee",
          "Fee deposited in",
        ],
      ],
      body: filteredTransactions.map((transaction) => [
        transaction.date,
        transaction.time,
        kindLabel(transaction.kind),
        transaction.customer || "Walk-in",
        transactionParty(ledger.accounts, transaction),
        formatMMK(transaction.amount),
        formatMMK(transaction.commission),
        accountName(ledger.accounts, commissionAccountId(transaction)),
      ]),
      styles: { fontSize: 6.5, cellPadding: 1.8 },
      headStyles: { fillColor: [23, 60, 49] },
      margin: { left: 10, right: 10 },
    });
    document.save(`ledger-summary-${dateFrom}-to-${dateTo}.pdf`);
  }

  function printThermalSlip() {
    const printWindow = window.open("", "_blank", "width=360,height=760");
    if (!printWindow) {
      notify("Allow pop-ups to print the 80 mm slip.");
      return;
    }
    const sessionRows = reportDailyRows
      .map(
        (row) =>
          `<tr><td colspan="2" class="item">${escapeHtml(row.date)} · ${escapeHtml(accountName(ledger.accounts, row.accountId))}</td></tr><tr><td>Open ${formatMMK(row.opening)} · In ${formatMMK(row.inflow)} · Out ${formatMMK(row.outflow)}</td><td class="amount">Sys ${formatMMK(row.systemClosing)}</td></tr><tr><td>Ground ${row.groundClosing == null ? "-" : formatMMK(row.groundClosing)}</td><td class="amount">Diff ${row.difference == null ? "-" : formatMMK(row.difference)}</td></tr>`,
      )
      .join("");
    const walletRows = reportWalletRows
      .map(
        (row) =>
          `<tr><td>${escapeHtml(row.account.name)} · net ${formatMMK(row.net)}</td><td class="amount">Fee ${formatMMK(row.commission)}</td></tr>`,
      )
      .join("");
    const transactionRows = filteredTransactions
      .map(
        (transaction) => `
      <tr><td colspan="2" class="item">${escapeHtml(kindLabel(transaction.kind))} · ${escapeHtml(transaction.time)}</td></tr>
      <tr><td>${escapeHtml(transaction.date)} · ${escapeHtml(transaction.customer || "Walk-in")}</td><td class="amount">${formatMMK(transaction.amount)}</td></tr>
      <tr><td>${escapeHtml(transactionParty(ledger.accounts, transaction))}</td><td class="amount">Amount ${formatMMK(transaction.amount)}</td></tr>
      <tr><td>Commission → ${escapeHtml(accountName(ledger.accounts, commissionAccountId(transaction)))}</td><td class="amount">${formatMMK(transaction.commission)}</td></tr>
      ${transaction.commission ? `<tr><td class="muted">Commission</td><td class="amount">${formatMMK(transaction.commission)}</td></tr>` : ""}
    `,
      )
      .join("");
    const rows = `<tr><td colspan="2" class="section">DAILY ACCOUNT BREAKDOWN</td></tr>${sessionRows || '<tr><td colspan="2">No sessions in this period</td></tr>'}<tr><td colspan="2" class="section">WALLET SUMMARY · NET / FEES</td></tr>${walletRows || '<tr><td colspan="2">No wallet activity</td></tr>'}<tr><td colspan="2" class="section">TRANSACTIONS</td></tr>${transactionRows || '<tr><td colspan="2">No transactions in this period</td></tr>'}`;
    printWindow.document
      .write(`<!doctype html><html><head><title>Ledger receipt</title><style>
      @page{size:80mm auto;margin:4mm}*{box-sizing:border-box}body{width:72mm;margin:0;color:#17251f;font:12px/1.4 Arial,sans-serif}header{text-align:center;border-bottom:1px dashed #555;padding-bottom:10px}h1{font-size:19px;margin:0 0 5px}p{margin:2px 0}.rule{border:0;border-top:1px dashed #777;margin:9px 0}table{width:100%;border-collapse:collapse}td{padding:2px 0;vertical-align:top}.item{padding-top:7px;font-weight:bold}.section{padding-top:10px;border-bottom:1px dashed #777;font-size:10px;font-weight:bold}.amount{text-align:right;white-space:nowrap}.muted{color:#666}.total{font-weight:bold;font-size:13px}footer{text-align:center;margin-top:14px}
      </style></head><body><header><h1>DAILY LEDGER</h1><p>${escapeHtml(formatDate(dateFrom, { month: "short", day: "numeric", year: "numeric" }))}</p><p>Statement ${escapeHtml(dateFrom)} to ${escapeHtml(dateTo)}</p></header><hr class="rule"><table>${rows || "<tr><td>No transactions in this period</td></tr>"}</table><hr class="rule"><table><tr><td>Start-day opening</td><td class="amount">${formatMMK(reportOpeningBalance)}</td></tr><tr class="total"><td>End-day system close</td><td class="amount">${formatMMK(reportSystemClosing)}</td></tr></table><footer>Thank you</footer><script>window.onload=()=>window.print()<\/script></body></html>`);
    printWindow.document.close();
  }

  const rangeInflow = filteredTransactions
    .filter((transaction) => transaction.kind === "CASH_IN")
    .reduce((total, transaction) => total + transaction.amount, 0);
  const rangeOutflow = filteredTransactions
    .filter(
      (transaction) =>
        transaction.kind === "CASH_OUT" || transaction.kind === "EXPENSE",
    )
    .reduce((total, transaction) => total + transaction.amount, 0);

  return (
    <div className="dashboard-shell flex min-h-screen">
      <main className="min-w-0 flex-1 pb-24">
        <header className="topbar-actions sticky top-0 z-20 flex min-h-[64px] items-center justify-between border-b border-[#e5e9e4] bg-[#f3f5f2]/95 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-3">
            <div>
              <p className="m-0 text-[9px] font-medium uppercase tracking-[1.5px] text-[#87928b]">
                Daily operations
              </p>
              <h1 className="m-0 mt-0.5 text-[14px] font-semibold tracking-[-0.25px] text-[#17251f]">
                Cash ledger
              </h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
            <div className="flex shrink-0 items-center gap-1 rounded-[7px] border border-[#e1e6e0] bg-white px-2 py-1 text-[10px] text-[#526158]">
              <CalendarDays
                size={13}
                className="hidden shrink-0 text-[#6e8b58] min-[380px]:block"
              />
              <input
                aria-label="Active session date"
                type="date"
                value={activeDate}
                max={today}
                onChange={(event) => selectSessionDate(event.target.value)}
                className="w-[84px] bg-transparent text-[10px] font-semibold text-[#34443b] outline-none sm:w-[96px]"
              />
            </div>
            {isOpen ? (
              <button
                aria-label="Close session"
                onClick={startClosingFlow}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] bg-[#173c31] px-2.5 text-[11px] font-semibold text-white transition hover:bg-[#245745]"
              >
                <span className="size-1.5 rounded-full bg-[#c6f36b]" />
                <span>Close session</span>
              </button>
            ) : isClosed ? (
              <button
                aria-label="Reopen or edit session"
                onClick={() => requestAdminUnlock("reopen")}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-[#dce4da] bg-white px-2.5 text-[10px] font-semibold text-[#5c6a61] hover:bg-[#f5f8f3]"
              >
                <Pencil size={12} />
                <span>Reopen</span>
              </button>
            ) : (
              <button
                aria-label="Open session"
                onClick={startOpeningFlow}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] bg-[#173c31] px-2.5 text-[11px] font-semibold text-white transition hover:bg-[#245745]"
              >
                <Plus size={14} />
                <span>Open session</span>
              </button>
            )}
          </div>
        </header>

        <div className="app-content mx-auto max-w-[1440px] px-4 pt-4 md:px-8 md:pt-6">
          {message && (
            <div
              role="status"
              className="fade-up mb-4 flex items-center gap-2 rounded-[8px] border border-[#d9e8c9] bg-[#eff7e6] px-3.5 py-2.5 text-[11px] text-[#42642d]"
            >
              <CircleCheck size={15} />
              {message}
            </div>
          )}

          {activeTab === "overview" && (
            <>
              <section className="mb-5 grid gap-4 xl:grid-cols-[1.35fr_0.85fr]">
                <div className="relative min-h-[190px] overflow-hidden rounded-[11px] bg-[#173c31] p-5 text-white">
                  <div className="pointer-events-none absolute -right-8 -top-14 size-60 rounded-full border border-white/8" />
                  <div className="relative flex h-full flex-col justify-between gap-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="mb-1 text-[9px] font-medium uppercase tracking-[1.7px] text-white/55">
                          Cash position · MMK
                        </p>
                        <p className="number-font m-0 text-[28px] font-semibold tracking-[-1px] md:text-[34px]">
                          {formatMMK(balances["cash-drawer"])}
                        </p>
                        <p className="mb-0 mt-1 text-[10px] text-white/55">
                          {isOpen
                            ? "Live drawer balance"
                            : isClosed
                              ? "Final drawer balance"
                              : "Opening balance not set"}
                        </p>
                      </div>
                      <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-[#c6f36b] text-[#173c31]">
                        <WalletCards size={18} />
                      </span>
                    </div>
                    <div className="flex flex-wrap items-end justify-between gap-4 border-t border-white/15 pt-3">
                      <div className="flex gap-6">
                        <div>
                          <p className="m-0 text-[9px] uppercase tracking-[1px] text-white/50">
                            Opening
                          </p>
                          <p className="number-font mb-0 mt-0.5 text-[11px] font-medium">
                            {formatMMK(openingBalance)}{" "}
                            <span className="text-[8px] text-white/45">MMK</span>
                          </p>
                        </div>
                        <div>
                          <p className="m-0 text-[9px] uppercase tracking-[1px] text-white/50">
                            System close
                          </p>
                          <p className="number-font mb-0 mt-0.5 text-[11px] font-medium">
                            {formatMMK(systemClosing)}{" "}
                            <span className="text-[8px] text-white/45">MMK</span>
                          </p>
                        </div>
                      </div>
                      <span className="text-[9px] text-white/50">
                        Updated just now
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex min-h-[190px] flex-col justify-between rounded-[11px] border border-[#e4e8e3] bg-white p-5">
                  <div>
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="mb-1 text-[9px] font-semibold uppercase tracking-[1.5px] text-[#8a958d]">
                          Session control
                        </p>
                        <h3 className="m-0 text-[15px] font-semibold tracking-[-0.3px]">
                          {isOpen
                            ? "Morning session"
                            : isClosed
                              ? "Session complete"
                              : "Start the day"}
                        </h3>
                      </div>
                      <span
                        className={`grid size-8 place-items-center rounded-[8px] ${isOpen ? "bg-[#eff7e6] text-[#6b963d]" : "bg-[#f3f5f2] text-[#768279]"}`}
                      >
                        {isOpen ? <Clock3 size={16} /> : <Check size={16} />}
                      </span>
                    </div>
                    <p className="mb-0 mt-2 text-[11px] leading-5 text-[#849087]">
                      {isOpen
                        ? `Opened at ${new Date(todaySession!.openedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}. Record activity as it happens.`
                        : isClosed
                          ? `Closed at ${new Date(todaySession!.closedAt!).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}.`
                          : "Enter opening balances before recording today’s transactions."}
                    </p>
                  </div>

                  <div className="mt-4 border-t border-[#edf0ec] pt-3">
                    <p className="mb-2 text-[10px] text-[#87928a]">
                      {todayTransactions.length} transaction
                      {todayTransactions.length === 1 ? "" : "s"} today
                    </p>

                    {(isOpen || (isUnlocked && todaySession)) ? (
                      <div className="grid w-full grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={startOpeningFlow}
                          className="flex h-10 w-full items-center justify-center rounded-[8px] border border-[#d5e1d0] bg-[#f1f7eb] px-2 text-xs font-medium text-[#34583a] shadow-sm transition hover:bg-[#e8f2df] active:translate-y-px"
                        >
                          Edit Opening Bal
                        </button>
                        <button
                          type="button"
                          onClick={startClosingFlow}
                          className="flex h-10 w-full items-center justify-center rounded-[8px] bg-[#173c31] px-2 text-xs font-medium text-white shadow-sm transition hover:bg-[#245745] active:translate-y-px"
                        >
                          Edit Closing Bal
                        </button>
                      </div>
                    ) : !todaySession ? (
                      <button
                        type="button"
                        onClick={startOpeningFlow}
                        className="flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] bg-[#c6f36b] px-3 text-xs font-semibold text-[#23432f] transition hover:bg-[#b5e659]"
                      >
                        Set opening balance
                        <ArrowRight size={13} />
                      </button>
                    ) : null}
                  </div>
                </div>
              </section>

              <section className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
                {[
                  {
                    label: "Cash-in volume",
                    amount: cashInTotal,
                    hint: "Customer deposits",
                    icon: ArrowDownLeft,
                    tone: "bg-[#eaf5de] text-[#4b7b33]",
                  },
                  {
                    label: "Cash-out volume",
                    amount: cashOutTotal,
                    hint: "Customer withdrawals",
                    icon: ArrowUpRight,
                    tone: "bg-[#fff0e8] text-[#b66343]",
                  },
                  {
                    label: "Commissions",
                    amount: commissions,
                    hint: "Fees earned today",
                    icon: TrendingUp,
                    tone: "bg-[#e6f1f8] text-[#457a9d]",
                  },
                  {
                    label: "Operating expense",
                    amount: expenseTotal,
                    hint: "Cash paid out",
                    icon: ReceiptText,
                    tone: "bg-[#f2edf5] text-[#795e85]",
                  },
                ].map((metric) => (
                  <div
                    key={metric.label}
                    className="rounded-[10px] border border-[#e5e9e4] bg-white p-3.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-medium text-[#758178]">
                        {metric.label}
                      </span>
                      <span
                        className={`grid size-6 place-items-center rounded-[6px] ${metric.tone}`}
                      >
                        <metric.icon size={13} />
                      </span>
                    </div>
                    <p className="number-font mb-0 mt-2 text-[17px] font-semibold tracking-[-0.5px] text-[#1c2b23]">
                      {formatMMK(metric.amount)}{" "}
                      <span className="text-[9px] font-medium text-[#98a199]">
                        MMK
                      </span>
                    </p>
                    <p className="mb-0 mt-0.5 text-[8.5px] text-[#98a199]">
                      {metric.hint}
                    </p>
                  </div>
                ))}
              </section>

              <section className="mb-6">
                <div className="mb-2.5 flex items-end justify-between">
                  <div>
                    <h3 className="m-0 text-[13px] font-semibold">
                      Quick balances
                    </h3>
                    <p className="mb-0 mt-0.5 text-[10px] text-[#8b968d]">
                      {todaySession
                        ? "Active accounts for this session"
                        : "Session balances start at zero"}
                    </p>
                  </div>
                  <button
                    onClick={() => setActiveTab("wallet")}
                    className="text-[10px] font-semibold text-[#49604f] underline decoration-[#c7d3c6] underline-offset-4"
                  >
                    All wallets
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(todaySession
                    ? todayActiveAccounts.filter(
                        (account) => !account.deletedAt,
                      )
                    : accounts
                  ).map((account) => (
                    <div
                      key={account.id}
                      className="min-w-0 rounded-[9px] border border-[#e5e9e4] bg-white px-3 py-2.5"
                    >
                      <AccountBadge account={account} compact />
                      <p className="number-font mb-0 mt-2 truncate text-[13px] font-semibold text-[#213128]">
                        {todaySession
                          ? formatMMK(balances[account.id] ?? 0)
                          : "0"}
                        <span className="ml-1 text-[8px] font-normal text-[#98a199]">
                          MMK
                        </span>
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {activeTab === "wallet" && (
            <section id="accounts" className="mb-7 scroll-mt-24">
              <div className="mb-3 flex items-end justify-between">
                <div>
                  <h3 className="m-0 text-[13px] font-semibold">
                    Account balances
                  </h3>
                  <p className="mb-0 mt-0.5 text-[10px] text-[#8b968d]">
                    {todaySession
                      ? `${todayActiveAccounts.length} active in today’s session`
                      : "Manage wallets and configure balances"}
                  </p>
                </div>
                <button
                  onClick={() => setModal("accounts")}
                  className="flex h-8 items-center gap-1.5 rounded-[7px] bg-[#173c31] px-3 text-[10px] font-semibold text-white transition hover:bg-[#245745]"
                >
                  <Plus size={13} />
                  Manage Acc
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">
                {accounts.map((account) => (
                  <div
                    key={account.id}
                    className={`min-w-0 rounded-[9px] border bg-white px-3 py-2.5 ${todaySession && !todaySession.activeAccountIds.includes(account.id) ? "border-dashed border-[#e5e9e4] opacity-55" : "border-[#e5e9e4]"}`}
                  >
                    <div className="mb-2 flex items-center gap-1.5">
                      <span
                        className={`grid size-5 shrink-0 place-items-center rounded-[6px] text-[8.5px] font-bold ${accountColorBadge(account.color)}`}
                      >
                        {account.mark}
                      </span>
                      <span className="truncate text-[9px] font-medium text-[#69766e]">
                        {account.shortName}
                      </span>
                    </div>
                    <p className="number-font m-0 truncate text-[12px] font-semibold tracking-[-0.3px] text-[#213128]">
                      {todaySession?.activeAccountIds.includes(account.id)
                        ? formatMMK(balances[account.id] ?? 0)
                        : "—"}
                    </p>
                    <p className="mb-0 mt-0.5 text-[8px] text-[#a0aaa2]">
                      {account.accountNumber || account.kind.toUpperCase()}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeTab === "transactions" && (
            <section id="transactions" className="mb-7 scroll-mt-24">
              <div className="mb-3 flex flex-col justify-between gap-1 sm:flex-row sm:items-end">
                <div>
                  <h3 className="m-0 text-[13px] font-semibold">
                    Quick transaction
                  </h3>
                  <p className="mb-0 mt-0.5 text-[10px] text-[#8b968d]">
                    Capture counter transaction
                  </p>
                </div>
                {!isOpen && (
                  <span className="flex items-center gap-1 text-[10px] text-[#ac7954]">
                    <CircleAlert size={12} />
                    Open session to enter transactions
                  </span>
                )}
              </div>

              <form
                id="transaction-entry"
                onSubmit={addTransaction}
                className="rounded-[10px] border border-[#e4e8e3] bg-white p-4"
              >
                <div
                  className="mb-4 flex gap-1.5 overflow-x-auto border-b border-[#edf0ec] pb-2.5 scrollbar-hidden"
                  role="tablist"
                >
                  {(
                    [
                      "CASH_IN",
                      "CASH_OUT",
                      "TRANSFER",
                      "EXPENSE",
                    ] as TransactionKind[]
                  ).map((kind) => {
                    const Icon = kindIcons[kind];
                    return (
                      <button
                        type="button"
                        key={kind}
                        onClick={() => setTransactionKind(kind)}
                        className={`flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] px-3 text-[10px] font-medium transition ${transactionKind === kind ? "bg-[#173c31] text-white" : "bg-[#f5f7f4] text-[#758178] hover:bg-[#edf1ec]"}`}
                      >
                        <Icon size={12} />
                        {kindLabel(kind)}
                      </button>
                    );
                  })}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {(transactionKind === "CASH_IN" ||
                    transactionKind === "CASH_OUT") && (
                    <label className="field-label">
                      {transactionKind === "CASH_IN" ? "Received via" : "Paid to"}
                      <span className="select-wrap mt-1">
                        <select
                          value={serviceAccountId}
                          onChange={(event) =>
                            setServiceAccountId(event.target.value as AccountId)
                          }
                        >
                          {transactionAccounts
                            .filter((account) => account.id !== "cash-drawer")
                            .map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.name}
                              </option>
                            ))}
                        </select>
                        <ChevronDown size={14} />
                      </span>
                    </label>
                  )}

                  {transactionKind === "TRANSFER" && (
                    <>
                      <label className="field-label">
                        From account
                        <span className="select-wrap mt-1">
                          <select
                            value={fromAccountId}
                            onChange={(event) =>
                              setFromAccountId(event.target.value as AccountId)
                            }
                          >
                            {transactionAccounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.name}
                              </option>
                            ))}
                          </select>
                          <ChevronDown size={14} />
                        </span>
                      </label>
                      <label className="field-label">
                        To account
                        <span className="select-wrap mt-1">
                          <select
                            value={toAccountId}
                            onChange={(event) =>
                              setToAccountId(event.target.value as AccountId)
                            }
                          >
                            {transactionAccounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.name}
                              </option>
                            ))}
                          </select>
                          <ChevronDown size={14} />
                        </span>
                      </label>
                    </>
                  )}

                  {transactionKind === "EXPENSE" && (
                    <label className="field-label">
                      Paid from
                      <span className="mt-1 flex h-[38px] items-center rounded-[7px] border border-[#e3e8e2] bg-[#f8faf7] px-3 text-[11px] font-normal text-[#536258]">
                        Cash in drawer
                      </span>
                    </label>
                  )}

                  <label className="field-label">
                    Amount · MMK
                    <span className="input-wrap mt-1">
                      <input
                        required
                        min="1"
                        step="1"
                        inputMode="numeric"
                        type="number"
                        placeholder="0"
                        value={amountInput}
                        onChange={(event) => setAmountInput(event.target.value)}
                      />
                    </span>
                  </label>

                  <label className="field-label">
                    Commission · MMK
                    <span className="input-wrap mt-1">
                      <input
                        min="0"
                        step="1"
                        inputMode="numeric"
                        type="number"
                        placeholder="0"
                        value={commissionInput}
                        onChange={(event) =>
                          setCommissionInput(event.target.value)
                        }
                      />
                    </span>
                  </label>

                  {Number(commissionInput) > 0 && (
                    <label className="field-label">
                      Commission Received In
                      <span className="select-wrap mt-1">
                        <select
                          value={commissionDestinationId}
                          onChange={(event) =>
                            setCommissionDestinationId(event.target.value)
                          }
                        >
                          <option value="cash-drawer">Cash Drawer</option>
                          <option value="related">Selected Wallet</option>
                          {transactionAccounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={14} />
                      </span>
                    </label>
                  )}

                  <label className="field-label">
                    Customer name
                    <span className="input-wrap mt-1">
                      <input
                        placeholder="Optional"
                        value={customerInput}
                        onChange={(event) =>
                          setCustomerInput(event.target.value)
                        }
                      />
                    </span>
                  </label>

                  <label className="field-label">
                    Phone number
                    <span className="input-wrap mt-1">
                      <input
                        inputMode="tel"
                        placeholder="Optional"
                        value={phoneInput}
                        onChange={(event) => setPhoneInput(event.target.value)}
                      />
                    </span>
                  </label>

                  <label className="field-label sm:col-span-2">
                    Note
                    <span className="input-wrap mt-1">
                      <input
                        placeholder="Optional note"
                        value={noteInput}
                        onChange={(event) => setNoteInput(event.target.value)}
                      />
                    </span>
                  </label>
                </div>

                <div className="mt-4 flex justify-end gap-2 border-t border-[#edf0ec] pt-3">
                  {editingTransactionId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTransactionId(null);
                        setAmountInput("");
                        setCommissionInput("");
                        setCustomerInput("");
                        setPhoneInput("");
                        setNoteInput("");
                      }}
                      className="h-9 rounded-[7px] border border-[#e3e8e2] px-3 text-[10px] font-medium text-[#6d7971]"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    disabled={!isOpen}
                    type="submit"
                    className="flex h-9 items-center justify-center gap-1.5 rounded-[7px] bg-[#173c31] px-4 text-[10px] font-semibold text-white transition hover:bg-[#245745] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {editingTransactionId ? <Check size={13} /> : <Plus size={13} />}
                    {editingTransactionId ? "Save changes" : "Add transaction"}
                  </button>
                </div>
              </form>

              <div className="mt-4 overflow-hidden rounded-[10px] border border-[#e4e8e3] bg-white">
                <div className="border-b border-[#edf0ec] px-4 py-2.5">
                  <h3 className="m-0 text-[11px] font-semibold">
                    Today’s Transactions ({todayTransactions.length})
                  </h3>
                </div>
                {todayTransactions.length ? (
                  <div className="divide-y divide-[#edf0ec]">
                    {todayTransactions.map((transaction) => (
                      <div
                        key={transaction.id}
                        className="flex items-center gap-2.5 px-3.5 py-2.5"
                      >
                        <span
                          className={`grid size-7 shrink-0 place-items-center rounded-[6px] ${kindColors[transaction.kind]}`}
                        >
                          <span className="text-[10px] font-semibold">
                            {transaction.kind === "CASH_IN"
                              ? "↓"
                              : transaction.kind === "CASH_OUT"
                                ? "↑"
                                : transaction.kind === "TRANSFER"
                                  ? "↔"
                                  : "−"}
                          </span>
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="m-0 truncate text-[10px] font-semibold text-[#34443b]">
                            {transaction.customer || kindLabel(transaction.kind)}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[8.5px] text-[#89948c]">
                            <span>{transaction.time}</span>
                            <TransactionChannels
                              accountList={ledger.accounts}
                              transaction={transaction}
                            />
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="number-font m-0 text-[10px] font-semibold">
                            {formatMMK(transaction.amount)}
                          </p>
                          {transaction.commission > 0 && (
                            <p className="number-font mb-0 mt-0.5 text-[8px] text-[#71816f]">
                              Fee {formatMMK(transaction.commission)}
                            </p>
                          )}
                        </div>
                        {isOpen && (
                          <div className="flex gap-1 pl-1">
                            <button
                              onClick={() => editTransaction(transaction)}
                              className="grid size-6 place-items-center rounded-[5px] text-[#73877a] hover:bg-[#edf4e8]"
                            >
                              <Pencil size={11} />
                            </button>
                            <button
                              onClick={() => removeTransaction(transaction.id)}
                              className="grid size-6 place-items-center rounded-[5px] text-[#a36e5a] hover:bg-[#fff0e9]"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-8 text-center text-[10px] text-[#89948c]">
                    No transactions yet today.
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === "reconciliation" && (
            <section className="mb-7 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div
                id="reconciliation"
                className="scroll-mt-24 rounded-[10px] border border-[#e4e8e3] bg-white p-4"
              >
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <h3 className="m-0 text-[13px] font-semibold">
                      Evening reconciliation
                    </h3>
                    <p className="mb-0 mt-0.5 text-[10px] text-[#8b968d]">
                      {formatDate(activeDate, { month: "short", day: "numeric" })}
                    </p>
                  </div>
                  <span className="grid size-7 place-items-center rounded-[6px] bg-[#eef5e7] text-[#6a913f]">
                    <CircleCheck size={14} />
                  </span>
                </div>
                <div className="overflow-hidden rounded-[8px] border border-[#edf0ec]">
                  {[
                    ["Opening balance", openingBalance, "#"],
                    ["Cash-in", cashInTotal, "+"],
                    ["Cash-out & expenses", cashOutTotal + expenseTotal, "−"],
                    ["Commissions", commissions, "+"],
                  ].map(([label, amount, sign]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between border-b border-[#edf0ec] px-3 py-2 last:border-0"
                    >
                      <span className="text-[10px] text-[#758178]">{label}</span>
                      <span className="number-font text-[10px] font-medium text-[#3a4940]">
                        {sign === "#" ? "" : sign}
                        {formatMMK(Number(amount))} MMK
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between bg-[#f4f7f1] px-3 py-2.5">
                    <span className="text-[10px] font-semibold text-[#304439]">
                      System closing
                    </span>
                    <span className="number-font text-[12px] font-semibold text-[#21392b]">
                      {formatMMK(systemClosing)} MMK
                    </span>
                  </div>
                </div>

                {todaySession?.closingBalance != null && (
                  <div
                    className={`mt-3 flex items-center justify-between rounded-[7px] px-3 py-2 text-[10px] ${closingDifference === 0 ? "bg-[#eaf5df] text-[#4f7937]" : "bg-[#fff0e9] text-[#b05a3b]"}`}
                  >
                    <span className="font-semibold">
                      {closingDifference === 0 ? "Balanced" : "Discrepancy"} (Actual: {formatMMK(todaySession.closingBalance)})
                    </span>
                    <span className="number-font font-semibold">
                      {closingDifference === 0
                        ? "0 MMK"
                        : `${closingDifference! > 0 ? "+" : "−"}${formatMMK(Math.abs(closingDifference!))} MMK`}
                    </span>
                  </div>
                )}
              </div>

              <div className="rounded-[10px] border border-[#e4e8e3] bg-white p-4">
                <h3 className="m-0 text-[13px] font-semibold">Session Activity</h3>
                <div className="mt-3 space-y-3">
                  {[
                    { label: "Cash received", value: cashInTotal, color: "text-[#608c3f]" },
                    { label: "Cash paid out", value: cashOutTotal + expenseTotal, color: "text-[#bc7452]" },
                    { label: "Fees earned", value: commissions, color: "text-[#5282a0]" },
                  ].map((item) => (
                    <div key={item.label} className="flex justify-between text-[10px]">
                      <span className="text-[#6f7b73]">{item.label}</span>
                      <span className="number-font font-semibold text-[#34443b]">
                        {formatMMK(item.value)} MMK
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {activeTab === "reports" && (
            <section id="reports" className="scroll-mt-24">
              <div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
                <div>
                  <h3 className="m-0 text-[13px] font-semibold">Reports</h3>
                  <p className="mb-0 mt-0.5 text-[10px] text-[#8b968d]">
                    Filter by date range and export
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="h-8 rounded-[7px] border border-[#e1e6e0] bg-white px-2 text-[9px]"
                  />
                  <span className="text-[10px] text-[#8b968d]">to</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="h-8 rounded-[7px] border border-[#e1e6e0] bg-white px-2 text-[9px]"
                  />
                </div>
              </div>

              <div className="mb-3 flex items-center justify-between rounded-[8px] border border-[#e5e9e4] bg-white px-3 py-2">
                <div className="text-[9px] text-[#78847c]">
                  Total {filteredTransactions.length} records in range
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={exportExcel}
                    className="grid size-7 place-items-center rounded-[6px] text-[#568447] hover:bg-[#eef5e7]"
                    title="Export Excel"
                  >
                    <FileSpreadsheet size={15} />
                  </button>
                  <button
                    onClick={exportPdf}
                    className="grid size-7 place-items-center rounded-[6px] text-[#62809a] hover:bg-[#edf4f8]"
                    title="Export PDF"
                  >
                    <FileText size={15} />
                  </button>
                  <button
                    onClick={printThermalSlip}
                    className="grid size-7 place-items-center rounded-[6px] text-[#a36e48] hover:bg-[#fbf0e7]"
                    title="Print 80mm Slip"
                  >
                    <Printer size={15} />
                  </button>
                </div>
              </div>

              <div className="table-scroll rounded-[10px] border border-[#e4e8e3] bg-white">
                <table className="w-full min-w-[700px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-[#edf0ec] bg-[#fafbf9] text-[8.5px] font-semibold uppercase text-[#929d95]">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Time</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Customer</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-right">Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTransactions.map((tx) => (
                      <tr key={tx.id} className="border-b border-[#f0f2ef] text-[9px]">
                        <td className="px-3 py-2 text-[#77837a]">{tx.date}</td>
                        <td className="px-3 py-2 text-[#77837a]">{tx.time}</td>
                        <td className="px-3 py-2">{kindLabel(tx.kind)}</td>
                        <td className="px-3 py-2">{tx.customer || "Walk-in"}</td>
                        <td className="number-font px-3 py-2 text-right font-medium">
                          {formatMMK(tx.amount)} MMK
                        </td>
                        <td className="number-font px-3 py-2 text-right text-[#4c7540]">
                          {tx.commission ? `${formatMMK(tx.commission)} MMK` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </main>

      {/* Fixed Bottom Navigation Bar */}
      <nav
        className="app-bottom-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[#e0e6df] bg-white/95 backdrop-blur"
        aria-label="Primary navigation"
      >
        {(
          [
            { id: "overview", label: "Overview", icon: LayoutDashboard },
            { id: "wallet", label: "Wallet", icon: WalletCards },
            { id: "transactions", label: "Transactions", icon: ArrowLeftRight },
            { id: "reconciliation", label: "Reconciliation", icon: CircleCheck },
            { id: "reports", label: "Reports", icon: FileText },
          ] as { id: AppTab; label: string; icon: IconComponent }[]
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className={`flex h-full w-full min-w-0 flex-col items-center justify-center gap-0.5 border-l border-[#f0f2ef] px-0 pt-1.5 font-medium transition-colors first:border-l-0 ${active ? "text-[#315d3e]" : "text-[#87928a]"}`}
            >
              <span
                className={`grid size-7 place-items-center rounded-[8px] ${active ? "bg-[#eaf4e0]" : ""}`}
              >
                <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
              </span>
              <span className="nav-label text-[10px]">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Admin Unlock Modal */}
      {modal === "admin" && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#10231c]/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <form
            onSubmit={confirmAdminUnlock}
            className="w-full max-w-[380px] rounded-t-[12px] bg-white p-5 sm:rounded-[12px]"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="m-0 text-[14px] font-semibold">Admin Authorization</h3>
              <button
                type="button"
                onClick={() => setModal(null)}
                className="grid size-8 place-items-center rounded-[6px] text-[#66756b]"
              >
                <X size={16} />
              </button>
            </div>
            <p className="mb-3 text-[11px] text-[#7d8980]">
              Enter admin password ("admin") to unlock.
            </p>
            <input
              required
              autoFocus
              type="password"
              placeholder="Password"
              value={adminPassword}
              onChange={(e) => {
                setAdminPassword(e.target.value);
                setAdminError("");
              }}
              className="w-full rounded-[7px] border border-[#e1e6e0] p-2 text-xs outline-none"
            />
            {adminError && (
              <p className="mb-0 mt-1.5 text-[10px] text-[#b05a3b]">{adminError}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModal(null)}
                className="h-8 rounded-[7px] border border-[#e3e8e2] px-3 text-[10px]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-8 rounded-[7px] bg-[#173c31] px-4 text-[10px] font-semibold text-white"
              >
                Unlock
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Wallet Management Modal */}
      {modal === "accounts" && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#10231c]/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <div className="max-h-[85vh] w-full max-w-[650px] overflow-y-auto rounded-t-[12px] bg-white p-5 sm:rounded-[12px]">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="m-0 text-[15px] font-semibold">Wallets & Accounts</h3>
              <button
                onClick={() => setModal(null)}
                className="grid size-8 place-items-center rounded-[6px] text-[#66756b]"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={submitAccount} className="mb-4 rounded-[8px] border border-[#e4e8e3] p-3.5">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <input
                  required
                  placeholder="Account name (e.g. KBZPay)"
                  value={accountForm.name}
                  onChange={(e) =>
                    setAccountForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  className="rounded-[6px] border border-[#e1e6e0] p-2 text-xs outline-none"
                />
                <input
                  placeholder="Short label"
                  value={accountForm.shortName}
                  onChange={(e) =>
                    setAccountForm((prev) => ({ ...prev, shortName: e.target.value }))
                  }
                  className="rounded-[6px] border border-[#e1e6e0] p-2 text-xs outline-none"
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {accountColorOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      setAccountForm((prev) => ({ ...prev, color: opt.id }))
                    }
                    className={`flex h-7 items-center gap-1.5 rounded-[6px] border px-2 text-[9px] ${accountForm.color === opt.id ? "border-[#54764d] bg-[#f1f7eb]" : "border-[#e3e8e2]"}`}
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: opt.swatch }}
                    />
                    {opt.name}
                  </button>
                ))}
              </div>

              <div className="mt-3 flex justify-end">
                <button
                  type="submit"
                  className="h-8 rounded-[6px] bg-[#173c31] px-3.5 text-[10px] font-semibold text-white"
                >
                  {editingAccountId ? "Save Account" : "Add Account"}
                </button>
              </div>
            </form>

            <div className="space-y-1.5">
              {ledger.accounts.map((acc) => (
                <div
                  key={acc.id}
                  className="flex items-center justify-between rounded-[7px] border border-[#e5e9e4] px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <AccountBadge account={acc} compact />
                    <span className="text-[#34443b]">{acc.name}</span>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => editAccount(acc)}
                      className="grid size-7 place-items-center text-[#688071]"
                    >
                      <Pencil size={12} />
                    </button>
                    {acc.id !== "cash-drawer" && (
                      <button
                        onClick={() => deleteAccount(acc)}
                        className="grid size-7 place-items-center text-[#a66e5a]"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Opening / Closing Balances Modal */}
      {(modal === "open" || modal === "close") && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#10231c]/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <div className="max-h-[85vh] w-full max-w-[400px] overflow-y-auto rounded-t-[12px] bg-white p-5 sm:rounded-[12px]">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="m-0 text-[14px] font-semibold">
                {modal === "open" ? "Edit Opening Balance" : "Edit Closing Balance"}
              </h3>
              <button
                onClick={() => setModal(null)}
                className="grid size-8 place-items-center rounded-[6px] text-[#66756b]"
              >
                <X size={16} />
              </button>
            </div>

            {modal === "open" ? (
              <form onSubmit={openSession} className="space-y-2.5">
                {openingAccounts.map((acc) => {
                  const selected = openingAccountIds.includes(acc.id);
                  const isCash = acc.id === "cash-drawer";
                  return (
                    <div key={acc.id} className="rounded-[7px] border border-[#e5e9e4] p-2.5">
                      <label className="flex items-center gap-2 text-xs font-medium text-[#34443b]">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={isCash}
                          onChange={(e) => {
                            setOpeningAccountIds((prev) =>
                              e.target.checked
                                ? [...prev, acc.id]
                                : prev.filter((id) => id !== acc.id),
                            );
                            if (e.target.checked) {
                              setOpeningAmounts((prev) => ({
                                ...prev,
                                [acc.id]: prev[acc.id] ?? "0",
                              }));
                            }
                          }}
                          className="accent-[#527d3a]"
                        />
                        <span>{acc.name}</span>
                      </label>
                      {selected && (
                        <input
                          required
                          min="0"
                          type="number"
                          placeholder="Opening MMK"
                          value={openingAmounts[acc.id] ?? "0"}
                          onChange={(e) =>
                            setOpeningAmounts((prev) => ({
                              ...prev,
                              [acc.id]: e.target.value,
                            }))
                          }
                          className="mt-1.5 w-full rounded-[6px] border border-[#e1e6e0] p-1.5 text-xs outline-none"
                        />
                      )}
                    </div>
                  );
                })}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="h-8 rounded-[6px] border border-[#e3e8e2] px-3 text-[10px]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="h-8 rounded-[6px] bg-[#173c31] px-4 text-[10px] font-semibold text-white"
                  >
                    Save Opening
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={closeSession} className="space-y-2.5">
                {todayActiveAccounts.map((acc) => (
                  <div key={acc.id} className="rounded-[7px] border border-[#e5e9e4] p-2.5">
                    <div className="mb-1 flex justify-between text-[11px] font-medium text-[#34443b]">
                      <span>{acc.name}</span>
                      <span className="text-[#6c7970]">
                        Sys: {formatMMK(accountBalances[acc.id] ?? 0)}
                      </span>
                    </div>
                    <input
                      required
                      min="0"
                      type="number"
                      placeholder="Actual Ground MMK"
                      value={closingAmounts[acc.id] ?? ""}
                      onChange={(e) =>
                        setClosingAmounts((prev) => ({
                          ...prev,
                          [acc.id]: e.target.value,
                        }))
                      }
                      className="w-full rounded-[6px] border border-[#e1e6e0] p-1.5 text-xs outline-none"
                    />
                  </div>
                ))}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="h-8 rounded-[6px] border border-[#e3e8e2] px-3 text-[10px]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="h-8 rounded-[6px] bg-[#173c31] px-4 text-[10px] font-semibold text-white"
                  >
                    Close Session
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
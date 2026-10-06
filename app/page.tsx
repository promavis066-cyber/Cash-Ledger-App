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
  LogOut,
  Pencil,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  Search,
  Star,
  Trash2,
  TrendingUp,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
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
} from "@/lib/ledger";
import {
  commitLedgerChanges,
  deleteCustomerRecord,
  loadCustomerAnalyticsTransactions,
  loadLedgerSnapshot,
  type CustomerAnalyticsTransaction,
  type CustomerDirectoryEntry,
  updateCustomerRecord,
} from "@/lib/ledgerDatabase";
import { supabase } from "@/lib/supabase";

type ModalKind = "open" | "close" | "accounts" | "admin" | null;
type AppTab =
  | "overview"
  | "wallet"
  | "transactions"
  | "reconciliation"
  | "customers"
  | "reports";
type IconComponent = typeof Activity;
type AdminAction = "reopen" | "date";
type CustomerReportRange = "today" | "month" | "all" | "custom";
const ADMIN_PASSWORD = "admin";

function customerPhoneKey(phone: string) {
  return phone.replace(/\D/g, "").replace(/^0+/, "");
}

function customerPairKey(name: string, phone: string) {
  return `${name.trim().toLocaleLowerCase()}|${customerPhoneKey(phone)}`;
}

function uniqueCustomerEntries(
  customers: CustomerDirectoryEntry[],
): CustomerDirectoryEntry[] {
  const unique = new Map<string, CustomerDirectoryEntry>();
  for (const customer of customers) {
    const key = customerPairKey(customer.name, customer.phone);
    const existing = unique.get(key);
    if (
      !existing ||
      (customer.is_favorite && !existing.is_favorite) ||
      (customer.is_favorite === existing.is_favorite &&
        customer.lastUsed > existing.lastUsed)
    ) {
      unique.set(key, customer);
    }
  }
  return [...unique.values()];
}

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
  flowSign,
}: {
  account: AccountDefinition;
  compact?: boolean;
  flowSign?: "(-)" | "(+)";
}) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-[6px] ${compact ? "px-1.5 py-0.5 text-[8px]" : "px-2 py-1 text-[9px]"} font-medium ${accountColorBadge(account.color)}`}
    >
      {flowSign ? (
        <span className="shrink-0 font-semibold">{flowSign}</span>
      ) : (
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{
            backgroundColor:
              accountColorOptions.find((option) => option.id === account.color)
                ?.swatch ?? "#c6f36b",
          }}
        />
      )}
      {account.shortName}
    </span>
  );
}

function TransactionChannels({
  accountList,
  transaction,
  showFlowSigns = false,
}: {
  accountList: AccountDefinition[];
  transaction: LedgerTransaction;
  showFlowSigns?: boolean;
}) {
  const from = accountList.find(
    (account) => account.id === transaction.fromAccountId,
  );
  const to = accountList.find(
    (account) => account.id === transaction.toAccountId,
  );
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {from && (
        <AccountBadge
          account={from}
          compact
          flowSign={showFlowSigns ? "(-)" : undefined}
        />
      )}
      {to && (
        <>
          <span className="text-[#98a39b]">→</span>
          <AccountBadge
            account={to}
            compact
            flowSign={showFlowSigns ? "(+)" : undefined}
          />
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
  CASH_IN: "bg-[#2563eb] text-white",
  CASH_OUT: "bg-[#dc2626] text-white",
  TRANSFER: "bg-[#fbbf24] text-[#422006]",
  EXPENSE: "bg-[#16a34a] text-white",
};

function getDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatCurrencyInputValue(value: string) {
  const sanitized = value.replace(/[^\d.]/g, "");
  const decimalIndex = sanitized.indexOf(".");
  const integerPart =
    decimalIndex < 0 ? sanitized : sanitized.slice(0, decimalIndex);
  const fractionPart =
    decimalIndex < 0
      ? ""
      : `.${sanitized.slice(decimalIndex + 1).replace(/\./g, "")}`;
  return `${integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fractionPart}`;
}

function parseCurrencyInput(value: string) {
  const sanitized = value.replace(/[^\d.]/g, "");
  const decimalIndex = sanitized.indexOf(".");
  const normalized =
    decimalIndex < 0
      ? sanitized
      : `${sanitized.slice(0, decimalIndex + 1)}${sanitized
          .slice(decimalIndex + 1)
          .replace(/\./g, "")}`;
  return Number(normalized && normalized !== "." ? normalized : 0);
}

function inputCaretAfterDigits(value: string, digitCount: number) {
  if (digitCount <= 0) return 0;
  let digitsSeen = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (/\d/.test(value[index])) digitsSeen += 1;
    if (digitsSeen === digitCount) return index + 1;
  }
  return value.length;
}

function updateCurrencyInput(
  input: HTMLInputElement,
  setValue: (value: string) => void,
) {
  const prefixBeforeCaret = formatCurrencyInputValue(
    input.value.slice(0, input.selectionStart ?? input.value.length),
  );
  const formatted = formatCurrencyInputValue(input.value);
  setValue(formatted);
  window.requestAnimationFrame(() => {
    const caret = Math.min(prefixBeforeCaret.length, formatted.length);
    input.setSelectionRange(caret, caret);
  });
}

function formatMyanmarPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (!digits) return "";
  const nationalDigits = digits.startsWith("09")
    ? digits.slice(2)
    : digits.startsWith("0")
      ? digits.slice(1)
      : digits;
  const groupedDigits = nationalDigits
    .slice(0, 9)
    .replace(/(\d{3})(?=\d)/g, "$1 ");
  return groupedDigits ? `09 ${groupedDigits}` : "09";
}

function updatePhoneInput(
  input: HTMLInputElement,
  setValue: (value: string) => void,
) {
  const rawDigits = input.value.replace(/\D/g, "");
  const rawDigitsBeforeCaret = input.value
    .slice(0, input.selectionStart ?? input.value.length)
    .replace(/\D/g, "").length;
  const formatted = formatMyanmarPhone(input.value);
  const digitsBeforeCaret = rawDigits.startsWith("09")
    ? rawDigitsBeforeCaret
    : rawDigits.startsWith("0")
      ? rawDigitsBeforeCaret <= 1
        ? rawDigitsBeforeCaret
        : rawDigitsBeforeCaret + 1
      : rawDigitsBeforeCaret + 2;
  setValue(formatted);
  window.requestAnimationFrame(() => {
    const caret = inputCaretAfterDigits(
      formatted,
      Math.min(digitsBeforeCaret, formatted.replace(/\D/g, "").length),
    );
    input.setSelectionRange(caret, caret);
  });
}

function formatCustomerName(value: string) {
  return value.replace(/[^A-Za-z ]/g, "").toUpperCase();
}

function updateCustomerNameInput(
  input: HTMLInputElement,
  setValue: (value: string) => void,
) {
  const validCharactersBeforeCaret = formatCustomerName(
    input.value.slice(0, input.selectionStart ?? input.value.length),
  ).length;
  const formatted = formatCustomerName(input.value);
  setValue(formatted);
  window.requestAnimationFrame(() => {
    input.setSelectionRange(validCharactersBeforeCaret, validCharactersBeforeCaret);
  });
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

function formatTransactionTimestamp(timestamp?: string | null) {
  if (!timestamp) return "Unknown";
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
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
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    let mounted = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
      setAuthError("");
    });

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          console.error("Could not restore the Supabase auth session.", error);
          setAuthError(error.message);
        } else {
          setUser(data.session?.user ?? null);
        }
        setAuthLoading(false);
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        console.error("Could not restore the Supabase auth session.", error);
        setAuthError(
          error instanceof Error ? error.message : "Could not restore session.",
        );
        setAuthLoading(false);
      });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Could not sign out of Supabase.", error);
      throw error;
    }
  }

  if (authLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f3f5f2] p-5 text-sm text-[#657269]">
        Restoring your secure session…
      </div>
    );
  }

  if (!user) {
    return <AuthenticationView error={authError} />;
  }

  return <LedgerDashboard key={user.id} user={user} onSignOut={signOut} />;
}

function AuthenticationView({ error }: { error: string }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      if (mode === "signup") {
        const { data, error: signupError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signupError) throw signupError;
        if (!data.session) {
          setMessage("Check your email to confirm your account, then sign in.");
        }
      } else {
        const { error: loginError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (loginError) throw loginError;
      }
    } catch (submitError) {
      console.error("Supabase email/password authentication failed.", submitError);
      setMessage(
        submitError instanceof Error
          ? submitError.message
          : "Authentication failed. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f3f5f2] px-4 py-10">
      <section className="w-full max-w-[420px] rounded-2xl border border-[#e3e8e2] bg-white p-6 shadow-[0_18px_60px_rgba(23,60,49,0.08)] sm:p-9">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-[#c6f36b] text-[#173c31]">
            <Activity size={22} strokeWidth={2.5} />
          </span>
          <div>
            <p className="m-0 text-lg font-semibold tracking-tight text-[#17251f]">
              Cash Ledger
            </p>
            <p className="m-0 mt-0.5 text-xs text-[#7b8780]">
              Secure cloud-backed operations
            </p>
          </div>
        </div>
        <h1 className="m-0 text-2xl font-semibold tracking-tight text-[#17251f]">
          {mode === "login" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mb-6 mt-2 text-sm leading-6 text-[#7b8780]">
          {mode === "login"
            ? "Sign in to access your cash ledger."
            : "Create an account to start using your private ledger."}
        </p>
        <form className="space-y-4" onSubmit={submit}>
          <label className="field-label text-xs">
            Email address
            <span className="input-wrap h-11 rounded-lg">
              <input
                autoComplete="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </span>
          </label>
          <label className="field-label text-xs">
            Password
            <span className="input-wrap h-11 rounded-lg">
              <input
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                required
              />
            </span>
          </label>
          {(error || message) && (
            <p
              role="alert"
              className="m-0 rounded-lg bg-[#fff4ee] px-3 py-2.5 text-sm leading-5 text-[#a65335]"
            >
              {message || error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="flex h-11 w-full items-center justify-center rounded-lg bg-[#173c31] px-4 text-sm font-semibold text-white transition hover:bg-[#245745] disabled:cursor-wait disabled:opacity-65"
          >
            {submitting
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>
        <p className="mb-0 mt-6 text-center text-sm text-[#7b8780]">
          {mode === "login" ? "New to Cash Ledger?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setMessage("");
            }}
            className="font-semibold text-[#245745] hover:underline"
          >
            {mode === "login" ? "Create account" : "Sign in"}
          </button>
        </p>
      </section>
    </main>
  );
}

function LedgerDashboard({
  user,
  onSignOut,
}: {
  user: User;
  onSignOut: () => Promise<void>;
}) {
  const today = getDateKey(new Date());
  const [activeDate, setActiveDate] = useState(today);
  const [unlockedDate, setUnlockedDate] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerData>(emptyLedger);
  const [hydrated, setHydrated] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
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
  const [expenseAccountId, setExpenseAccountId] =
    useState<AccountId>("cash-drawer");
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
  const [customerDirectory, setCustomerDirectory] = useState<
    CustomerDirectoryEntry[]
  >([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(
    null,
  );
  const [customerEditName, setCustomerEditName] = useState("");
  const [customerEditPhone, setCustomerEditPhone] = useState("");
  const [customerReportRange, setCustomerReportRange] =
    useState<CustomerReportRange>("today");
  const [customerReportFrom, setCustomerReportFrom] = useState(today);
  const [customerReportTo, setCustomerReportTo] = useState(today);
  const [cloudCustomerAnalytics, setCloudCustomerAnalytics] = useState<{
    key: string;
    rows: CustomerAnalyticsTransaction[];
  } | null>(null);
  const [activeCustomerField, setActiveCustomerField] = useState<
    "name" | "phone" | null
  >(null);
  const customerFieldsRef = useRef<HTMLDivElement>(null);
  const customerMutationsRef = useRef(new Set<string>());
  const [noteInput, setNoteInput] = useState("");
  const [sessionSearch, setSessionSearch] = useState("");
  const [sessionKindFilter, setSessionKindFilter] =
    useState<TransactionKind | "ALL">("ALL");
  const [sessionWalletFilter, setSessionWalletFilter] =
    useState<AccountId | "ALL">("ALL");
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [message, setMessage] = useState("");
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      )
      .catch((error: unknown) => {
        console.error("Could not disable offline service-worker caching.", error);
      });
    if ("caches" in window) {
      void caches.delete("cash-ledger-shell-v4").catch((error: unknown) => {
        console.error("Could not clear the offline app cache.", error);
      });
    }
  }, []);

  useEffect(() => {
    const handleStatusChange = () => setIsOnline(window.navigator.onLine);
    handleStatusChange();
    window.addEventListener("online", handleStatusChange);
    window.addEventListener("offline", handleStatusChange);
    return () => {
      window.removeEventListener("online", handleStatusChange);
      window.removeEventListener("offline", handleStatusChange);
    };
  }, []);

  useEffect(() => {
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !customerFieldsRef.current?.contains(event.target)
      ) {
        setActiveCustomerField(null);
      }
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () =>
      document.removeEventListener("pointerdown", handleOutsidePointerDown);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadLedgerSnapshot(user)
      .then((snapshot) => {
        if (cancelled) return;
        setLedger(snapshot.ledger);
        setCustomerDirectory(uniqueCustomerEntries(snapshot.customers));
        setHydrated(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("Could not load the user's Supabase ledger.", error);
        setLoadError(
          error instanceof Error
            ? error.message
            : "Could not load your cloud ledger.",
        );
        setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const todaySession =
    ledger.sessions.find((session) => session.date === activeDate) ?? null;
  const accounts = ledger.accounts.filter((account) => !account.deletedAt);
  const todayActiveAccounts = todaySession
    ? ledger.accounts.filter((account) =>
        todaySession.activeAccountIds.includes(account.id),
      )
    : [];
  const openingAccounts = accounts;
  const todayTransactions = useMemo(
    () =>
      ledger.transactions.filter(
        (transaction) => transaction.date === activeDate,
      ).sort(
          (left, right) =>
            new Date(left.created_at ?? 0).getTime() -
            new Date(right.created_at ?? 0).getTime(),
      ),
    [ledger.transactions, activeDate],
  );
  const sessionTransactions = useMemo(() => {
    const query = sessionSearch.trim().toLowerCase();
    return todayTransactions.filter((transaction) => {
      const matchesKind =
        sessionKindFilter === "ALL" || transaction.kind === sessionKindFilter;
      const matchesWallet =
        sessionWalletFilter === "ALL" ||
        transaction.fromAccountId === sessionWalletFilter ||
        transaction.toAccountId === sessionWalletFilter ||
        commissionAccountId(transaction) === sessionWalletFilter;
      const searchableText = [
        transaction.customer,
        transaction.phone,
        transaction.note,
        transaction.date,
        transaction.time,
        kindLabel(transaction.kind),
        accountName(ledger.accounts, transaction.fromAccountId),
        accountName(ledger.accounts, transaction.toAccountId),
        accountName(ledger.accounts, commissionAccountId(transaction)),
      ]
        .join(" ")
        .toLowerCase();
      return (
        matchesKind &&
        matchesWallet &&
        (!query || searchableText.includes(query))
      );
    });
  }, [
    ledger.accounts,
    sessionKindFilter,
    sessionSearch,
    sessionWalletFilter,
    todayTransactions,
  ]);
  const filteredTransactions = useMemo(
    () =>
      ledger.transactions.filter(
        (transaction) =>
          transaction.date >= dateFrom && transaction.date <= dateTo,
      ),
    [dateFrom, dateTo, ledger.transactions],
  );
  const reportSessions = useMemo(
    () =>
      ledger.sessions
        .filter((session) => session.date >= dateFrom && session.date <= dateTo)
        .sort((left, right) => left.date.localeCompare(right.date)),
    [dateFrom, dateTo, ledger.sessions],
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
  const sortCustomerSuggestions = (customers: CustomerDirectoryEntry[]) =>
    uniqueCustomerEntries(customers).sort(
      (left, right) =>
        Number(right.is_favorite) - Number(left.is_favorite) ||
        right.lastUsed.localeCompare(left.lastUsed) ||
        left.name.localeCompare(right.name),
    );
  const customerNameSuggestions = customerInput.trim()
    ? sortCustomerSuggestions(customerDirectory
        .filter((customer) =>
          customer.name
            .toLowerCase()
            .includes(customerInput.trim().toLowerCase()),
        ))
    : [];
  const customerPhoneQuery = customerPhoneKey(phoneInput);
  const customerPhoneSuggestions = customerPhoneQuery
    ? sortCustomerSuggestions(customerDirectory
        .filter((customer) =>
          customerPhoneKey(customer.phone).includes(customerPhoneQuery),
        ))
    : [];
  const transferAccountError =
    transactionKind === "TRANSFER" && fromAccountId === toAccountId;
  const closingDifference =
    todaySession?.closingBalance == null
      ? null
      : todaySession.closingBalance - systemClosing;
  const reportDailyRows = useMemo(
    () =>
      reportSessions.flatMap((session) => {
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
      }),
    [filteredTransactions, ledger.accounts, reportSessions],
  );
  const reportAccountIds = useMemo(
    () => new Set(reportDailyRows.map((row) => row.accountId)),
    [reportDailyRows],
  );
  const reportWalletRows = useMemo(
    () =>
      ledger.accounts
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
            closing: rows[rows.length - 1]?.systemClosing ?? 0,
          };
        }),
    [ledger.accounts, reportAccountIds, reportDailyRows],
  );
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
  const customerAnalyticsRange = useMemo(() => {
    const startDate =
      customerReportRange === "today"
        ? today
        : customerReportRange === "month"
          ? `${today.slice(0, 7)}-01`
          : customerReportRange === "custom"
            ? customerReportFrom
            : undefined;
    const endDate =
      customerReportRange === "today"
        ? today
        : customerReportRange === "month"
          ? today
          : customerReportRange === "custom"
            ? customerReportTo
            : undefined;
    return {
      key: `${customerReportRange}:${startDate ?? ""}:${endDate ?? ""}`,
      startDate,
      endDate,
    };
  }, [customerReportFrom, customerReportRange, customerReportTo, today]);
  useEffect(() => {
    if (activeTab !== "reports") return;
    let cancelled = false;
    void loadCustomerAnalyticsTransactions(
      user,
      customerAnalyticsRange.startDate,
      customerAnalyticsRange.endDate,
    )
      .then((rows) => {
        if (!cancelled) {
          setCloudCustomerAnalytics({
            key: customerAnalyticsRange.key,
            rows,
          });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("Could not query customer analytics from Supabase.", error);
        setCloudCustomerAnalytics(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, customerAnalyticsRange, user]);
  const customerAnalyticsTransactions = useMemo(() => {
    if (cloudCustomerAnalytics?.key === customerAnalyticsRange.key)
      return cloudCustomerAnalytics.rows;
    return ledger.transactions.filter(
      (transaction) =>
        (!customerAnalyticsRange.startDate ||
          transaction.date >= customerAnalyticsRange.startDate) &&
        (!customerAnalyticsRange.endDate ||
          transaction.date <= customerAnalyticsRange.endDate),
    );
  }, [
    cloudCustomerAnalytics,
    customerAnalyticsRange,
    ledger.transactions,
  ]);
  const customerRankings = useMemo(() => {
    const byPair = new Map<
      string,
      {
        name: string;
        phone: string;
        count: number;
        cashIn: number;
        cashOut: number;
        commission: number;
      }
    >();
    for (const transaction of customerAnalyticsTransactions) {
      const name = transaction.customer.trim();
      const phone = transaction.phone.trim();
      if (!name && !phone) continue;
      const key = customerPairKey(name, phone);
      const ranking = byPair.get(key) ?? {
        name: name || "Unnamed customer",
        phone,
        count: 0,
        cashIn: 0,
        cashOut: 0,
        commission: 0,
      };
      ranking.count += 1;
      if (transaction.kind === "CASH_IN") ranking.cashIn += transaction.amount;
      if (transaction.kind === "CASH_OUT")
        ranking.cashOut += transaction.amount;
      ranking.commission += transaction.commission;
      byPair.set(key, ranking);
    }
    const all = Array.from(byPair.values());
    return {
      frequent: [...all].sort((a, b) => b.count - a.count),
      cashIn: [...all]
        .filter((item) => item.cashIn > 0)
        .sort((a, b) => b.cashIn - a.cashIn),
      cashOut: [...all]
        .filter((item) => item.cashOut > 0)
        .sort((a, b) => b.cashOut - a.cashOut),
      commission: [...all]
        .filter((item) => item.commission > 0)
        .sort((a, b) => b.commission - a.commission),
    };
  }, [customerAnalyticsTransactions]);
  const customerDirectoryRows = useMemo(() => {
    const stats = new Map<
      string,
      { count: number; lastActive: string | null }
    >();
    for (const transaction of ledger.transactions) {
      const key = customerPairKey(transaction.customer, transaction.phone);
      if (key === "|") continue;
      const existing = stats.get(key) ?? { count: 0, lastActive: null };
      existing.count += 1;
      if (!existing.lastActive || transaction.date > existing.lastActive)
        existing.lastActive = transaction.date;
      stats.set(key, existing);
    }
    const query = customerSearch.trim().toLocaleLowerCase();
    return uniqueCustomerEntries(customerDirectory)
      .filter(
        (customer) =>
          (!favoritesOnly || customer.is_favorite) &&
          (!query ||
            customer.name.toLocaleLowerCase().includes(query) ||
            customer.phone.toLocaleLowerCase().includes(query)),
      )
      .map((customer) => ({
        ...customer,
        stats: stats.get(customerPairKey(customer.name, customer.phone)) ?? {
          count: 0,
          lastActive: null,
        },
      }))
      .sort(
        (left, right) =>
          Number(right.is_favorite) - Number(left.is_favorite) ||
          left.name.localeCompare(right.name),
      );
  }, [customerDirectory, customerSearch, favoritesOnly, ledger.transactions]);

  function notify(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 3500);
  }

  async function persistChanges(
    nextLedger: LedgerData,
    nextCustomers: CustomerDirectoryEntry[] = customerDirectory,
  ): Promise<boolean> {
    if (!isOnline) {
      notify("Offline — Internet connection required to use the ledger.");
      return false;
    }
    if (isSaving) return false;
    setIsSaving(true);
    try {
      await commitLedgerChanges(
        user,
        ledger,
        nextLedger,
        customerDirectory,
        nextCustomers,
      );
      setLedger(nextLedger);
      setCustomerDirectory(nextCustomers);
      return true;
    } catch (error) {
      console.error("Supabase operation failed; local state was not changed.", error);
      notify(
        error instanceof Error
          ? error.message
          : "Supabase could not save your changes.",
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function runCustomerMutation(
    action: () => Promise<void>,
    onSuccess: () => void,
  ): Promise<boolean> {
    if (!isOnline) {
      notify("Offline — Internet connection required to use the ledger.");
      return false;
    }
    if (isSaving || customerMutationsRef.current.has("active")) return false;
    customerMutationsRef.current.add("active");
    setIsSaving(true);
    try {
      await action();
      onSuccess();
      return true;
    } catch (error) {
      console.error("Supabase customer operation failed.", error);
      notify(
        error instanceof Error
          ? error.message
          : "Supabase could not save the customer change.",
      );
      return false;
    } finally {
      customerMutationsRef.current.delete("active");
      setIsSaving(false);
    }
  }

  async function handleSignOut() {
    try {
      await onSignOut();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not sign out right now.",
      );
    }
  }

  function selectCustomer(customer: CustomerDirectoryEntry) {
    setCustomerInput(customer.name);
    setPhoneInput(customer.phone);
    setActiveCustomerField(null);
  }

  function rememberCustomer(
    nameValue: string,
    phoneValue: string,
  ): CustomerDirectoryEntry[] {
    const name = nameValue.trim();
    const phone = phoneValue.trim();
    const phoneKey = customerPhoneKey(phone);
    if (!name && !phoneKey) return customerDirectory;

    const pairKey = customerPairKey(name, phone);
    const existing = customerDirectory.find(
      (customer) => customerPairKey(customer.name, customer.phone) === pairKey,
    );
    const updatedCustomer: CustomerDirectoryEntry = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      phone,
      lastUsed: new Date().toISOString(),
      is_favorite: existing?.is_favorite ?? false,
    };
    const updatedDirectory = existing
      ? customerDirectory.map((customer) =>
          customer.id === existing.id ? updatedCustomer : customer,
        )
      : [updatedCustomer, ...customerDirectory];

    return updatedDirectory;
  }

  async function toggleCustomerFavorite(customerId: string) {
    const customer = customerDirectory.find((item) => item.id === customerId);
    if (!customer) return;
    const updatedCustomer = {
      ...customer,
      is_favorite: !customer.is_favorite,
    };
    await runCustomerMutation(
      () => updateCustomerRecord(user, updatedCustomer),
      () =>
        setCustomerDirectory((current) =>
          current.map((item) =>
            item.id === customerId ? updatedCustomer : item,
          ),
        ),
    );
  }

  function beginCustomerEdit(customer: CustomerDirectoryEntry) {
    setEditingCustomerId(customer.id);
    setCustomerEditName(customer.name);
    setCustomerEditPhone(customer.phone);
  }

  function cancelCustomerEdit() {
    setEditingCustomerId(null);
    setCustomerEditName("");
    setCustomerEditPhone("");
  }

  async function saveCustomerEdit(customerId: string) {
    const name = customerEditName.trim();
    const phone = customerEditPhone.trim();
    if (!name && !phone) {
      notify("Enter a customer name or phone number.");
      return;
    }
    const customer = customerDirectory.find((item) => item.id === customerId);
    if (!customer) return;
    const updatedCustomer = {
      ...customer,
      name,
      phone,
      lastUsed: new Date().toISOString(),
    };
    if (
      await runCustomerMutation(
        () => updateCustomerRecord(user, updatedCustomer),
        () =>
          setCustomerDirectory((current) =>
            current.map((item) =>
              item.id === customerId ? updatedCustomer : item,
            ),
          ),
      )
    ) {
      cancelCustomerEdit();
      notify("Customer updated.");
    }
  }

  async function deleteCustomer(customer: CustomerDirectoryEntry) {
    if (!isOnline) {
      notify("Connect to the internet before updating your cloud ledger.");
      return;
    }
    if (
      !window.confirm(
        `Delete ${customer.name || customer.phone || "this customer"} from the record book? Existing transactions will be kept.`,
      )
    )
      return;
    if (
      !(await runCustomerMutation(
        () => deleteCustomerRecord(user, customer.id),
        () =>
          setCustomerDirectory((current) =>
            current.filter((item) => item.id !== customer.id),
          ),
      ))
    )
      return;
    if (editingCustomerId === customer.id) cancelCustomerEdit();
    notify("Customer removed from the record book.");
  }

  function exportCustomerRankings() {
    const rows = [
      ["Ranking", "Name", "Phone Number", "Metric", "Value"],
      ...(
        [
          ["Most Frequent", customerRankings.frequent, "Transactions", "count"],
          ["Top Cash-In", customerRankings.cashIn, "Cash-In MMK", "cashIn"],
          ["Top Cash-Out", customerRankings.cashOut, "Cash-Out MMK", "cashOut"],
          [
            "Top Commission",
            customerRankings.commission,
            "Commission MMK",
            "commission",
          ],
        ] as const
      ).flatMap(([label, customers, metric, key]) =>
        customers.map((customer) => [
          label,
          customer.name,
          customer.phone,
          metric,
          customer[key],
        ]),
      ),
    ];
    const csv = rows
      .map((row) =>
        row
          .map((value) => {
            const text = String(value);
            const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
            return `"${safe.replace(/"/g, '""')}"`;
          })
          .join(","),
      )
      .join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `customer-rankings-${customerReportRange}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function startOpeningFlow() {
    const activeIds =
      todaySession?.activeAccountIds ?? accounts.map((account) => account.id);
    setOpeningAccountIds(activeIds);
    setOpeningAmounts(
      Object.fromEntries(
        activeIds.map((id) => [
          id,
          formatCurrencyInputValue(
            String(todaySession?.accountBalances.opening[id] ?? 0),
          ),
        ]),
      ),
    );
    setModal("open");
  }

  function startClosingFlow() {
    setClosingAmounts(
      Object.fromEntries(
        todayActiveAccounts.map((account) => {
          const systemBalance = accountBalances[account.id] ?? 0;
          return [account.id, systemBalance === 0 ? "0" : ""];
        }),
      ),
    );
    const firstUncountedAccount = todayActiveAccounts.find(
      (account) => (accountBalances[account.id] ?? 0) !== 0,
    );
    if (firstUncountedAccount) {
      window.requestAnimationFrame(() => {
        document
          .getElementById(`closing-balance-${firstUncountedAccount.id}`)
          ?.focus();
      });
    }
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

  async function openSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isUpdatingOpening = Boolean(todaySession);
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
        parseCurrencyInput(openingAmounts[account.id] ?? ""),
      ]),
    );
    if (
      selectedAccounts.some(
        (account) =>
          !Number.isFinite(opening[account.id]) ||
          !Number.isInteger(opening[account.id]) ||
          opening[account.id] < 0,
      )
    ) {
      notify("Opening balances must be whole, non-negative amounts.");
      return;
    }
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
    const nextLedger = {
      ...ledger,
      sessions: [
        ...ledger.sessions.filter((session) => session.date !== activeDate),
        newSession,
      ],
    };
    if (!(await persistChanges(nextLedger))) return;
    setModal(null);
    notify(
      isUpdatingOpening
        ? "Opening balance updated successfully."
        : "Morning session opened. Opening balance recorded.",
    );
  }

  async function closeSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!todaySession || !isOpen) return;
    const groundClosing = Object.fromEntries(
      todayActiveAccounts.map((account) => [
        account.id,
        parseCurrencyInput(closingAmounts[account.id] ?? ""),
      ]),
    );
    if (
      todayActiveAccounts.some(
        (account) =>
          !Number.isFinite(groundClosing[account.id]) ||
          !Number.isInteger(groundClosing[account.id]) ||
          groundClosing[account.id] < 0,
      )
    )
      return;
    const totalGround = Object.values(groundClosing).reduce(
      (total, amount) => total + Number(amount),
      0,
    );
    const nextLedger = {
      ...ledger,
      sessions: ledger.sessions.map((session) =>
        session.date === activeDate
          ? {
              ...session,
              accountBalances: { ...session.accountBalances, groundClosing },
              closingBalance: totalGround,
              closedAt: new Date().toISOString(),
            }
          : session,
      ),
    };
    if (!(await persistChanges(nextLedger))) return;
    setUnlockedDate(null);
    setModal(null);
    notify("Session closed. Reconciliation is ready.");
  }

  async function addTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isOnline) {
      notify("Connect to the internet before updating your cloud ledger.");
      return;
    }
    const amount = parseCurrencyInput(amountInput);
    const commission =
      transactionKind === "TRANSFER" || transactionKind === "EXPENSE"
        ? 0
        : parseCurrencyInput(commissionInput);
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
        : transactionKind === "CASH_OUT"
          ? "cash-drawer"
          : transactionKind === "EXPENSE"
            ? expenseAccountId
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
      : isCashOut
        ? "cash-drawer"
        : transactionKind === "EXPENSE"
          ? expenseAccountId
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
    const {
      data: { user: authenticatedUser },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !authenticatedUser || authenticatedUser.id !== user.id) {
      const errorMessage =
        authError?.message ?? "Your authenticated user session is unavailable.";
      console.error("Cannot create transaction without the active user.", {
        authError,
        expectedUserId: user.id,
      });
      notify(`Could not save transaction: ${errorMessage}`);
      return;
    }
    const now = new Date();
    const existingTransaction = editingTransactionId
      ? ledger.transactions.find((item) => item.id === editingTransactionId)
      : undefined;
    const transaction: LedgerTransaction = {
      id: existingTransaction?.id ?? crypto.randomUUID(),
      user_id: authenticatedUser.id,
      session_id: existingTransaction?.session_id ?? todaySession?.date ?? null,
      created_at: existingTransaction?.created_at ?? now.toISOString(),
      updated_at: existingTransaction ? now.toISOString() : null,
      date: activeDate,
      time:
        existingTransaction?.time ??
        now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      kind: transactionKind,
      customer: transactionKind === "EXPENSE" ? "" : customerInput.trim(),
      phone:
        transactionKind === "TRANSFER" || transactionKind === "EXPENSE"
          ? ""
          : phoneInput.trim(),
      amount,
      commission,
      commissionAccountId: commissionDestination,
      note: noteInput.trim(),
      fromAccountId: source,
      toAccountId: destination,
    };
    const wasEditing = Boolean(editingTransactionId);
    const nextLedger: LedgerData = {
      ...ledger,
      transactions: editingTransactionId
        ? ledger.transactions.map((item) =>
            item.id === editingTransactionId
              ? { ...transaction, id: editingTransactionId }
              : item,
          )
        : [transaction, ...ledger.transactions],
    };
    const nextCustomers = rememberCustomer(
      transaction.customer,
      transaction.phone,
    );
    if (!(await persistChanges(nextLedger, nextCustomers))) return;
    setEditingTransactionId(null);
    setAmountInput("");
    setCommissionInput("");
    setCustomerInput("");
    setPhoneInput("");
    setNoteInput("");
    notify(
      wasEditing
        ? "Transaction updated."
        : `${kindLabel(transactionKind)} saved.`,
    );
  }

  function editTransaction(transaction: LedgerTransaction) {
    setEditingTransactionId(transaction.id);
    setTransactionKind(transaction.kind);
    setAmountInput(formatCurrencyInputValue(String(transaction.amount)));
    setCommissionInput(formatCurrencyInputValue(String(transaction.commission)));
    setCommissionDestinationId(
      transaction.commissionAccountId ?? "cash-drawer",
    );
    setCustomerInput(formatCustomerName(transaction.customer));
    setPhoneInput(formatMyanmarPhone(transaction.phone));
    setNoteInput(transaction.note);
    if (transaction.kind === "CASH_IN")
      setServiceAccountId(transaction.fromAccountId);
    if (transaction.kind === "CASH_OUT")
      setServiceAccountId(transaction.toAccountId ?? "cash-drawer");
    if (transaction.kind === "TRANSFER") {
      setFromAccountId(transaction.fromAccountId);
      setToAccountId(transaction.toAccountId ?? transaction.fromAccountId);
    }
    if (transaction.kind === "EXPENSE")
      setExpenseAccountId(transaction.fromAccountId);
    setTimeout(
      () =>
        document
          .getElementById("transaction-entry")
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      0,
    );
  }

  async function removeTransaction(id: string) {
    const nextLedger = {
      ...ledger,
      transactions: ledger.transactions.filter(
        (transaction) => transaction.id !== id,
      ),
    };
    if (!(await persistChanges(nextLedger))) return;
    if (editingTransactionId === id) setEditingTransactionId(null);
    notify("Transaction removed.");
  }

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = accountForm.name.trim();
    if (!name) return;
    const shortName = accountForm.shortName.trim() || name;
    let nextLedger = ledger;
    if (editingAccountId) {
      nextLedger = {
        ...ledger,
        accounts: ledger.accounts.map((account) =>
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
      };
    } else {
      const id = `account-${crypto.randomUUID()}`;
      const colors = ["sky", "gold", "rose", "mint"];
      const newAccount: AccountDefinition = {
        id,
        name,
        shortName,
        kind: accountForm.kind,
        accountNumber: accountForm.accountNumber.trim(),
        color:
          accountForm.color ||
          colors[ledger.accounts.length % colors.length],
        mark: name.slice(0, 1).toUpperCase(),
      };
      const activateInCurrentSession = Boolean(
        todaySession &&
          (todaySession.closedAt === null || isUnlocked),
      );
      nextLedger = {
        ...ledger,
        accounts: [...ledger.accounts, newAccount],
        sessions: activateInCurrentSession
          ? ledger.sessions.map((session) =>
              session.date === activeDate
                ? {
                    ...session,
                    activeAccountIds: session.activeAccountIds.includes(id)
                      ? session.activeAccountIds
                      : [...session.activeAccountIds, id],
                    accountBalances: {
                      ...session.accountBalances,
                      opening: {
                        ...session.accountBalances.opening,
                        [id]: 0,
                      },
                      groundClosing: {
                        ...session.accountBalances.groundClosing,
                        [id]: null,
                      },
                    },
                  }
                : session,
            )
          : ledger.sessions,
      };
    }
    if (!(await persistChanges(nextLedger))) return;
    setEditingAccountId(null);
    setAccountForm({
      name: "",
      shortName: "",
      kind: "wallet",
      accountNumber: "",
      color: "sky",
    });
    notify(
      editingAccountId
        ? "Account details updated."
        : todaySession && (todaySession.closedAt === null || isUnlocked)
          ? "Account added and activated in today’s session."
          : "Account added.",
    );
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

  async function deleteAccount(account: AccountDefinition) {
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
      const nextLedger = {
        ...ledger,
        accounts: ledger.accounts.map((item) =>
          item.id === account.id
            ? { ...item, deletedAt: new Date().toISOString() }
            : item,
        ),
      };
      if (!(await persistChanges(nextLedger))) return;
      notify(
        "Account archived. Historical sessions and reports are preserved.",
      );
    } else {
      const nextLedger = {
        ...ledger,
        accounts: ledger.accounts.filter((item) => item.id !== account.id),
      };
      if (!(await persistChanges(nextLedger))) return;
      notify("Account deleted.");
    }
    if (editingAccountId === account.id) setEditingAccountId(null);
  }

  async function restoreAccount(accountId: AccountId) {
    const nextLedger = {
      ...ledger,
      accounts: ledger.accounts.map((account) =>
        account.id === accountId ? { ...account, deletedAt: null } : account,
      ),
    };
    if (!(await persistChanges(nextLedger))) return;
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

  if (!hydrated) {
    return (
      <div className="min-h-screen bg-[#f3f5f2] text-sm text-[#657269]">
        {!isOnline && (
          <div
            role="alert"
            className="flex min-h-10 items-center justify-center bg-[#fff0e9] px-4 py-2 text-center text-[11px] font-medium text-[#a65335]"
          >
            Offline — Internet connection required to use the ledger.
          </div>
        )}
        <div className="grid min-h-[calc(100vh-40px)] place-items-center p-5">
          Loading your cloud ledger…
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <main className="min-h-screen bg-[#f3f5f2]">
        {!isOnline && (
          <div
            role="alert"
            className="flex min-h-10 items-center justify-center bg-[#fff0e9] px-4 py-2 text-center text-[11px] font-medium text-[#a65335]"
          >
            Offline — Internet connection required to use the ledger.
          </div>
        )}
        <div className="grid min-h-[calc(100vh-40px)] place-items-center px-4 py-10">
          <section className="w-full max-w-[440px] rounded-2xl border border-[#e3e8e2] bg-white p-6 shadow-sm sm:p-8">
            <h1 className="m-0 text-xl font-semibold text-[#17251f]">
              Could not load your ledger
            </h1>
            <p
              role="alert"
              className="mb-5 mt-3 text-sm leading-6 text-[#a65335]"
            >
              {loadError}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={!isOnline}
                onClick={() => window.location.reload()}
                className="h-10 flex-1 rounded-lg bg-[#173c31] px-4 text-sm font-semibold text-white hover:bg-[#245745]"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="h-10 rounded-lg border border-[#dfe5de] px-4 text-sm font-semibold text-[#526158] hover:bg-[#f6f8f5]"
              >
                Sign out
              </button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <div className="dashboard-shell flex min-h-screen">
      <aside className="hidden">
        <a
          href="#overview"
          className="mb-11 flex items-center gap-3 px-2 no-underline"
        >
          <span className="grid size-10 place-items-center rounded-[12px] bg-[#c6f36b] text-[#173c31]">
            <Activity size={21} strokeWidth={2.5} />
          </span>
          <span>
            <span className="block text-[19px] font-semibold tracking-[-0.5px]">
              ledger<span className="text-[#c6f36b]">.</span>
            </span>
            <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-[1.7px] text-white/45">
              Cash operations
            </span>
          </span>
        </a>
        <p className="mb-3 px-3 text-[9px] font-semibold uppercase tracking-[1.8px] text-white/40">
          Workspace
        </p>
        <nav className="flex flex-col gap-1" aria-label="Main navigation">
          <a
            href="#overview"
            className="flex h-10 items-center gap-3 rounded-[8px] bg-white/10 px-3 text-[12px] font-medium text-white no-underline"
          >
            <LayoutDashboard size={16} />
            Overview
            <span className="ml-auto size-1.5 rounded-full bg-[#c6f36b]" />
          </a>
          <a
            href="#transactions"
            className="flex h-10 items-center gap-3 rounded-[8px] px-3 text-[12px] text-white/65 transition hover:bg-white/7 hover:text-white no-underline"
          >
            <ArrowLeftRight size={16} />
            Transactions
          </a>
          <a
            href="#reconciliation"
            className="flex h-10 items-center gap-3 rounded-[8px] px-3 text-[12px] text-white/65 transition hover:bg-white/7 hover:text-white no-underline"
          >
            <CircleCheck size={16} />
            Reconciliation
          </a>
          <a
            href="#reports"
            className="flex h-10 items-center gap-3 rounded-[8px] px-3 text-[12px] text-white/65 transition hover:bg-white/7 hover:text-white no-underline"
          >
            <FileText size={16} />
            Reports
          </a>
        </nav>
        <div className="mt-9">
          <p className="mb-3 px-3 text-[9px] font-semibold uppercase tracking-[1.8px] text-white/40">
            Accounts
          </p>
          <nav className="flex flex-col gap-1" aria-label="Payment accounts">
            {accounts.map((account) => (
              <a
                key={account.id}
                href="#accounts"
                className="flex h-9 items-center gap-3 rounded-[8px] px-3 text-[11px] text-white/65 transition hover:bg-white/7 hover:text-white no-underline"
              >
                <span
                  className={`grid size-5 place-items-center rounded-[6px] text-[9px] font-bold ${accountColorBadge(account.color)}`}
                >
                  {account.mark}
                </span>
                {account.shortName}
              </a>
            ))}
          </nav>
        </div>
        <div className="mt-auto rounded-[10px] border border-white/10 bg-white/5 p-3.5">
          <div className="flex items-center gap-2 text-[10px] font-medium text-white/80">
            <span
              className={`size-1.5 rounded-full ${isOpen ? "animate-pulse bg-[#c6f36b]" : "bg-white/35"}`}
            />
            {isOpen
              ? "Session in progress"
              : isClosed
                ? "Day completed"
                : "No session started"}
          </div>
          <p className="mb-0 mt-2 text-[10px] leading-4 text-white/45">
            {isOpen
              ? `Opened ${todaySession?.openedAt ? new Date(todaySession.openedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "today"}`
              : "Your records are stored securely in the cloud."}
          </p>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        {!isOnline && (
          <div
            role="alert"
            className="flex min-h-10 items-center justify-center bg-[#fff0e9] px-4 py-2 text-center text-[11px] font-medium text-[#a65335]"
          >
            Offline — Internet connection required to use the ledger.
          </div>
        )}
        <header className="topbar-actions sticky top-0 z-20 flex min-h-[72px] items-center justify-between border-b border-[#e5e9e4] bg-[#f3f5f2]/95 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-3">
            <div>
              <p className="m-0 text-[10px] font-medium uppercase tracking-[1.5px] text-[#87928b]">
                Daily operations
              </p>
              <h1 className="m-0 mt-0.5 text-[15px] font-semibold tracking-[-0.25px] text-[#17251f]">
                Cash ledger
              </h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5 md:gap-4">
            <div className="flex shrink-0 items-center gap-1 rounded-[7px] border border-[#e1e6e0] bg-white px-2 py-1 text-[10px] text-[#526158] sm:gap-1.5 sm:text-xs">
              <CalendarDays
                size={14}
                className="hidden shrink-0 text-[#6e8b58] min-[390px]:block"
              />
              <span className="hidden font-medium sm:inline">Session date</span>
              <input
                aria-label="Active session date"
                type="date"
                value={activeDate}
                max={today}
                onChange={(event) => selectSessionDate(event.target.value)}
                className="w-[88px] bg-transparent text-[10px] font-semibold text-[#34443b] outline-none sm:w-[104px] sm:text-xs"
              />
            </div>
            {isOpen ? (
              <button
                aria-label="Close session"
                onClick={startClosingFlow}
                disabled={!isOnline || isSaving}
                className="flex h-9 shrink-0 items-center gap-2 rounded-[8px] bg-[#173c31] px-2.5 text-[11px] font-semibold text-white transition hover:bg-[#245745] sm:px-3.5"
              >
                <span className="size-1.5 rounded-full bg-[#c6f36b]" />
                <span className="hidden min-[390px]:inline">Close session</span>
              </button>
            ) : isClosed ? (
              <button
                aria-label="Reopen or edit session"
                onClick={() => requestAdminUnlock("reopen")}
                disabled={!isOnline || isSaving}
                className="flex h-9 shrink-0 items-center gap-2 rounded-[8px] border border-[#dce4da] bg-white px-2 text-[10px] font-semibold text-[#5c6a61] hover:bg-[#f5f8f3] sm:px-3"
              >
                <Pencil size={13} />
                <span className="hidden min-[420px]:inline">
                  Reopen / Edit Session
                </span>
              </button>
            ) : (
              <button
                aria-label="Open session"
                onClick={startOpeningFlow}
                disabled={!isOnline || isSaving}
                className="flex h-9 shrink-0 items-center gap-2 rounded-[8px] bg-[#173c31] px-2.5 text-[11px] font-semibold text-white transition hover:bg-[#245745] sm:px-3.5"
              >
                <Plus size={15} />
                <span className="hidden min-[390px]:inline">Open session</span>
              </button>
            )}
            <button
              type="button"
              aria-label="Sign out"
              title={`Sign out${user.email ? ` (${user.email})` : ""}`}
              onClick={handleSignOut}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] border border-[#dce4da] bg-white px-2 text-[10px] font-semibold text-[#526158] transition hover:bg-[#f5f8f3] sm:px-3"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>
        <div className="app-content mx-auto max-w-[1440px] px-4 pt-6 md:px-8 md:pt-8">
          {message && (
            <div
              role="status"
              className="fade-up mb-4 flex items-center gap-2 rounded-[8px] border border-[#d9e8c9] bg-[#eff7e6] px-3.5 py-2.5 text-[11px] text-[#42642d]"
            >
              <CircleCheck size={15} />
              <span className="min-w-0 flex-1">{message}</span>
            </div>
          )}
          {activeTab === "overview" && (
            <>
              <section className="fade-up mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[1.8px] text-[#8b968e]">
                    {formatDate(activeDate)}
                  </p>
                  <h2 className="m-0 text-[24px] font-semibold leading-tight tracking-[-0.9px] text-[#17251f] md:text-[29px]">
                    Good day, operator<span className="text-[#87a953]">.</span>
                  </h2>
                  <p className="mb-0 mt-2 text-[12px] text-[#7b8780]">
                    Your counter at a glance. Every kyat accounted for.
                  </p>
                </div>
                <div className="flex items-center gap-2 self-start rounded-[7px] border border-[#e1e6e0] bg-white px-3 py-2 text-[10px] text-[#657269] sm:self-auto">
                  <span
                    className={`size-1.5 rounded-full ${isOpen ? "bg-[#76aa42]" : isClosed ? "bg-[#87928b]" : "bg-[#efa265]"}`}
                  />
                  {isOpen
                    ? "Day is open"
                    : isClosed
                      ? "Day is closed"
                      : "Awaiting opening balance"}
                </div>
              </section>

              <section className="mb-5 grid gap-4 xl:grid-cols-[1.35fr_0.85fr]">
                <div className="relative min-h-[212px] overflow-hidden rounded-[11px] bg-[#173c31] p-5 text-white md:p-6">
                  <div className="pointer-events-none absolute -right-8 -top-14 size-60 rounded-full border border-white/8" />
                  <div className="pointer-events-none absolute -right-1 -top-7 size-44 rounded-full border border-white/8" />
                  <div className="relative flex h-full flex-col justify-between gap-8">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="mb-2 text-[10px] font-medium uppercase tracking-[1.7px] text-white/55">
                          Cash position · MMK
                        </p>
                        <p className="number-font m-0 text-[31px] font-semibold tracking-[-1px] md:text-[38px]">
                          {formatMMK(balances["cash-drawer"])}
                        </p>
                        <p className="mb-0 mt-2 text-[10px] text-white/55">
                          {isOpen
                            ? "Live drawer balance"
                            : isClosed
                              ? "Final drawer balance"
                              : "Opening balance not set"}
                        </p>
                      </div>
                      <span className="grid size-10 shrink-0 place-items-center rounded-[9px] bg-[#c6f36b] text-[#173c31]">
                        <WalletCards size={19} />
                      </span>
                    </div>
                    <div className="flex flex-wrap items-end justify-between gap-4 border-t border-white/15 pt-3.5">
                      <div className="flex gap-6">
                        <div>
                          <p className="m-0 text-[9px] uppercase tracking-[1px] text-white/50">
                            Opening
                          </p>
                          <p className="number-font mb-0 mt-1 text-[12px] font-medium">
                            {formatMMK(openingBalance)}{" "}
                            <span className="text-[9px] text-white/45">
                              MMK
                            </span>
                          </p>
                        </div>
                        <div>
                          <p className="m-0 text-[9px] uppercase tracking-[1px] text-white/50">
                            System close
                          </p>
                          <p className="number-font mb-0 mt-1 text-[12px] font-medium">
                            {formatMMK(systemClosing)}{" "}
                            <span className="text-[9px] text-white/45">
                              MMK
                            </span>
                          </p>
                        </div>
                      </div>
                      <span className="text-[9px] text-white/50">
                        Updated just now
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex min-h-[212px] flex-col justify-between rounded-[11px] border border-[#e4e8e3] bg-white p-5 md:p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[1.5px] text-[#8a958d]">
                        Session control
                      </p>
                      <h3 className="m-0 text-[16px] font-semibold tracking-[-0.3px]">
                        {isOpen
                          ? "Morning session"
                          : isClosed
                            ? "Session complete"
                            : "Start the day"}
                      </h3>
                    </div>
                    <span
                      className={`grid size-9 place-items-center rounded-[8px] ${isOpen ? "bg-[#eff7e6] text-[#6b963d]" : "bg-[#f3f5f2] text-[#768279]"}`}
                    >
                      {isOpen ? (
                        <Clock3 size={17} />
                      ) : isClosed ? (
                        <Check size={17} />
                      ) : (
                        <Activity size={17} />
                      )}
                    </span>
                  </div>
                  <p className="mb-4 mt-2 max-w-[320px] text-[11px] leading-5 text-[#849087]">
                    {isOpen
                      ? `Opened at ${new Date(todaySession!.openedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}. Record activity as it happens.`
                      : isClosed
                        ? `Closed at ${new Date(todaySession!.closedAt!).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}. Today’s figures are locked in.`
                        : "Enter the physical opening cash before you start recording today’s transactions."}
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-[#edf0ec] pt-3.5">
                    <span className="text-[10px] text-[#87928a]">
                      {todayTransactions.length} transaction
                      {todayTransactions.length === 1 ? "" : "s"} today
                    </span>
                    {!todaySession && (
                      <button
                        onClick={startOpeningFlow}
                        disabled={!isOnline || isSaving}
                        className="flex h-8 items-center gap-1.5 rounded-[7px] bg-[#c6f36b] px-3 text-[10px] font-semibold text-[#23432f] transition hover:bg-[#b5e659]"
                      >
                        Set opening balance
                        <ArrowRight size={13} />
                      </button>
                    )}
                  </div>
                  {(isOpen || (isUnlocked && todaySession)) && (
                    <div className="mt-4 grid w-full grid-cols-1 gap-2">
                      <button
                        onClick={startOpeningFlow}
                        disabled={!isOnline || isSaving}
                        className="flex min-h-11 w-full items-center justify-center rounded-[8px] border border-[#d5e1d0] bg-[#f1f7eb] px-2 text-xs font-medium text-[#34583a] shadow-sm transition hover:bg-[#e8f2df] active:translate-y-px"
                      >
                        Edit Opening Balance
                      </button>
                    </div>
                  )}
                </div>
              </section>

              <section className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
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
                    className="rounded-[10px] border border-[#e5e9e4] bg-white p-4 md:p-5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-medium text-[#758178]">
                        {metric.label}
                      </span>
                      <span
                        className={`grid size-7 place-items-center rounded-[7px] ${metric.tone}`}
                      >
                        <metric.icon size={14} />
                      </span>
                    </div>
                    <p className="number-font mb-0 mt-3 text-[19px] font-semibold tracking-[-0.6px] text-[#1c2b23] md:text-[22px]">
                      {formatMMK(metric.amount)}{" "}
                      <span className="text-[9px] font-medium tracking-normal text-[#98a199]">
                        MMK
                      </span>
                    </p>
                    <p className="mb-0 mt-1 text-[9px] text-[#98a199]">
                      {metric.hint}
                    </p>
                  </div>
                ))}
              </section>
              <section className="mb-7">
                <div className="mb-3 flex items-end justify-between">
                  <div>
                    <h3 className="m-0 text-[13px] font-semibold">
                      Quick balances
                    </h3>
                    <p className="mb-0 mt-1 text-[10px] text-[#8b968d]">
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
                      className="min-w-0 rounded-[9px] border border-[#e5e9e4] bg-white px-3 py-3"
                    >
                      <AccountBadge account={account} compact />
                      <p className="number-font mb-0 mt-2.5 truncate text-[14px] font-semibold text-[#213128]">
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
                  <p className="mb-0 mt-1 text-[10px] text-[#8b968d]">
                    {todaySession
                      ? `${todayActiveAccounts.length} active in today’s session`
                      : "Every new session starts from manually entered balances"}
                  </p>
                </div>
                <button
                  onClick={() => setModal("accounts")}
                  className="flex h-9 items-center gap-1.5 rounded-[7px] bg-[#173c31] px-3 text-[10px] font-semibold text-white transition hover:bg-[#245745]"
                >
                  <Plus size={13} />
                  Manage Acc
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">
                {accounts.map((account) => (
                  <div
                    key={account.id}
                    className={`min-w-0 rounded-[9px] border bg-white px-3 py-3 ${todaySession && !todaySession.activeAccountIds.includes(account.id) ? "border-dashed border-[#e5e9e4] opacity-55" : "border-[#e5e9e4]"}`}
                  >
                    <div className="mb-3 flex items-center gap-2">
                      <span
                        className={`grid size-6 shrink-0 place-items-center rounded-[7px] text-[9px] font-bold ${accountColorBadge(account.color)}`}
                      >
                        {account.mark}
                      </span>
                      <span className="truncate text-[9px] font-medium text-[#69766e]">
                        {account.shortName}
                      </span>
                    </div>
                    <p className="number-font m-0 truncate text-[13px] font-semibold tracking-[-0.3px] text-[#213128]">
                      {todaySession?.activeAccountIds.includes(account.id)
                        ? formatMMK(balances[account.id] ?? 0)
                        : "—"}
                    </p>
                    <p className="mb-0 mt-0.5 text-[8px] text-[#a0aaa2]">
                      {account.accountNumber || account.kind.toUpperCase()} ·{" "}
                      {todaySession?.activeAccountIds.includes(account.id)
                        ? "Active today"
                        : "Inactive today"}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeTab === "transactions" && (
            <section id="transactions" className="mb-7 scroll-mt-24">
              <div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
                <div>
                  <h3 className="m-0 text-[13px] font-semibold">
                    Quick transaction
                  </h3>
                  <p className="mb-0 mt-1 text-[10px] text-[#8b968d]">
                    Capture a counter movement in a few seconds
                  </p>
                </div>
                {!isOpen && (
                  <span className="flex items-center gap-1.5 self-start text-[10px] text-[#ac7954]">
                    <CircleAlert size={13} />
                    Open a session to enter transactions
                  </span>
                )}
              </div>
              <form
                id="transaction-entry"
                onSubmit={addTransaction}
                className="rounded-[10px] border border-[#e4e8e3] bg-white p-4 md:p-5"
              >
                <div
                  className="mb-4 flex gap-1.5 overflow-x-auto border-b border-[#edf0ec] pb-3 scrollbar-hidden"
                  role="tablist"
                  aria-label="Transaction type"
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
                        role="tab"
                        aria-selected={transactionKind === kind}
                        key={kind}
                        onClick={() => {
                          setTransactionKind(kind);
                          if (kind === "TRANSFER" || kind === "EXPENSE") {
                            setCommissionInput("");
                          }
                          if (kind === "EXPENSE") {
                            setCustomerInput("");
                            setPhoneInput("");
                          }
                        }}
                        className={`flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] px-3 text-[10px] font-medium transition ${transactionKind === kind ? kindColors[kind] : "bg-[#f5f7f4] text-[#758178] hover:bg-[#edf1ec]"}`}
                      >
                        <Icon size={13} />
                        {kindLabel(kind)}
                      </button>
                    );
                  })}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {(transactionKind === "CASH_IN" ||
                    transactionKind === "CASH_OUT") && (
                    <label className="field-label">
                      {transactionKind === "CASH_IN"
                        ? "Received via"
                        : "Paid to"}
                      <AccountBadge
                        account={
                          transactionAccounts.find(
                            (account) => account.id === serviceAccountId,
                          ) ??
                          transactionAccounts[0] ??
                          ledger.accounts[0]
                        }
                        compact
                      />
                      <span className="select-wrap">
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
                        <AccountBadge
                          account={
                            transactionAccounts.find(
                              (account) => account.id === fromAccountId,
                            ) ??
                            transactionAccounts[0] ??
                            ledger.accounts[0]
                          }
                          compact
                        />
                        <span className="select-wrap">
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
                        <AccountBadge
                          account={
                            transactionAccounts.find(
                              (account) => account.id === toAccountId,
                            ) ??
                            transactionAccounts[0] ??
                            ledger.accounts[0]
                          }
                          compact
                        />
                        <span className="select-wrap">
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
                      Expense paid from
                      <span className="select-wrap">
                        <select
                          value={expenseAccountId}
                          onChange={(event) =>
                            setExpenseAccountId(event.target.value as AccountId)
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
                  )}
                  <label className="field-label">
                    Amount · MMK
                    <span className="input-wrap">
                      <input
                        required
                        inputMode="decimal"
                        type="text"
                        placeholder="0"
                        value={amountInput}
                        onChange={(event) =>
                          updateCurrencyInput(event.currentTarget, setAmountInput)
                        }
                      />
                    </span>
                  </label>
                  {transactionKind !== "TRANSFER" &&
                    transactionKind !== "EXPENSE" && (
                      <label className="field-label">
                        Commission · MMK
                        <span className="input-wrap">
                          <input
                            inputMode="decimal"
                            type="text"
                            placeholder="0"
                            value={commissionInput}
                            onChange={(event) =>
                              updateCurrencyInput(
                                event.currentTarget,
                                setCommissionInput,
                              )
                            }
                          />
                        </span>
                      </label>
                    )}
                  {transactionKind !== "TRANSFER" &&
                    transactionKind !== "EXPENSE" &&
                    parseCurrencyInput(commissionInput) > 0 && (
                    <label className="field-label">
                      Commission Received In
                      <span className="select-wrap">
                        <select
                          value={commissionDestinationId}
                          onChange={(event) =>
                            setCommissionDestinationId(event.target.value)
                          }
                        >
                          <option value="cash-drawer">Cash Drawer</option>
                          <option value="related">Selected Wallet</option>
                          {transactionAccounts
                            .filter(
                              (account, index, accountList) =>
                                account.id !== "cash-drawer" &&
                                account.name.trim().toLowerCase() !==
                                  "cash drawer" &&
                                accountList.findIndex(
                                  (candidate) => candidate.id === account.id,
                                ) === index,
                            )
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
                  <div ref={customerFieldsRef} className="contents">
                    {transactionKind !== "EXPENSE" && (
                      <div className="relative min-w-0">
                        <label className="field-label">
                          {transactionKind === "TRANSFER"
                            ? "Transfer person"
                            : "Customer name"}{" "}
                          <span className="optional-label">Optional</span>
                          <span className="input-wrap">
                            <input
                              role="combobox"
                              autoComplete="name"
                              placeholder="Name at counter"
                              value={customerInput}
                              aria-autocomplete="list"
                              aria-controls="customer-name-suggestions"
                              aria-haspopup="listbox"
                              aria-expanded={
                                activeCustomerField === "name" &&
                                customerNameSuggestions.length > 0
                              }
                              onFocus={() => setActiveCustomerField("name")}
                              onChange={(event) => {
                                setActiveCustomerField("name");
                                updateCustomerNameInput(
                                  event.currentTarget,
                                  setCustomerInput,
                                );
                              }}
                            />
                          </span>
                        </label>
                        {activeCustomerField === "name" &&
                          customerNameSuggestions.length > 0 && (
                            <div
                              id="customer-name-suggestions"
                              role="listbox"
                              className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-[8px] border border-[#e1e6e0] bg-white p-1 shadow-[0_10px_28px_rgba(20,36,28,0.14)]"
                            >
                              {customerNameSuggestions.map((customer) => (
                                <button
                                  key={customer.id}
                                  type="button"
                                  role="option"
                                  aria-selected="false"
                                  onClick={() => selectCustomer(customer)}
                                  className="flex w-full items-center justify-between gap-3 rounded-[6px] px-2.5 py-2 text-left text-[10px] text-[#34443b] transition hover:bg-[#f2f6ef]"
                                >
                                  <span className="min-w-0 truncate font-medium">
                                    {customer.name || "No name saved"} —{" "}
                                    {customer.phone || "No phone saved"}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                      </div>
                    )}
                    {transactionKind !== "TRANSFER" &&
                      transactionKind !== "EXPENSE" && (
                        <div className="relative min-w-0">
                          <label className="field-label">
                            Phone number{" "}
                            <span className="optional-label">Optional</span>
                            <span className="input-wrap">
                              <input
                                role="combobox"
                                autoComplete="tel"
                                inputMode="tel"
                                placeholder="09 xxx xxx xxx"
                                value={phoneInput}
                                maxLength={14}
                                aria-autocomplete="list"
                                aria-controls="customer-phone-suggestions"
                                aria-haspopup="listbox"
                                aria-expanded={
                                  activeCustomerField === "phone" &&
                                  customerPhoneSuggestions.length > 0
                                }
                                onFocus={() => setActiveCustomerField("phone")}
                                onChange={(event) => {
                                  setActiveCustomerField("phone");
                                  updatePhoneInput(
                                    event.currentTarget,
                                    setPhoneInput,
                                  );
                                }}
                              />
                            </span>
                          </label>
                          {activeCustomerField === "phone" &&
                            customerPhoneSuggestions.length > 0 && (
                              <div
                                id="customer-phone-suggestions"
                                role="listbox"
                                className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-[8px] border border-[#e1e6e0] bg-white p-1 shadow-[0_10px_28px_rgba(20,36,28,0.14)]"
                              >
                                {customerPhoneSuggestions.map((customer) => (
                                  <button
                                    key={customer.id}
                                    type="button"
                                    role="option"
                                    aria-selected="false"
                                    onClick={() => selectCustomer(customer)}
                                    className="flex w-full items-center justify-between gap-3 rounded-[6px] px-2.5 py-2 text-left text-[10px] text-[#34443b] transition hover:bg-[#f2f6ef]"
                                  >
                                    <span className="min-w-0 truncate font-medium">
                                      {customer.name || "No name saved"} —{" "}
                                      {customer.phone || "No phone saved"}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                        </div>
                      )}
                  </div>
                  <label className="field-label sm:col-span-2">
                    Note <span className="optional-label">Optional</span>
                    <span className="input-wrap">
                      <input
                        placeholder="Reference or short note"
                        value={noteInput}
                        onChange={(event) => setNoteInput(event.target.value)}
                      />
                    </span>
                  </label>
                </div>
                {transferAccountError && (
                  <p role="alert" className="mb-0 mt-3 text-[10px] text-[#bd3c4a]">
                    From and To accounts must be different for a transfer.
                  </p>
                )}
                <div className="mt-4 flex flex-col-reverse justify-between gap-3 border-t border-[#edf0ec] pt-3.5 sm:flex-row sm:items-center">
                  <span className="text-[9px] text-[#99a39b]">
                    Transactions are stored in your secure cloud ledger.
                  </span>
                  <button
                    disabled={!isOpen || transferAccountError || !isOnline || isSaving}
                    type="submit"
                    className="flex h-9 items-center justify-center gap-2 rounded-[7px] bg-[#c6f36b] px-4 text-[10px] font-semibold text-[#244330] transition hover:bg-[#b5e659] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {editingTransactionId ? (
                      <Check size={14} />
                    ) : (
                      <Plus size={14} />
                    )}
                    {editingTransactionId ? "Save changes" : "Add transaction"}
                  </button>
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
                      Cancel edit
                    </button>
                  )}
                </div>
              </form>
              <div className="mt-4 overflow-hidden rounded-[10px] border border-[#e4e8e3] bg-white">
                <div className="flex flex-col gap-3 border-b border-[#edf0ec] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="m-0 text-[12px] font-semibold">
                      Session transactions
                    </h3>
                    <p className="mb-0 mt-1 text-[9px] text-[#89948c]">
                      {sessionTransactions.length} of {todayTransactions.length} records ·{" "}
                      {formatDate(activeDate, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex h-8 min-w-[145px] flex-1 items-center gap-1.5 rounded-[7px] border border-[#e1e6e0] bg-white px-2 sm:flex-none">
                      <Search size={13} className="shrink-0 text-[#89948c]" />
                      <input
                        aria-label="Search session transactions"
                        placeholder="Name, date, time, wallet"
                        value={sessionSearch}
                        onChange={(event) => setSessionSearch(event.target.value)}
                        className="w-full min-w-0 bg-transparent text-[9px] text-[#46544b] outline-none"
                      />
                    </label>
                    <select
                      aria-label="Filter transactions by type"
                      value={sessionKindFilter}
                      onChange={(event) =>
                        setSessionKindFilter(
                          event.target.value as TransactionKind | "ALL",
                        )
                      }
                      className="h-8 rounded-[7px] border border-[#e1e6e0] bg-white px-2 text-[9px] text-[#46544b]"
                    >
                      <option value="ALL">All types</option>
                      {(
                        ["CASH_IN", "CASH_OUT", "TRANSFER", "EXPENSE"] as
                          TransactionKind[]
                      ).map((kind) => (
                        <option key={kind} value={kind}>
                          {kindLabel(kind)}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Filter transactions by wallet"
                      value={sessionWalletFilter}
                      onChange={(event) =>
                        setSessionWalletFilter(event.target.value)
                      }
                      className="h-8 max-w-full rounded-[7px] border border-[#e1e6e0] bg-white px-2 text-[9px] text-[#46544b]"
                    >
                      <option value="ALL">All wallets</option>
                      {transactionAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {sessionTransactions.length ? (
                  <div className="divide-y divide-[#edf0ec]">
                    {sessionTransactions.map((transaction, index) => (
                      <div
                        key={transaction.id}
                        className="flex items-center gap-3 px-3.5 py-3"
                      >
                        <span
                          aria-label={`Transaction number ${index + 1}`}
                          className="w-5 shrink-0 text-center text-[9px] font-medium text-[#89948c]"
                        >
                          {index + 1}
                        </span>
                        <span
                          className={`grid size-8 shrink-0 place-items-center rounded-[8px] ${kindColors[transaction.kind]}`}
                        >
                          <span className="text-[11px] font-semibold">
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
                            {transaction.customer || "Walk-in"}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] text-[#89948c]">
                            <span
                              className={`rounded-[5px] px-1.5 py-0.5 font-medium ${kindColors[transaction.kind]}`}
                            >
                              {kindLabel(transaction.kind)}
                            </span>
                            <span>{transaction.time}</span>
                            <TransactionChannels
                              accountList={ledger.accounts}
                              transaction={transaction}
                              showFlowSigns
                            />
                          </div>
                          <p className="mb-0 mt-1 text-[8px] text-[#9ba59d]">
                            Recorded:{" "}
                            {formatTransactionTimestamp(transaction.created_at)}
                          </p>
                          {transaction.updated_at &&
                            transaction.updated_at !== transaction.created_at && (
                              <span
                                className="mt-0.5 inline-block rounded bg-[#f3f5f2] px-1.5 py-0.5 text-[8px] text-[#748078]"
                                title={`Last modified ${formatTransactionTimestamp(transaction.updated_at)}`}
                              >
                                Edited:{" "}
                                {formatTransactionTimestamp(transaction.updated_at)}
                              </span>
                            )}
                        </div>
                        <div className="text-right">
                          <p className="number-font m-0 text-[10px] font-semibold">
                            {formatMMK(transaction.amount)}
                          </p>
                          {transaction.commission > 0 && (
                            <>
                              <p className="number-font mb-0 mt-1 text-[8px] text-[#71816f]">
                                Fee {formatMMK(transaction.commission)}
                              </p>
                              <p className="mb-0 mt-0.5 whitespace-nowrap text-[8px] text-[#89948c]">
                                In {accountName(
                                  ledger.accounts,
                                  commissionAccountId(transaction),
                                )}
                              </p>
                            </>
                          )}
                        </div>
                        {isOpen && (
                          <div className="flex gap-1">
                            <button
                              onClick={() => editTransaction(transaction)}
                              aria-label={`Edit ${kindLabel(transaction.kind)} transaction`}
                              className="grid size-7 place-items-center rounded-[6px] text-[#73877a] hover:bg-[#edf4e8]"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => removeTransaction(transaction.id)}
                              disabled={!isOnline || isSaving}
                              aria-label={`Delete ${kindLabel(transaction.kind)} transaction`}
                              className="grid size-7 place-items-center rounded-[6px] text-[#a36e5a] hover:bg-[#fff0e9]"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : todayTransactions.length ? (
                  <div className="px-4 py-9 text-center">
                    <Search size={18} className="mx-auto text-[#a0aaa3]" />
                    <p className="mb-0 mt-2 text-[10px] font-medium text-[#68756c]">
                      No matching transactions
                    </p>
                    <p className="mb-0 mt-1 text-[9px] text-[#9aa49c]">
                      Adjust the search or filters to see more entries.
                    </p>
                  </div>
                ) : (
                  <div className="px-4 py-9 text-center">
                    <ReceiptText size={18} className="mx-auto text-[#a0aaa3]" />
                    <p className="mb-0 mt-2 text-[10px] font-medium text-[#68756c]">
                      No transactions in this session
                    </p>
                    <p className="mb-0 mt-1 text-[9px] text-[#9aa49c]">
                      New entries will appear here.
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === "reconciliation" && (
            <section className="mb-7 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div
                id="reconciliation"
                className="scroll-mt-24 rounded-[10px] border border-[#e4e8e3] bg-white p-4 md:p-5"
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="m-0 text-[13px] font-semibold">
                      Evening reconciliation
                    </h3>
                    <p className="mb-0 mt-1 text-[10px] text-[#8b968d]">
                      {formatDate(activeDate, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}{" "}
                      · active accounts
                    </p>
                  </div>
                  <span className="grid size-8 place-items-center rounded-[7px] bg-[#eef5e7] text-[#6a913f]">
                    <CircleCheck size={16} />
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
                      className="flex items-center justify-between border-b border-[#edf0ec] px-3.5 py-2.5 last:border-0"
                    >
                      <span className="text-[10px] text-[#758178]">
                        {label}
                      </span>
                      <span className="number-font text-[10px] font-medium text-[#3a4940]">
                        {sign === "#" ? "" : sign}
                        {formatMMK(Number(amount))}{" "}
                        <span className="text-[8px] text-[#a0aaa2]">MMK</span>
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between bg-[#f4f7f1] px-3.5 py-3">
                    <span className="text-[10px] font-semibold text-[#304439]">
                      System closing
                    </span>
                    <span className="number-font text-[13px] font-semibold text-[#21392b]">
                      {formatMMK(systemClosing)}{" "}
                      <span className="text-[8px] font-medium">MMK</span>
                    </span>
                  </div>
                </div>
                {todaySession?.closingBalance != null && (
                  <div
                    className={`mt-3 flex items-center justify-between rounded-[7px] px-3 py-2.5 ${closingDifference === 0 ? "bg-[#eaf5df] text-[#4f7937]" : "bg-[#fff0e9] text-[#b05a3b]"}`}
                  >
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold">
                      {closingDifference === 0 ? (
                        <CircleCheck size={13} />
                      ) : (
                        <CircleAlert size={13} />
                      )}
                      {closingDifference === 0 ? "Balanced" : "Discrepancy"}
                      <span className="font-normal opacity-70">
                        · actual {formatMMK(todaySession.closingBalance)} MMK
                      </span>
                    </span>
                    <span className="number-font text-[11px] font-semibold">
                      {closingDifference === 0
                        ? "0"
                        : `${closingDifference! > 0 ? "+" : "−"}${formatMMK(Math.abs(closingDifference!))}`}{" "}
                      MMK
                    </span>
                  </div>
                )}
                {isOpen && (
                  <button
                    onClick={startClosingFlow}
                    disabled={!isOnline || isSaving}
                    className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-[7px] border border-[#dce5d9] text-[10px] font-semibold text-[#3e6248] transition hover:bg-[#f4f8ef]"
                  >
                    <Check size={14} />
                    Enter actual cash & close
                  </button>
                )}
                {!todaySession && (
                  <button
                    onClick={startOpeningFlow}
                    className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-[7px] border border-[#dce5d9] text-[10px] font-semibold text-[#3e6248] transition hover:bg-[#f4f8ef]"
                  >
                    <Plus size={14} />
                    Open session to begin
                  </button>
                )}
              </div>
              <div className="rounded-[10px] border border-[#e4e8e3] bg-white p-4 md:p-5">
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <h3 className="m-0 text-[13px] font-semibold">
                      Session activity
                    </h3>
                    <p className="mb-0 mt-1 text-[10px] text-[#8b968d]">
                      Account movement in the session
                    </p>
                  </div>
                  <span className="text-[9px] text-[#929d94]">
                    {todayTransactions.length} records
                  </span>
                </div>
                <div className="space-y-3.5">
                  {[
                    {
                      label: "Cash received",
                      value: cashInTotal,
                      icon: ArrowDownLeft,
                      color: "text-[#608c3f]",
                      percent: systemClosing
                        ? Math.min(
                            (cashInTotal / Math.abs(systemClosing || 1)) * 100,
                            100,
                          )
                        : 0,
                    },
                    {
                      label: "Cash paid out",
                      value: cashOutTotal + expenseTotal,
                      icon: ArrowUpRight,
                      color: "text-[#bc7452]",
                      percent: systemClosing
                        ? Math.min(
                            ((cashOutTotal + expenseTotal) /
                              Math.abs(systemClosing || 1)) *
                              100,
                            100,
                          )
                        : 0,
                    },
                    {
                      label: "Fees earned",
                      value: commissions,
                      icon: TrendingUp,
                      color: "text-[#5282a0]",
                      percent: systemClosing
                        ? Math.min(
                            (commissions / Math.abs(systemClosing || 1)) * 100,
                            100,
                          )
                        : 0,
                    },
                  ].map((item) => (
                    <div key={item.label}>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-[10px] text-[#6f7b73]">
                          <item.icon size={13} className={item.color} />
                          {item.label}
                        </span>
                        <span className="number-font text-[10px] font-semibold">
                          {formatMMK(item.value)}{" "}
                          <span className="text-[8px] font-normal text-[#9ba59d]">
                            MMK
                          </span>
                        </span>
                      </div>
                      <div className="h-[5px] overflow-hidden rounded-full bg-[#f0f2ef]">
                        <div
                          className={`h-full rounded-full ${item.label === "Cash received" ? "bg-[#a9d47a]" : item.label === "Cash paid out" ? "bg-[#efb088]" : "bg-[#9bc9eb]"}`}
                          style={{ width: `${item.percent}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-5 flex items-center justify-between border-t border-[#edf0ec] pt-3">
                  <span className="flex items-center gap-1.5 text-[9px] text-[#89948c]">
                    <Activity size={12} />
                    Net drawer change
                  </span>
                  <span className="number-font text-[11px] font-semibold">
                    {systemClosing - openingBalance >= 0 ? "+" : "−"}
                    {formatMMK(Math.abs(systemClosing - openingBalance))}{" "}
                    <span className="text-[8px] font-normal text-[#9ba59d]">
                      MMK
                    </span>
                  </span>
                </div>
              </div>
            </section>
          )}

          {activeTab === "customers" && (
            <section id="customers" className="scroll-mt-24">
              <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div>
                  <p className="mb-1 text-[9px] font-semibold uppercase tracking-[1.4px] text-[#829087]">
                    Contacts
                  </p>
                  <h2 className="m-0 text-lg font-semibold text-[#17251f]">
                    Customer Record Book
                  </h2>
                  <p className="mb-0 mt-1 text-[10px] text-[#89948c]">
                    Manage saved name and phone combinations. Favorites stay
                    pinned at the top.
                  </p>
                </div>
                <div className="flex w-full gap-2 sm:w-auto">
                  <label className="input-wrap h-9 flex-1 sm:w-[260px]">
                    <Search className="ml-2.5 shrink-0 text-[#96a198]" size={14} />
                    <input
                      aria-label="Search customers"
                      type="search"
                      value={customerSearch}
                      onChange={(event) => setCustomerSearch(event.target.value)}
                      placeholder="Search name or phone"
                    />
                  </label>
                  <button
                    type="button"
                    aria-pressed={favoritesOnly}
                    onClick={() => setFavoritesOnly((value) => !value)}
                    className={`flex h-9 shrink-0 items-center gap-1.5 rounded-[7px] border px-3 text-[10px] font-semibold transition ${
                      favoritesOnly
                        ? "border-[#e9d99c] bg-[#fff8df] text-[#94722a]"
                        : "border-[#e1e6e0] bg-white text-[#758178] hover:bg-[#f7f9f5]"
                    }`}
                  >
                    <Star size={13} fill={favoritesOnly ? "currentColor" : "none"} />
                    Favorites
                  </button>
                </div>
              </div>
              <div className="overflow-hidden rounded-[10px] border border-[#e4e8e3] bg-white">
                <div className="table-scroll">
                  <table className="w-full min-w-[760px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-[#edf0ec] bg-[#fafbf9] text-[8px] font-semibold uppercase tracking-[.7px] text-[#929d95]">
                        <th className="px-3 py-3">Name</th>
                        <th className="px-3 py-3">Phone number</th>
                        <th className="px-3 py-3 text-center">Favorite</th>
                        <th className="px-3 py-3 text-right">Transactions</th>
                        <th className="px-3 py-3">Last active date</th>
                        <th className="px-3 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerDirectoryRows.map((customer) => {
                        const editing = editingCustomerId === customer.id;
                        return (
                          <tr
                            key={customer.id}
                            className="border-b border-[#f0f2ef] last:border-0 hover:bg-[#fbfcfa]"
                          >
                            <td className="px-3 py-2.5">
                              {editing ? (
                                <input
                                  aria-label="Edit customer name"
                                  value={customerEditName}
                                  onChange={(event) =>
                                    setCustomerEditName(
                                      formatCustomerName(event.target.value),
                                    )
                                  }
                                  className="h-8 w-full rounded-md border border-[#dfe5de] px-2 text-[10px] outline-none focus:border-[#96b872]"
                                />
                              ) : (
                                <span className="text-[10px] font-medium text-[#37463d]">
                                  {customer.name || "Unnamed customer"}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              {editing ? (
                                <input
                                  aria-label="Edit customer phone number"
                                  inputMode="tel"
                                  value={customerEditPhone}
                                  onChange={(event) =>
                                    setCustomerEditPhone(
                                      formatMyanmarPhone(event.target.value),
                                    )
                                  }
                                  className="h-8 w-full rounded-md border border-[#dfe5de] px-2 text-[10px] outline-none focus:border-[#96b872]"
                                />
                              ) : (
                                <span className="text-[10px] text-[#69766e]">
                                  {customer.phone || "—"}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <button
                                type="button"
                                aria-label={
                                  customer.is_favorite
                                    ? `Remove ${customer.name} from favorites`
                                    : `Add ${customer.name} to favorites`
                                }
                                aria-pressed={customer.is_favorite}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void toggleCustomerFavorite(customer.id);
                                }}
                                disabled={!isOnline || isSaving}
                                className={`grid size-7 place-items-center rounded-md transition ${
                                  customer.is_favorite
                                    ? "text-yellow-400 hover:bg-[#fff8df]"
                                    : "text-neutral-300 hover:bg-[#f5f7f3] hover:text-yellow-400"
                                }`}
                              >
                                <Star
                                  size={14}
                                  fill={
                                    customer.is_favorite
                                      ? "currentColor"
                                      : "none"
                                  }
                                />
                              </button>
                            </td>
                            <td className="number-font px-3 py-2.5 text-right text-[10px] text-[#58665d]">
                              {customer.stats.count}
                            </td>
                            <td className="px-3 py-2.5 text-[9px] text-[#7b8780]">
                              {customer.stats.lastActive ??
                                customer.lastUsed.slice(0, 10) ??
                                "—"}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex justify-end gap-1">
                                {editing ? (
                                  <>
                                    <button
                                      type="button"
                                      disabled={!isOnline || isSaving}
                                      onClick={() =>
                                        saveCustomerEdit(customer.id)
                                      }
                                      aria-label="Save customer changes"
                                      title="Save changes"
                                      className="grid size-7 place-items-center rounded-md text-[#4d783f] hover:bg-[#eff7e6]"
                                    >
                                      <Check size={14} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={cancelCustomerEdit}
                                      aria-label="Cancel customer edit"
                                      title="Cancel"
                                      className="grid size-7 place-items-center rounded-md text-[#839087] hover:bg-[#f2f4f1]"
                                    >
                                      <X size={14} />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => beginCustomerEdit(customer)}
                                      aria-label={`Edit ${customer.name}`}
                                      title="Edit customer"
                                      className="grid size-7 place-items-center rounded-md text-[#73877a] hover:bg-[#edf4e8]"
                                    >
                                      <Pencil size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={!isOnline || isSaving}
                                      onClick={() => deleteCustomer(customer)}
                                      aria-label={`Delete ${customer.name}`}
                                      title="Delete customer"
                                      className="grid size-7 place-items-center rounded-md text-[#a1aba3] hover:bg-[#fff0e9] hover:text-[#b75c3d]"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {customerDirectoryRows.length === 0 && (
                  <div className="flex min-h-[140px] flex-col items-center justify-center px-4 text-center">
                    <Users size={20} className="text-[#a1ada3]" />
                    <p className="mb-0 mt-2 text-[10px] font-medium text-[#68756c]">
                      {customerDirectory.length
                        ? "No customers match this search."
                        : "No saved customers yet."}
                    </p>
                    <p className="mb-0 mt-1 text-[9px] text-[#9aa49c]">
                      Customer pairs are saved when you record a transaction.
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === "reports" && (
            <section id="reports" className="scroll-mt-24">
              <div className="mb-5 overflow-hidden rounded-[10px] border border-[#e4e8e3] bg-white">
                <div className="flex flex-col justify-between gap-3 border-b border-[#edf0ec] px-4 py-3 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="m-0 flex items-center gap-2 text-[13px] font-semibold">
                      <Users size={15} className="text-[#668d4e]" />
                      Customer Ranking &amp; Analytics
                    </h3>
                    <p className="mb-0 mt-1 text-[9px] text-[#89948c]">
                      Customer activity and volume for the selected period
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      [
                        ["today", "Today"],
                        ["month", "This Month"],
                        ["all", "All Time"],
                        ["custom", "Custom Range"],
                      ] as [CustomerReportRange, string][]
                    ).map(([range, label]) => (
                      <button
                        key={range}
                        type="button"
                        aria-pressed={customerReportRange === range}
                        onClick={() => setCustomerReportRange(range)}
                        className={`h-7 rounded-md px-2.5 text-[9px] font-semibold transition ${
                          customerReportRange === range
                            ? "bg-[#173c31] text-white"
                            : "bg-[#f4f6f2] text-[#6d7a71] hover:bg-[#eaf0e5]"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={exportCustomerRankings}
                      title="Export customer analytics CSV"
                      className="grid size-7 place-items-center rounded-md text-[#568447] transition hover:bg-[#eef5e7]"
                    >
                      <FileSpreadsheet size={15} />
                    </button>
                  </div>
                </div>
                {customerReportRange === "custom" && (
                  <div className="flex flex-wrap gap-2 border-b border-[#edf0ec] bg-[#fafbf9] px-4 py-2.5">
                    <label className="flex h-8 items-center gap-1.5 rounded-[7px] border border-[#e1e6e0] bg-white px-2">
                      <span className="text-[9px] text-[#87928a]">From</span>
                      <input
                        aria-label="Customer analytics start date"
                        type="date"
                        value={customerReportFrom}
                        onChange={(event) =>
                          setCustomerReportFrom(event.target.value)
                        }
                        className="w-[112px] bg-transparent text-[9px] text-[#46544b] outline-none"
                      />
                    </label>
                    <label className="flex h-8 items-center gap-1.5 rounded-[7px] border border-[#e1e6e0] bg-white px-2">
                      <span className="text-[9px] text-[#87928a]">To</span>
                      <input
                        aria-label="Customer analytics end date"
                        type="date"
                        value={customerReportTo}
                        onChange={(event) =>
                          setCustomerReportTo(event.target.value)
                        }
                        className="w-[112px] bg-transparent text-[9px] text-[#46544b] outline-none"
                      />
                    </label>
                  </div>
                )}
                <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-4">
                  {(
                    [
                      [
                        "Most Frequent Customers",
                        customerRankings.frequent,
                        "count",
                        "Transactions",
                      ],
                      [
                        "Top Cash-In Customers",
                        customerRankings.cashIn,
                        "cashIn",
                        "MMK",
                      ],
                      [
                        "Top Cash-Out Customers",
                        customerRankings.cashOut,
                        "cashOut",
                        "MMK",
                      ],
                      [
                        "Top Commission Generators",
                        customerRankings.commission,
                        "commission",
                        "MMK",
                      ],
                    ] as const
                  ).map(([title, customers, metric, unit]) => (
                    <div
                      key={title}
                      className="min-w-0 rounded-lg border border-[#edf0ec] bg-[#fcfdfb] p-3"
                    >
                      <h4 className="m-0 text-[10px] font-semibold text-[#445249]">
                        {title}
                      </h4>
                      <div className="mt-2 max-h-52 space-y-1 overflow-y-auto">
                        {customers.map((customer, index) => (
                          <div
                            key={`${customerPairKey(customer.name, customer.phone)}-${index}`}
                            className="flex items-start justify-between gap-2 border-t border-[#f0f2ef] py-1.5 first:border-0"
                          >
                            <div className="flex min-w-0 items-start gap-1.5">
                              <span className="number-font mt-px text-[8px] text-[#96a198]">
                                {index + 1}.
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-[9px] font-medium text-[#45534a]">
                                  {customer.name}
                                </span>
                                <span className="block text-[8px] text-[#929d95]">
                                  {customer.phone || "No phone"}
                                </span>
                              </span>
                            </div>
                            <span className="number-font shrink-0 text-right text-[9px] font-semibold text-[#58665d]">
                              {metric === "count"
                                ? customer.count
                                : formatMMK(customer[metric])}
                              <span className="ml-1 text-[7px] font-normal text-[#98a39b]">
                                {unit}
                              </span>
                            </span>
                          </div>
                        ))}
                        {customers.length === 0 && (
                          <p className="m-0 py-5 text-center text-[9px] text-[#929d95]">
                            No customer activity for this period.
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="m-0 border-t border-[#edf0ec] px-4 py-2 text-[8px] text-[#929d95]">
                  Based on {customerAnalyticsTransactions.length} transactions
                  in the selected date range.
                </p>
              </div>
              <div className="mb-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div>
                  <h3 className="m-0 text-[13px] font-semibold">
                    Transaction register
                  </h3>
                  <p className="mb-0 mt-1 text-[10px] text-[#8b968d]">
                    Search the ledger by date and export a statement
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex h-8 items-center gap-1.5 rounded-[7px] border border-[#e1e6e0] bg-white px-2">
                    <span className="text-[9px] text-[#87928a]">From</span>
                    <input
                      aria-label="Start date"
                      type="date"
                      value={dateFrom}
                      onChange={(event) => setDateFrom(event.target.value)}
                      className="w-[112px] bg-transparent text-[9px] text-[#46544b] outline-none"
                    />
                  </label>
                  <label className="flex h-8 items-center gap-1.5 rounded-[7px] border border-[#e1e6e0] bg-white px-2">
                    <span className="text-[9px] text-[#87928a]">To</span>
                    <input
                      aria-label="End date"
                      type="date"
                      value={dateTo}
                      onChange={(event) => setDateTo(event.target.value)}
                      className="w-[112px] bg-transparent text-[9px] text-[#46544b] outline-none"
                    />
                  </label>
                </div>
              </div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[#e5e9e4] bg-white px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[9px] text-[#78847c]">
                  <span className="flex items-center gap-1.5">
                    <Search size={12} />
                    {filteredTransactions.length} entries
                  </span>
                  <span>
                    Inflow{" "}
                    <b className="number-font text-[#4c7540]">
                      {formatMMK(rangeInflow)} MMK
                    </b>
                  </span>
                  <span>
                    Outflow{" "}
                    <b className="number-font text-[#ad6749]">
                      {formatMMK(rangeOutflow)} MMK
                    </b>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={exportExcel}
                    title="Export Excel"
                    aria-label="Export Excel"
                    className="grid size-7 place-items-center rounded-[6px] text-[#568447] transition hover:bg-[#eef5e7]"
                  >
                    <FileSpreadsheet size={15} />
                  </button>
                  <button
                    onClick={exportPdf}
                    title="Export PDF summary"
                    aria-label="Export PDF summary"
                    className="grid size-7 place-items-center rounded-[6px] text-[#62809a] transition hover:bg-[#edf4f8]"
                  >
                    <FileText size={15} />
                  </button>
                  <button
                    onClick={printThermalSlip}
                    title="Print 80 mm slip"
                    aria-label="Print 80 mm slip"
                    className="grid size-7 place-items-center rounded-[6px] text-[#a36e48] transition hover:bg-[#fbf0e7]"
                  >
                    <Printer size={15} />
                  </button>
                </div>
              </div>
              <div className="mb-4 rounded-[10px] border border-[#e4e8e3] bg-white">
                <div className="border-b border-[#edf0ec] px-4 py-3">
                  <h4 className="m-0 text-[11px] font-semibold">
                    Daily session breakdown
                  </h4>
                  <p className="mb-0 mt-1 text-[9px] text-[#89948c]">
                    Active accounts and per-wallet reconciliation for each day
                    in range
                  </p>
                </div>
                <div className="table-scroll">
                  <table className="w-full min-w-[900px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-[#edf0ec] bg-[#fafbf9] text-[8px] font-semibold uppercase tracking-[.7px] text-[#929d95]">
                        <th className="px-3 py-2.5">Date</th>
                        <th className="px-3 py-2.5">Active wallet</th>
                        <th className="px-3 py-2.5 text-right">Opening</th>
                        <th className="px-3 py-2.5 text-right">Inflow</th>
                        <th className="px-3 py-2.5 text-right">Outflow</th>
                        <th className="px-3 py-2.5 text-right">
                          System closing
                        </th>
                        <th className="px-3 py-2.5 text-right">
                          Ground closing
                        </th>
                        <th className="px-3 py-2.5 text-right">Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportDailyRows.map((row) => (
                        <tr
                          key={`${row.date}-${row.accountId}`}
                          className="border-b border-[#f0f2ef] last:border-0"
                        >
                          <td className="px-3 py-2.5 text-[9px] text-[#69766e]">
                            {row.date}
                          </td>
                          <td className="px-3 py-2.5 text-[9px] font-medium text-[#45534a]">
                            <AccountBadge
                              account={
                                ledger.accounts.find(
                                  (account) => account.id === row.accountId,
                                ) ?? ledger.accounts[0]
                              }
                            />
                          </td>
                          <td className="number-font px-3 py-2.5 text-right text-[9px]">
                            {formatMMK(row.opening)}
                          </td>
                          <td className="number-font px-3 py-2.5 text-right text-[9px] text-[#4c7540]">
                            {formatMMK(row.inflow)}
                          </td>
                          <td className="number-font px-3 py-2.5 text-right text-[9px] text-[#ad6749]">
                            {formatMMK(row.outflow)}
                          </td>
                          <td className="number-font px-3 py-2.5 text-right text-[9px] font-semibold">
                            {formatMMK(row.systemClosing)}
                          </td>
                          <td className="number-font px-3 py-2.5 text-right text-[9px]">
                            {row.groundClosing == null
                              ? "—"
                              : formatMMK(row.groundClosing)}
                          </td>
                          <td
                            className={`number-font px-3 py-2.5 text-right text-[9px] font-semibold ${row.difference == null ? "text-[#9ba59d]" : row.difference === 0 ? "text-[#4f7937]" : "text-[#b05a3b]"}`}
                          >
                            {row.difference == null
                              ? "—"
                              : `${row.difference > 0 ? "+" : ""}${formatMMK(row.difference)}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {reportDailyRows.length === 0 && (
                    <p className="m-0 px-4 py-6 text-center text-[10px] text-[#89948c]">
                      No sessions in this date range.
                    </p>
                  )}
                </div>
              </div>
              <div className="mb-4 rounded-[10px] border border-[#e4e8e3] bg-white">
                <div className="border-b border-[#edf0ec] px-4 py-3">
                  <h4 className="m-0 text-[11px] font-semibold">
                    Wallet-wise summary
                  </h4>
                  <p className="mb-0 mt-1 text-[9px] text-[#89948c]">
                    Net movement and earned commissions across the selected
                    dates
                  </p>
                </div>
                <div className="table-scroll">
                  <table className="w-full min-w-[640px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-[#edf0ec] bg-[#fafbf9] text-[8px] font-semibold uppercase tracking-[.7px] text-[#929d95]">
                        <th className="px-3 py-2.5">Wallet</th>
                        <th className="px-3 py-2.5 text-right">
                          Opening total
                        </th>
                        <th className="px-3 py-2.5 text-right">Inflow</th>
                        <th className="px-3 py-2.5 text-right">Outflow</th>
                        <th className="px-3 py-2.5 text-right">Net volume</th>
                        <th className="px-3 py-2.5 text-right">Commission</th>
                        <th className="px-3 py-2.5 text-right">
                          Latest system
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportWalletRows.map((row) => (
                        <tr
                          key={row.account.id}
                          className="border-b border-[#f0f2ef] last:border-0"
                        >
                          <td className="px-3 py-2.5 text-[9px] font-medium text-[#45534a]">
                            <AccountBadge account={row.account} />
                          </td>
                          <td className="number-font px-3 py-2.5 text-right text-[9px]">
                            {formatMMK(row.opening)}
                          </td>
                          <td className="number-font px-3 py-2.5 text-right text-[9px]">
                            {formatMMK(row.inflow)}
                          </td>
                          <td className="number-font px-3 py-2.5 text-right text-[9px]">
                            {formatMMK(row.outflow)}
                          </td>
                          <td className="number-font px-3 py-2.5 text-right text-[9px] font-semibold">
                            {formatMMK(row.net)}
                          </td>
                          <td className="number-font px-3 py-2.5 text-right text-[9px] text-[#4c7540]">
                            {formatMMK(row.commission)}
                          </td>
                          <td className="number-font px-3 py-2.5 text-right text-[9px]">
                            {formatMMK(row.closing)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {reportWalletRows.length === 0 && (
                    <p className="m-0 px-4 py-6 text-center text-[10px] text-[#89948c]">
                      No wallet activity in this date range.
                    </p>
                  )}
                </div>
              </div>
              <div className="table-scroll rounded-[10px] border border-[#e4e8e3] bg-white">
                <table className="w-full min-w-[900px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-[#edf0ec] bg-[#fafbf9] text-[9px] font-semibold uppercase tracking-[1px] text-[#929d95]">
                      <th className="px-4 py-3 font-semibold">Date</th>
                      <th className="px-4 py-3 font-semibold">Time</th>
                      <th className="px-4 py-3 font-semibold">Type</th>
                      <th className="px-4 py-3 font-semibold">Customer</th>
                      <th className="px-4 py-3 font-semibold">
                        Account movement
                      </th>
                      <th className="px-4 py-3 text-right font-semibold">
                        Amount
                      </th>
                      <th className="px-4 py-3 text-right font-semibold">
                        Fee
                      </th>
                      <th className="w-10 px-3 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTransactions.map((transaction) => {
                      const Icon = kindIcons[transaction.kind];
                      return (
                        <tr
                          key={transaction.id}
                          className="border-b border-[#f0f2ef] last:border-0 hover:bg-[#fbfcfa]"
                        >
                          <td className="px-4 py-3 text-[9px] text-[#77837a]">
                            {transaction.date}
                          </td>
                          <td className="px-4 py-3 text-[10px] text-[#77837a]">
                            {transaction.time}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[9px] font-medium ${kindColors[transaction.kind]}`}
                            >
                              <Icon size={11} />
                              {kindLabel(transaction.kind)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="block max-w-[145px] truncate text-[10px] font-medium text-[#37463d]">
                              {transaction.customer || "Walk-in customer"}
                            </span>
                            {transaction.phone && (
                              <span className="mt-0.5 block text-[9px] text-[#9ba59d]">
                                {transaction.phone}
                              </span>
                            )}
                            <span className="mt-0.5 block text-[8px] text-[#9ba59d]">
                              Recorded:{" "}
                              {formatTransactionTimestamp(transaction.created_at)}
                            </span>
                            {transaction.updated_at &&
                              transaction.updated_at !==
                                transaction.created_at && (
                                <span
                                  className="mt-0.5 inline-block rounded bg-[#f3f5f2] px-1.5 py-0.5 text-[8px] text-[#748078]"
                                  title={`Last modified ${formatTransactionTimestamp(transaction.updated_at)}`}
                                >
                                  Edited:{" "}
                                  {formatTransactionTimestamp(
                                    transaction.updated_at,
                                  )}
                                </span>
                              )}
                            {transaction.note && (
                              <span className="mt-0.5 block max-w-[145px] truncate text-[8px] text-[#9ba59d]">
                                {transaction.note}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-[9px] text-[#768279]">
                            <TransactionChannels
                              accountList={ledger.accounts}
                              transaction={transaction}
                            />
                          </td>
                          <td className="number-font px-4 py-3 text-right text-[10px] font-semibold text-[#35443a]">
                            {formatMMK(transaction.amount)}{" "}
                            <span className="text-[8px] font-normal text-[#a0aaa3]">
                              MMK
                            </span>
                          </td>
                          <td className="number-font px-4 py-3 text-right text-[10px] text-[#66736a]">
                            {transaction.commission ? (
                              <span className="inline-flex flex-col items-end gap-1">
                                <span>{formatMMK(transaction.commission)}</span>
                                <AccountBadge
                                  account={
                                    ledger.accounts.find(
                                      (account) =>
                                        account.id ===
                                        commissionAccountId(transaction),
                                    ) ?? ledger.accounts[0]
                                  }
                                  compact
                                />
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-3 text-right">
                            {transaction.date === activeDate && isOpen && (
                              <div className="flex justify-end gap-1">
                                <button
                                  onClick={() => editTransaction(transaction)}
                                  aria-label={`Edit ${kindLabel(transaction.kind)} transaction`}
                                  title="Edit transaction"
                                  className="grid size-6 place-items-center rounded-[5px] text-[#73877a] hover:bg-[#edf4e8]"
                                >
                                  <Pencil size={12} />
                                </button>
                                <button
                                  onClick={() =>
                                    removeTransaction(transaction.id)
                                  }
                                  disabled={!isOnline || isSaving}
                                  aria-label={`Remove ${kindLabel(transaction.kind)} transaction`}
                                  title="Remove transaction"
                                  className="grid size-6 place-items-center rounded-[5px] text-[#a1aba3] hover:bg-[#fff0e9] hover:text-[#b75c3d]"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredTransactions.length === 0 && (
                  <div className="flex min-h-[126px] flex-col items-center justify-center px-4 text-center">
                    <span className="grid size-8 place-items-center rounded-[8px] bg-[#f1f4ef] text-[#8a998c]">
                      <ReceiptText size={15} />
                    </span>
                    <p className="mb-0 mt-2 text-[10px] font-medium text-[#68756c]">
                      No transactions in this date range
                    </p>
                    <p className="mb-0 mt-1 text-[9px] text-[#9aa49c]">
                      Entries will appear here as you record them.
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}
          <footer className="mt-8 flex flex-col justify-between gap-2 border-t border-[#e3e8e2] pt-4 text-[9px] text-[#97a199] sm:flex-row">
            <span>Ledger · Daily cash operations</span>
          </footer>
        </div>
      </main>
      <nav
        className="app-bottom-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-[#e0e6df] bg-white/95 backdrop-blur"
        aria-label="Primary navigation"
      >
        {(
          [
            { id: "overview", label: "Overview", icon: LayoutDashboard },
            { id: "wallet", label: "Wallet", icon: WalletCards },
            { id: "transactions", label: "Transactions", icon: ArrowLeftRight },
            {
              id: "reconciliation",
              label: "Reconciliation",
              icon: CircleCheck,
            },
            { id: "customers", label: "Customers", icon: Users },
            { id: "reports", label: "Reports", icon: FileText },
          ] as { id: AppTab; label: string; icon: IconComponent }[]
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          const colors = {
            overview: {
              active: "text-sky-600",
              inactive: "text-sky-400",
              background: "bg-sky-100",
            },
            wallet: {
              active: "text-emerald-600",
              inactive: "text-emerald-400",
              background: "bg-emerald-100",
            },
            transactions: {
              active: "text-orange-600",
              inactive: "text-amber-500",
              background: "bg-orange-100",
            },
            reconciliation: {
              active: "text-violet-600",
              inactive: "text-violet-400",
              background: "bg-violet-100",
            },
            customers: {
              active: "text-amber-700",
              inactive: "text-amber-500",
              background: "bg-amber-100",
            },
            reports: {
              active: "text-rose-600",
              inactive: "text-rose-400",
              background: "bg-rose-100",
            },
          }[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => {
                setActiveTab(tab.id);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className={`flex h-full w-full min-w-0 flex-col items-center justify-center gap-0.5 border-l border-[#f0f2ef] px-0 pt-1.5 font-medium transition-colors first:border-l-0 ${active ? colors.active : colors.inactive}`}
            >
              <span
                className={`grid size-7 place-items-center rounded-[8px] ${active ? colors.background : ""}`}
              >
                <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
              </span>
              <span className="nav-label w-full max-w-full whitespace-nowrap text-center">
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>

      {modal === "admin" && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#10231c]/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setModal(null);
          }}
        >
          <form
            onSubmit={confirmAdminUnlock}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-dialog-title"
            className="dialog-safe-area fade-up relative z-[51] w-full max-h-[calc(100dvh-env(safe-area-inset-top))] max-w-[400px] overflow-y-auto rounded-t-[12px] border border-[#e4e8e3] bg-white p-5 shadow-[0_18px_70px_rgba(12,35,23,0.2)] sm:rounded-[12px] sm:p-6"
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[1.6px] text-[#8b968d]">
                  Admin authorization
                </p>
                <h2
                  id="admin-dialog-title"
                  className="m-0 text-[17px] font-semibold tracking-[-0.4px]"
                >
                  {adminAction === "date"
                    ? "Open past session"
                    : "Reopen closed session"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setModal(null)}
                aria-label="Close password dialog"
                className="relative z-[60] grid size-11 shrink-0 place-items-center rounded-[8px] text-[#66756b] hover:bg-[#f2f4f1]"
              >
                <X size={16} />
              </button>
            </div>
            <p className="mb-4 text-[11px] leading-5 text-[#7d8980]">
              Enter the admin password to unlock{" "}
              {formatDate(pendingDate, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}{" "}
              for editing.
            </p>
            <label className="field-label">
              Admin password
              <span className="input-wrap mt-1.5">
                <input
                  required
                  autoFocus
                  type="password"
                  autoComplete="current-password"
                  value={adminPassword}
                  onChange={(event) => {
                    setAdminPassword(event.target.value);
                    setAdminError("");
                  }}
                />
              </span>
            </label>
            {adminError && (
              <p role="alert" className="mb-0 mt-2 text-[10px] text-[#b05a3b]">
                {adminError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModal(null)}
                className="h-9 rounded-[7px] border border-[#e3e8e2] px-3.5 text-[10px] font-medium text-[#6d7971]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!isOnline || isSaving}
                className="flex h-9 items-center gap-1.5 rounded-[7px] bg-[#173c31] px-4 text-[10px] font-semibold text-white hover:bg-[#245745]"
              >
                <Check size={13} />
                Unlock session
              </button>
            </div>
          </form>
        </div>
      )}
      {modal === "accounts" && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#10231c]/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setModal(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-dialog-title"
            className="dialog-safe-area fade-up relative z-[51] max-h-[calc(100dvh-env(safe-area-inset-top))] w-full max-w-[720px] overflow-y-auto rounded-t-[12px] border border-[#e4e8e3] bg-white p-5 shadow-[0_18px_70px_rgba(12,35,23,0.2)] sm:rounded-[12px] sm:p-6"
          >
            <div className="mb-5 flex items-start justify-between">
              <div>
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-[1.6px] text-[#8b968d]">
                  Workspace settings
                </p>
                <h2
                  id="account-dialog-title"
                  className="m-0 text-[17px] font-semibold tracking-[-0.4px]"
                >
                  Wallets & accounts
                </h2>
                <p className="mb-0 mt-1 text-[10px] text-[#87928a]">
                  Edit account details or archive accounts while preserving
                  their history.
                </p>
              </div>
              <button
                onClick={() => setModal(null)}
                aria-label="Close account settings"
                className="relative z-[60] grid size-11 shrink-0 place-items-center rounded-[8px] text-[#66756b] hover:bg-[#f2f4f1]"
              >
                <X size={16} />
              </button>
            </div>
            <form
              onSubmit={submitAccount}
              className="mb-5 rounded-[9px] border border-[#e4e8e3] bg-[#fafbf9] p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="m-0 text-[11px] font-semibold">
                  {editingAccountId ? "Edit account" : "Add account"}
                </h3>
                {editingAccountId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingAccountId(null);
                      setAccountForm({
                        name: "",
                        shortName: "",
                        kind: "wallet",
                        accountNumber: "",
                        color: "sky",
                      });
                    }}
                    className="text-[9px] text-[#748078] underline underline-offset-2"
                  >
                    Cancel edit
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="field-label">
                  Account name
                  <span className="input-wrap">
                    <input
                      required
                      value={accountForm.name}
                      onChange={(event) =>
                        setAccountForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="e.g. KBZPay Main"
                    />
                  </span>
                </label>
                <label className="field-label">
                  Display name
                  <span className="input-wrap">
                    <input
                      value={accountForm.shortName}
                      onChange={(event) =>
                        setAccountForm((current) => ({
                          ...current,
                          shortName: event.target.value,
                        }))
                      }
                      placeholder="Short label for reports"
                    />
                  </span>
                </label>
                <label className="field-label">
                  Account type
                  <span className="select-wrap">
                    <select
                      value={accountForm.kind}
                      onChange={(event) =>
                        setAccountForm((current) => ({
                          ...current,
                          kind: event.target.value as AccountKind,
                        }))
                      }
                    >
                      {(["cash", "wallet", "qr", "bank"] as AccountKind[]).map(
                        (kind) => (
                          <option key={kind} value={kind}>
                            {kind === "qr"
                              ? "MMQR"
                              : kind[0].toUpperCase() + kind.slice(1)}
                          </option>
                        ),
                      )}
                    </select>
                    <ChevronDown size={14} />
                  </span>
                </label>
                <label className="field-label">
                  Account number{" "}
                  <span className="optional-label">Optional</span>
                  <span className="input-wrap">
                    <input
                      inputMode="text"
                      value={accountForm.accountNumber}
                      onChange={(event) =>
                        setAccountForm((current) => ({
                          ...current,
                          accountNumber: event.target.value,
                        }))
                      }
                      placeholder="Wallet or bank account"
                    />
                  </span>
                </label>
              </div>
              <fieldset className="mt-4 border-0 p-0">
                <legend className="mb-2 text-[10px] font-semibold text-[#68766d]">
                  Wallet color
                </legend>
                <div className="flex flex-wrap gap-2">
                  {accountColorOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() =>
                        setAccountForm((current) => ({
                          ...current,
                          color: option.id,
                        }))
                      }
                      aria-pressed={accountForm.color === option.id}
                      aria-label={option.name}
                      title={option.name}
                      className={`flex h-8 items-center gap-2 rounded-[7px] border px-2.5 text-[9px] font-medium transition ${accountForm.color === option.id ? "border-[#54764d] bg-white text-[#3d5143] ring-2 ring-[#dfead7]" : "border-[#e3e8e2] bg-white text-[#738078]"}`}
                    >
                      <span
                        className="size-3 rounded-full border border-black/10"
                        style={{ backgroundColor: option.swatch }}
                      />
                      {option.name}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="mt-4 flex justify-end">
                <button
                  type="submit"
                  disabled={!isOnline || isSaving}
                  className="flex h-9 items-center gap-1.5 rounded-[7px] bg-[#173c31] px-4 text-[10px] font-semibold text-white hover:bg-[#245745]"
                >
                  <Plus size={13} />
                  {editingAccountId ? "Save account" : "Add account"}
                </button>
              </div>
            </form>
            <div className="space-y-2">
              {ledger.accounts.map((account) => (
                <div
                  key={account.id}
                  className={`flex flex-wrap items-center gap-3 rounded-[8px] border px-3 py-2.5 ${account.deletedAt ? "border-dashed border-[#e5e9e4] bg-[#fafbf9] opacity-60" : "border-[#e5e9e4]"}`}
                >
                  <span
                    className={`grid size-8 shrink-0 place-items-center rounded-[7px] text-[10px] font-bold ${accountColorBadge(account.color)}`}
                  >
                    {account.mark}
                  </span>
                  <span className="min-w-[120px] flex-1">
                    <span className="block text-[10px] font-semibold text-[#34443b]">
                      {account.name}
                      {account.deletedAt && (
                        <span className="ml-2 text-[8px] font-medium uppercase text-[#a07a5d]">
                          Archived
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[9px] text-[#8a958d]">
                      {account.kind.toUpperCase()} ·{" "}
                      {account.accountNumber || "No account number"}
                    </span>
                  </span>
                  <div className="flex items-center gap-1">
                    {account.deletedAt ? (
                      <button
                        type="button"
                        onClick={() => restoreAccount(account.id)}
                        disabled={!isOnline || isSaving}
                        title="Restore account"
                        aria-label={`Restore ${account.name}`}
                        className="grid size-8 place-items-center rounded-[6px] text-[#62804f] hover:bg-[#eef5e7]"
                      >
                        <RotateCcw size={14} />
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => editAccount(account)}
                          title="Edit account"
                          aria-label={`Edit ${account.name}`}
                          className="grid size-8 place-items-center rounded-[6px] text-[#688071] hover:bg-[#f0f4ee]"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteAccount(account)}
                          disabled={account.id === "cash-drawer" || !isOnline || isSaving}
                          title={
                            account.id === "cash-drawer"
                              ? "Cash drawer is required"
                              : "Delete or archive account"
                          }
                          aria-label={`Delete ${account.name}`}
                          className="grid size-8 place-items-center rounded-[6px] text-[#a66e5a] hover:bg-[#fff0e9] disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {(modal === "open" || modal === "close") && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#10231c]/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setModal(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-dialog-title"
            className="dialog-safe-area fade-up relative z-[51] w-full max-h-[calc(100dvh-env(safe-area-inset-top))] max-w-[420px] overflow-y-auto rounded-t-[12px] border border-[#e4e8e3] bg-white p-5 shadow-[0_18px_70px_rgba(12,35,23,0.2)] sm:rounded-[12px] sm:p-6"
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[1.6px] text-[#8b968d]">
                  {formatDate(activeDate, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
                <h2
                  id="session-dialog-title"
                  className="m-0 text-[17px] font-semibold tracking-[-0.4px]"
                >
                  {modal === "open"
                    ? `Edit ${formatDate(activeDate, { month: "short", day: "numeric" })} opening balances`
                    : `Close ${formatDate(activeDate, { month: "short", day: "numeric" })} session`}
                </h2>
              </div>
              <button
                onClick={() => setModal(null)}
                aria-label="Close dialog"
                className="relative z-[60] grid size-11 shrink-0 place-items-center rounded-[8px] text-[#66756b] hover:bg-[#f2f4f1]"
              >
                <X size={16} />
              </button>
            </div>
            {modal === "open" ? (
              <form onSubmit={openSession}>
                <p className="mb-4 text-[11px] leading-5 text-[#7d8980]">
                  {todaySession
                    ? "Update the opening balances for this session. Editing does not change any other day."
                    : "Every account starts at zero for a new day. Select this session’s wallets and enter their counted opening balances."}
                </p>
                <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                  {openingAccounts.map((account) => {
                    const selected = openingAccountIds.includes(account.id);
                    const requiredCash = account.id === "cash-drawer";
                    return (
                      <div
                        key={account.id}
                        className="rounded-[8px] border border-[#e5e9e4] p-3"
                      >
                        <label className="flex items-center gap-2 text-[11px] font-medium text-[#34443b]">
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={requiredCash}
                            onChange={(event) => {
                              setOpeningAccountIds((current) =>
                                event.target.checked
                                  ? [...current, account.id]
                                  : current.filter((id) => id !== account.id),
                              );
                              if (event.target.checked)
                                setOpeningAmounts((current) => ({
                                  ...current,
                                  [account.id]: current[account.id] ?? "0",
                                }));
                            }}
                            className="accent-[#527d3a]"
                          />
                          <span className="flex-1">
                            {account.name}
                            {requiredCash ? " · required" : ""}
                          </span>
                          <span className="text-[9px] font-normal text-[#8c978f]">
                            {account.kind}
                          </span>
                        </label>
                        {selected && (
                          <label className="field-label mt-2">
                            Opening balance · MMK
                            <span className="input-wrap">
                              <input
                                inputMode="numeric"
                                type="text"
                                value={openingAmounts[account.id] ?? "0"}
                                onFocus={(event) => {
                                  if (event.currentTarget.value === "0") {
                                    setOpeningAmounts((current) => ({
                                      ...current,
                                      [account.id]: "",
                                    }));
                                  }
                                }}
                                onChange={(event) =>
                                  updateCurrencyInput(
                                    event.currentTarget,
                                    (value) =>
                                      setOpeningAmounts((current) => ({
                                        ...current,
                                        [account.id]: value,
                                      })),
                                  )
                                }
                                onBlur={(event) => {
                                  const formatted = formatCurrencyInputValue(
                                    event.currentTarget.value,
                                  );
                                  setOpeningAmounts((current) => ({
                                    ...current,
                                    [account.id]: formatted || "0",
                                  }));
                                }}
                              />
                            </span>
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="h-9 rounded-[7px] border border-[#e3e8e2] px-3.5 text-[10px] font-medium text-[#6d7971]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!isOnline || isSaving}
                    className="flex h-9 items-center gap-1.5 rounded-[7px] bg-[#173c31] px-4 text-[10px] font-semibold text-white hover:bg-[#245745]"
                  >
                    <Check size={13} />
                    Open session
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={closeSession}>
                <div className="mb-4 rounded-[8px] bg-[#f4f7f1] p-3.5">
                  <p className="m-0 text-[10px] font-semibold text-[#35463a]">
                    Count ground balances for each active account.
                  </p>
                  <p className="mb-0 mt-1.5 text-[9px] leading-4 text-[#98a198]">
                    System closing is calculated per wallet from its opening and
                    recorded movements.
                  </p>
                </div>
                <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                  {todayActiveAccounts.map((account) => {
                    const system = accountBalances[account.id] ?? 0;
                    const ground =
                      closingAmounts[account.id] ??
                      (system === 0 ? "0" : "");
                    const parsedGround = parseCurrencyInput(ground);
                    const difference =
                      ground === "" ? null : parsedGround - system;
                    return (
                      <div
                        key={account.id}
                        className="rounded-[8px] border border-[#e5e9e4] p-3"
                      >
                        <div className="mb-2 flex items-center justify-between text-[10px]">
                          <span className="font-semibold text-[#34443b]">
                            {account.name}
                          </span>
                          <span className="number-font text-[#6c7970]">
                            System {formatMMK(system)} MMK
                          </span>
                        </div>
                        <label className="field-label">
                          Ground balance · MMK
                          <span className="input-wrap">
                            <input
                              inputMode="numeric"
                              type="text"
                              id={`closing-balance-${account.id}`}
                              placeholder={system === 0 ? "0" : "Enter actual balance"}
                              value={ground}
                              onFocus={(event) => {
                                if (event.currentTarget.value === "0") {
                                  setClosingAmounts((current) => ({
                                    ...current,
                                    [account.id]: "",
                                  }));
                                }
                              }}
                              onChange={(event) =>
                                updateCurrencyInput(
                                  event.currentTarget,
                                  (value) =>
                                    setClosingAmounts((current) => ({
                                      ...current,
                                      [account.id]: value,
                                    })),
                                )
                              }
                              onBlur={(event) => {
                                const formatted = formatCurrencyInputValue(
                                  event.currentTarget.value,
                                );
                                setClosingAmounts((current) => ({
                                  ...current,
                                  [account.id]: formatted || "0",
                                }));
                              }}
                            />
                          </span>
                        </label>
                        {difference !== null && (
                          <div
                            className={`mt-2 flex justify-between rounded-[6px] px-2.5 py-2 text-[9px] ${difference === 0 ? "bg-[#eaf5df] text-[#4f7937]" : "bg-[#fff0e9] text-[#ae5c3e]"}`}
                          >
                            <span>
                              {difference === 0 ? "Balanced" : "Discrepancy"}
                            </span>
                            <span className="number-font font-semibold">
                              {difference > 0 ? "+" : ""}
                              {formatMMK(difference)} MMK
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="h-9 rounded-[7px] border border-[#e3e8e2] px-3.5 text-[10px] font-medium text-[#6d7971]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!isOnline || isSaving}
                    className="flex h-9 items-center gap-1.5 rounded-[7px] bg-[#173c31] px-4 text-[10px] font-semibold text-white hover:bg-[#245745]"
                  >
                    <Check size={13} />
                    Close day
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

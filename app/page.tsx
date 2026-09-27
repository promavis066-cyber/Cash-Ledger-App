"use client";

import {
  Activity, ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight,
  CalendarDays, Check, ChevronDown, CircleAlert, CircleCheck, Clock3,
  FileSpreadsheet, FileText, LayoutDashboard, Landmark, Menu, Plus,
  Printer, ReceiptText, Search, TrendingUp, WalletCards, X,
} from "lucide-react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  accounts, computeAccountBalances, computeSystemClosing, emptyLedger,
  formatMMK, kindLabel, LedgerData, LedgerTransaction, TransactionKind,
  AccountId, STORAGE_KEY,
} from "@/lib/ledger";

type ModalKind = "open" | "close" | null;
type IconComponent = typeof Activity;

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
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[character];
  });
}

function formatDate(dateKey: string, options: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-US", options).format(new Date(`${dateKey}T12:00:00`));
}

function accountName(id: AccountId | null) {
  return accounts.find((account) => account.id === id)?.shortName ?? "Cash drawer";
}

function transactionParty(transaction: LedgerTransaction) {
  if (transaction.kind === "TRANSFER") return `${accountName(transaction.fromAccountId)} → ${accountName(transaction.toAccountId)}`;
  if (transaction.kind === "CASH_IN") return `${accountName(transaction.fromAccountId)} → Cash drawer`;
  if (transaction.kind === "CASH_OUT") return `Cash drawer → ${accountName(transaction.toAccountId)}`;
  return `Paid from ${accountName(transaction.fromAccountId)}`;
}

export default function Home() {
  const today = getDateKey(new Date());
  const [ledger, setLedger] = useState<LedgerData>(emptyLedger);
  const [hydrated, setHydrated] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [openingInput, setOpeningInput] = useState("");
  const [closingInput, setClosingInput] = useState("");
  const [transactionKind, setTransactionKind] = useState<TransactionKind>("CASH_IN");
  const [serviceAccountId, setServiceAccountId] = useState<AccountId>("kbzpay");
  const [fromAccountId, setFromAccountId] = useState<AccountId>("kbzpay");
  const [toAccountId, setToAccountId] = useState<AccountId>("wavemoney");
  const [amountInput, setAmountInput] = useState("");
  const [commissionInput, setCommissionInput] = useState("");
  const [customerInput, setCustomerInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [message, setMessage] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const savedLedger = window.localStorage.getItem(STORAGE_KEY);
        if (savedLedger) {
          const parsed = JSON.parse(savedLedger) as LedgerData;
          setLedger({ sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [], transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [] });
        }
      } catch {
        setMessage("Saved ledger data could not be read on this device.");
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
  }, [hydrated, ledger]);

  const todaySession = ledger.sessions.find((session) => session.date === today) ?? null;
  const todayTransactions = useMemo(() => ledger.transactions.filter((transaction) => transaction.date === today), [ledger.transactions, today]);
  const filteredTransactions = useMemo(() => ledger.transactions.filter((transaction) => transaction.date >= dateFrom && transaction.date <= dateTo), [dateFrom, dateTo, ledger.transactions]);
  const openingBalance = todaySession?.openingBalance ?? 0;
  const systemClosing = computeSystemClosing(openingBalance, todayTransactions);
  const commissions = todayTransactions.reduce((total, transaction) => total + transaction.commission, 0);
  const cashInTotal = todayTransactions.filter((transaction) => transaction.kind === "CASH_IN").reduce((total, transaction) => total + transaction.amount, 0);
  const cashOutTotal = todayTransactions.filter((transaction) => transaction.kind === "CASH_OUT").reduce((total, transaction) => total + transaction.amount, 0);
  const expenseTotal = todayTransactions.filter((transaction) => transaction.kind === "EXPENSE").reduce((total, transaction) => total + transaction.amount, 0);
  const balances = computeAccountBalances(openingBalance, todayTransactions);
  const isOpen = Boolean(todaySession && todaySession.closedAt === null);
  const isClosed = Boolean(todaySession?.closedAt);
  const closingDifference = todaySession?.closingBalance == null ? null : todaySession.closingBalance - systemClosing;
  const reportStartSession = ledger.sessions.find((session) => session.date === dateFrom);
  const reportEndSession = ledger.sessions.find((session) => session.date === dateTo);
  const reportEndTransactions = filteredTransactions.filter((transaction) => transaction.date === dateTo);
  const reportOpeningBalance = reportStartSession?.openingBalance ?? 0;
  const reportSystemClosing = computeSystemClosing(reportEndSession?.openingBalance ?? 0, reportEndTransactions);
  const reportCommissions = filteredTransactions.reduce((total, transaction) => total + transaction.commission, 0);

  function notify(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 3500);
  }

  function openSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const opening = Number(openingInput);
    if (!Number.isFinite(opening) || opening < 0) return;
    const newSession = { date: today, openingBalance: opening, closingBalance: null, openedAt: new Date().toISOString(), closedAt: null };
    setLedger((current) => ({ ...current, sessions: [...current.sessions.filter((session) => session.date !== today), newSession] }));
    setModal(null);
    setOpeningInput("");
    notify("Morning session opened. Opening balance recorded.");
  }

  function closeSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const actual = Number(closingInput);
    if (!todaySession || !Number.isFinite(actual) || actual < 0) return;
    setLedger((current) => ({ ...current, sessions: current.sessions.map((session) => session.date === today ? { ...session, closingBalance: actual, closedAt: new Date().toISOString() } : session) }));
    setModal(null);
    setClosingInput("");
    notify("Session closed. Reconciliation is ready.");
  }

  function addTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(amountInput);
    const commission = Number(commissionInput || 0);
    if (!isOpen) {
      notify("Open today’s session before recording transactions.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(commission) || commission < 0) return;
    if (transactionKind === "TRANSFER" && fromAccountId === toAccountId) {
      notify("Choose two different accounts for a transfer.");
      return;
    }
    const isCashIn = transactionKind === "CASH_IN";
    const isCashOut = transactionKind === "CASH_OUT";
    const source: AccountId = isCashIn ? serviceAccountId : isCashOut || transactionKind === "EXPENSE" ? "cash-drawer" : fromAccountId;
    const destination: AccountId | null = isCashIn ? "cash-drawer" : isCashOut ? serviceAccountId : transactionKind === "TRANSFER" ? toAccountId : null;
    const now = new Date();
    const transaction: LedgerTransaction = {
      id: crypto.randomUUID(), date: today,
      time: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      kind: transactionKind, customer: customerInput.trim(), phone: phoneInput.trim(), amount,
      commission: transactionKind === "EXPENSE" ? 0 : commission,
      note: noteInput.trim(), fromAccountId: source, toAccountId: destination,
    };
    setLedger((current) => ({ ...current, transactions: [transaction, ...current.transactions] }));
    setAmountInput(""); setCommissionInput(""); setCustomerInput(""); setPhoneInput(""); setNoteInput("");
    notify(`${kindLabel(transactionKind)} recorded.`);
  }

  function removeTransaction(id: string) {
    setLedger((current) => ({ ...current, transactions: current.transactions.filter((transaction) => transaction.id !== id) }));
    notify("Transaction removed from this device.");
  }

  function exportExcel() {
    const rows = filteredTransactions.map((transaction) => ({
      Date: transaction.date, Time: transaction.time, Type: kindLabel(transaction.kind),
      Customer: transaction.customer || "-", Phone: transaction.phone || "-",
      Account: transactionParty(transaction), Amount_MMK: transaction.amount,
      Commission_MMK: transaction.commission, Note: transaction.note || "-",
    }));
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: "No transactions in selected date range" }]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Transactions");
    XLSX.writeFile(workbook, `ledger-${dateFrom}-to-${dateTo}.xlsx`);
  }

  function exportPdf() {
    const document = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    document.setFont("helvetica", "bold"); document.setFontSize(19); document.text("Daily cash ledger", 16, 19);
    document.setFont("helvetica", "normal"); document.setFontSize(10);
    document.text(`Statement period: ${dateFrom} to ${dateTo}`, 16, 27);
    document.text(`Start-day opening: MMK ${formatMMK(reportOpeningBalance)}`, 16, 34);
    document.text(`End-day system close: MMK ${formatMMK(reportSystemClosing)}`, 16, 41);
    document.text(`Commissions in period: MMK ${formatMMK(reportCommissions)}`, 16, 48);
    autoTable(document, {
      startY: 56,
      head: [["Time", "Type", "Customer / account", "Amount (MMK)", "Fee"]],
      body: filteredTransactions.map((transaction) => [transaction.time, kindLabel(transaction.kind), transaction.customer || transactionParty(transaction), formatMMK(transaction.amount), formatMMK(transaction.commission)]),
      styles: { fontSize: 8, cellPadding: 2.5 }, headStyles: { fillColor: [23, 60, 49] }, margin: { left: 16, right: 16 },
    });
    document.save(`ledger-summary-${dateFrom}-to-${dateTo}.pdf`);
  }

  function printThermalSlip() {
    const printWindow = window.open("", "_blank", "width=360,height=760");
    if (!printWindow) {
      notify("Allow pop-ups to print the 80 mm slip.");
      return;
    }
    const rows = filteredTransactions.map((transaction) => `
      <tr><td colspan="2" class="item">${escapeHtml(kindLabel(transaction.kind))} · ${escapeHtml(transaction.time)}</td></tr>
      <tr><td>${escapeHtml(transaction.customer || transactionParty(transaction))}</td><td class="amount">${formatMMK(transaction.amount)}</td></tr>
      ${transaction.commission ? `<tr><td class="muted">Commission</td><td class="amount">${formatMMK(transaction.commission)}</td></tr>` : ""}
    `).join("");
    printWindow.document.write(`<!doctype html><html><head><title>Ledger receipt</title><style>
      @page{size:80mm auto;margin:4mm}*{box-sizing:border-box}body{width:72mm;margin:0;color:#17251f;font:12px/1.4 Arial,sans-serif}header{text-align:center;border-bottom:1px dashed #555;padding-bottom:10px}h1{font-size:19px;margin:0 0 5px}p{margin:2px 0}.rule{border:0;border-top:1px dashed #777;margin:9px 0}table{width:100%;border-collapse:collapse}td{padding:2px 0;vertical-align:top}.item{padding-top:7px;font-weight:bold}.amount{text-align:right;white-space:nowrap}.muted{color:#666}.total{font-weight:bold;font-size:13px}footer{text-align:center;margin-top:14px}
      </style></head><body><header><h1>DAILY LEDGER</h1><p>${escapeHtml(formatDate(dateFrom, { month: "short", day: "numeric", year: "numeric" }))}</p><p>Statement ${escapeHtml(dateFrom)} to ${escapeHtml(dateTo)}</p></header><hr class="rule"><table>${rows || "<tr><td>No transactions in this period</td></tr>"}</table><hr class="rule"><table><tr><td>Start-day opening</td><td class="amount">${formatMMK(reportOpeningBalance)}</td></tr><tr class="total"><td>End-day system close</td><td class="amount">${formatMMK(reportSystemClosing)}</td></tr></table><footer>Thank you</footer><script>window.onload=()=>window.print()<\/script></body></html>`);
    printWindow.document.close();
  }

  const rangeInflow = filteredTransactions.filter((transaction) => transaction.kind === "CASH_IN").reduce((total, transaction) => total + transaction.amount, 0);
  const rangeOutflow = filteredTransactions.filter((transaction) => transaction.kind === "CASH_OUT" || transaction.kind === "EXPENSE").reduce((total, transaction) => total + transaction.amount, 0);

  return (
    <div className="dashboard-shell flex min-h-screen">
      <aside className="sidebar fixed inset-y-0 left-0 z-30 hidden w-[236px] flex-col px-5 py-6 text-white lg:flex">
        <a href="#overview" className="mb-11 flex items-center gap-3 px-2 no-underline"><span className="grid size-10 place-items-center rounded-[12px] bg-[#c6f36b] text-[#173c31]"><Activity size={21} strokeWidth={2.5} /></span><span><span className="block text-[19px] font-semibold tracking-[-0.5px]">ledger<span className="text-[#c6f36b]">.</span></span><span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-[1.7px] text-white/45">Cash operations</span></span></a>
        <p className="mb-3 px-3 text-[9px] font-semibold uppercase tracking-[1.8px] text-white/40">Workspace</p>
        <nav className="flex flex-col gap-1" aria-label="Main navigation">
          <a href="#overview" className="flex h-10 items-center gap-3 rounded-[8px] bg-white/10 px-3 text-[12px] font-medium text-white no-underline"><LayoutDashboard size={16} />Overview<span className="ml-auto size-1.5 rounded-full bg-[#c6f36b]" /></a>
          <a href="#transactions" className="flex h-10 items-center gap-3 rounded-[8px] px-3 text-[12px] text-white/65 transition hover:bg-white/7 hover:text-white no-underline"><ArrowLeftRight size={16} />Transactions</a>
          <a href="#reconciliation" className="flex h-10 items-center gap-3 rounded-[8px] px-3 text-[12px] text-white/65 transition hover:bg-white/7 hover:text-white no-underline"><CircleCheck size={16} />Reconciliation</a>
          <a href="#reports" className="flex h-10 items-center gap-3 rounded-[8px] px-3 text-[12px] text-white/65 transition hover:bg-white/7 hover:text-white no-underline"><FileText size={16} />Reports</a>
        </nav>
        <div className="mt-9"><p className="mb-3 px-3 text-[9px] font-semibold uppercase tracking-[1.8px] text-white/40">Accounts</p><nav className="flex flex-col gap-1" aria-label="Payment accounts">
          {accounts.map((account) => <a key={account.id} href="#accounts" className="flex h-9 items-center gap-3 rounded-[8px] px-3 text-[11px] text-white/65 transition hover:bg-white/7 hover:text-white no-underline"><span className={`grid size-5 place-items-center rounded-[6px] text-[9px] font-bold ${account.color === "mint" ? "bg-[#c6f36b] text-[#173c31]" : account.color === "sky" ? "bg-[#9bc9eb] text-[#173c31]" : account.color === "gold" ? "bg-[#f2c77d] text-[#49371e]" : "bg-[#edaaa7] text-[#522b2d]"}`}>{account.mark}</span>{account.shortName}</a>)}
        </nav></div>
        <div className="mt-auto rounded-[10px] border border-white/10 bg-white/5 p-3.5"><div className="flex items-center gap-2 text-[10px] font-medium text-white/80"><span className={`size-1.5 rounded-full ${isOpen ? "animate-pulse bg-[#c6f36b]" : "bg-white/35"}`} />{isOpen ? "Session in progress" : isClosed ? "Day completed" : "No session started"}</div><p className="mb-0 mt-2 text-[10px] leading-4 text-white/45">{isOpen ? `Opened ${todaySession?.openedAt ? new Date(todaySession.openedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "today"}` : "Your records are saved on this device."}</p></div>
      </aside>

      <main id="overview" className="min-w-0 flex-1 lg:ml-[236px]">
        <header className="topbar-actions sticky top-0 z-20 flex min-h-[72px] items-center justify-between border-b border-[#e5e9e4] bg-[#f3f5f2]/95 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-3"><button aria-label="Toggle navigation" onClick={() => setMobileNavOpen(!mobileNavOpen)} className="grid size-9 place-items-center rounded-[8px] border border-[#e1e6e0] bg-white text-[#34443c] lg:hidden">{mobileNavOpen ? <X size={17} /> : <Menu size={17} />}</button><div><p className="m-0 text-[10px] font-medium uppercase tracking-[1.5px] text-[#87928b]">Daily operations</p><h1 className="m-0 mt-0.5 text-[15px] font-semibold tracking-[-0.25px] text-[#17251f]">Cash ledger</h1></div></div>
          <div className="flex items-center gap-2.5 md:gap-4"><div className="hidden items-center gap-2 text-[11px] text-[#758179] sm:flex"><CalendarDays size={14} />{formatDate(today, { weekday: "short", month: "short", day: "numeric" })}</div>{isOpen ? <button onClick={() => setModal("close")} className="flex h-9 items-center gap-2 rounded-[8px] bg-[#173c31] px-3.5 text-[11px] font-semibold text-white transition hover:bg-[#245745]"><span className="size-1.5 rounded-full bg-[#c6f36b]" />Close session</button> : isClosed ? <span className="flex h-9 items-center gap-2 rounded-[8px] border border-[#dce4da] bg-white px-3 text-[11px] font-semibold text-[#5c6a61]"><Check size={14} />Session closed</span> : <button onClick={() => setModal("open")} className="flex h-9 items-center gap-2 rounded-[8px] bg-[#173c31] px-3.5 text-[11px] font-semibold text-white transition hover:bg-[#245745]"><Plus size={15} />Open session</button>}</div>
        </header>
        {mobileNavOpen && <nav className="scrollbar-hidden flex gap-2 overflow-x-auto border-b border-[#e5e9e4] bg-white px-4 py-2.5 lg:hidden" aria-label="Mobile navigation">{[["#overview", "Overview"], ["#transactions", "Transactions"], ["#reconciliation", "Reconciliation"], ["#reports", "Reports"]].map(([href, label]) => <a key={href} href={href} onClick={() => setMobileNavOpen(false)} className="whitespace-nowrap rounded-[7px] bg-[#f3f5f2] px-3 py-2 text-[11px] font-medium text-[#516057] no-underline">{label}</a>)}</nav>}

        <div className="mx-auto max-w-[1440px] px-4 pb-12 pt-6 md:px-8 md:pt-8">
          {message && <div role="status" className="fade-up mb-4 flex items-center gap-2 rounded-[8px] border border-[#d9e8c9] bg-[#eff7e6] px-3.5 py-2.5 text-[11px] text-[#42642d]"><CircleCheck size={15} />{message}</div>}
          <section className="fade-up mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[1.8px] text-[#8b968e]">{formatDate(today)}</p><h2 className="m-0 text-[24px] font-semibold leading-tight tracking-[-0.9px] text-[#17251f] md:text-[29px]">Good day, operator<span className="text-[#87a953]">.</span></h2><p className="mb-0 mt-2 text-[12px] text-[#7b8780]">Your counter at a glance. Every kyat accounted for.</p></div><div className="flex items-center gap-2 self-start rounded-[7px] border border-[#e1e6e0] bg-white px-3 py-2 text-[10px] text-[#657269] sm:self-auto"><span className={`size-1.5 rounded-full ${isOpen ? "bg-[#76aa42]" : isClosed ? "bg-[#87928b]" : "bg-[#efa265]"}`} />{isOpen ? "Day is open" : isClosed ? "Day is closed" : "Awaiting opening balance"}</div></section>

          <section className="mb-5 grid gap-4 xl:grid-cols-[1.35fr_0.85fr]">
            <div className="relative min-h-[212px] overflow-hidden rounded-[11px] bg-[#173c31] p-5 text-white md:p-6"><div className="pointer-events-none absolute -right-8 -top-14 size-60 rounded-full border border-white/8" /><div className="pointer-events-none absolute -right-1 -top-7 size-44 rounded-full border border-white/8" /><div className="relative flex h-full flex-col justify-between gap-8"><div className="flex items-start justify-between gap-4"><div><p className="mb-2 text-[10px] font-medium uppercase tracking-[1.7px] text-white/55">Cash position · MMK</p><p className="number-font m-0 text-[31px] font-semibold tracking-[-1px] md:text-[38px]">{formatMMK(balances["cash-drawer"])}</p><p className="mb-0 mt-2 text-[10px] text-white/55">{isOpen ? "Live drawer balance" : isClosed ? "Final drawer balance" : "Opening balance not set"}</p></div><span className="grid size-10 shrink-0 place-items-center rounded-[9px] bg-[#c6f36b] text-[#173c31]"><WalletCards size={19} /></span></div><div className="flex flex-wrap items-end justify-between gap-4 border-t border-white/15 pt-3.5"><div className="flex gap-6"><div><p className="m-0 text-[9px] uppercase tracking-[1px] text-white/50">Opening</p><p className="number-font mb-0 mt-1 text-[12px] font-medium">{formatMMK(openingBalance)} <span className="text-[9px] text-white/45">MMK</span></p></div><div><p className="m-0 text-[9px] uppercase tracking-[1px] text-white/50">System close</p><p className="number-font mb-0 mt-1 text-[12px] font-medium">{formatMMK(systemClosing)} <span className="text-[9px] text-white/45">MMK</span></p></div></div><span className="text-[9px] text-white/50">Updated just now</span></div></div></div>
            <div className="flex min-h-[212px] flex-col justify-between rounded-[11px] border border-[#e4e8e3] bg-white p-5 md:p-6"><div className="flex items-start justify-between"><div><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[1.5px] text-[#8a958d]">Session control</p><h3 className="m-0 text-[16px] font-semibold tracking-[-0.3px]">{isOpen ? "Morning session" : isClosed ? "Session complete" : "Start the day"}</h3></div><span className={`grid size-9 place-items-center rounded-[8px] ${isOpen ? "bg-[#eff7e6] text-[#6b963d]" : "bg-[#f3f5f2] text-[#768279]"}`}>{isOpen ? <Clock3 size={17} /> : isClosed ? <Check size={17} /> : <Activity size={17} />}</span></div><p className="mb-4 mt-2 max-w-[320px] text-[11px] leading-5 text-[#849087]">{isOpen ? `Opened at ${new Date(todaySession!.openedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}. Record activity as it happens.` : isClosed ? `Closed at ${new Date(todaySession!.closedAt!).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}. Today’s figures are locked in.` : "Enter the physical opening cash before you start recording today’s transactions."}</p><div className="flex items-center justify-between gap-3 border-t border-[#edf0ec] pt-3.5"><span className="text-[10px] text-[#87928a]">{todayTransactions.length} transaction{todayTransactions.length === 1 ? "" : "s"} today</span>{!todaySession && <button onClick={() => setModal("open")} className="flex h-8 items-center gap-1.5 rounded-[7px] bg-[#c6f36b] px-3 text-[10px] font-semibold text-[#23432f] transition hover:bg-[#b5e659]">Set opening balance<ArrowRight size={13} /></button>}{isOpen && <button onClick={() => setModal("close")} className="text-[10px] font-semibold text-[#385e47] underline decoration-[#b5c5b6] underline-offset-4">Reconcile & close</button>}</div></div>
          </section>

          <section className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">{[
            { label: "Cash-in volume", amount: cashInTotal, hint: "Customer deposits", icon: ArrowDownLeft, tone: "bg-[#eaf5de] text-[#4b7b33]" },
            { label: "Cash-out volume", amount: cashOutTotal, hint: "Customer withdrawals", icon: ArrowUpRight, tone: "bg-[#fff0e8] text-[#b66343]" },
            { label: "Commissions", amount: commissions, hint: "Fees earned today", icon: TrendingUp, tone: "bg-[#e6f1f8] text-[#457a9d]" },
            { label: "Operating expense", amount: expenseTotal, hint: "Cash paid out", icon: ReceiptText, tone: "bg-[#f2edf5] text-[#795e85]" },
          ].map((metric) => <div key={metric.label} className="rounded-[10px] border border-[#e5e9e4] bg-white p-4 md:p-5"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-medium text-[#758178]">{metric.label}</span><span className={`grid size-7 place-items-center rounded-[7px] ${metric.tone}`}><metric.icon size={14} /></span></div><p className="number-font mb-0 mt-3 text-[19px] font-semibold tracking-[-0.6px] text-[#1c2b23] md:text-[22px]">{formatMMK(metric.amount)} <span className="text-[9px] font-medium tracking-normal text-[#98a199]">MMK</span></p><p className="mb-0 mt-1 text-[9px] text-[#98a199]">{metric.hint}</p></div>)}</section>

          <section id="accounts" className="mb-7 scroll-mt-24"><div className="mb-3 flex items-end justify-between"><div><h3 className="m-0 text-[13px] font-semibold">Account balances</h3><p className="mb-0 mt-1 text-[10px] text-[#8b968d]">Movement recorded in today’s session</p></div><span className="hidden items-center gap-1.5 text-[9px] text-[#929d94] sm:flex"><Landmark size={12} />8 accounts</span></div><div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">{accounts.map((account) => <div key={account.id} className="min-w-0 rounded-[9px] border border-[#e5e9e4] bg-white px-3 py-3"><div className="mb-3 flex items-center gap-2"><span className={`grid size-6 shrink-0 place-items-center rounded-[7px] text-[9px] font-bold ${account.color === "mint" ? "bg-[#e6f4cf] text-[#43712c]" : account.color === "sky" ? "bg-[#e2f0f8] text-[#457896]" : account.color === "gold" ? "bg-[#fff1d6] text-[#9b7530]" : "bg-[#f8e6e5] text-[#a46060]"}`}>{account.mark}</span><span className="truncate text-[9px] font-medium text-[#69766e]">{account.shortName}</span></div><p className="number-font m-0 truncate text-[13px] font-semibold tracking-[-0.3px] text-[#213128]">{formatMMK(balances[account.id])}</p><p className="mb-0 mt-0.5 text-[8px] text-[#a0aaa2]">MMK</p></div>)}</div></section>

          <section id="transactions" className="mb-7 scroll-mt-24"><div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><h3 className="m-0 text-[13px] font-semibold">Quick transaction</h3><p className="mb-0 mt-1 text-[10px] text-[#8b968d]">Capture a counter movement in a few seconds</p></div>{!isOpen && <span className="flex items-center gap-1.5 self-start text-[10px] text-[#ac7954]"><CircleAlert size={13} />Open a session to enter transactions</span>}</div>
            <form onSubmit={addTransaction} className="rounded-[10px] border border-[#e4e8e3] bg-white p-4 md:p-5"><div className="mb-4 flex gap-1.5 overflow-x-auto border-b border-[#edf0ec] pb-3 scrollbar-hidden" role="tablist" aria-label="Transaction type">{(["CASH_IN", "CASH_OUT", "TRANSFER", "EXPENSE"] as TransactionKind[]).map((kind) => { const Icon = kindIcons[kind]; return <button type="button" role="tab" aria-selected={transactionKind === kind} key={kind} onClick={() => setTransactionKind(kind)} className={`flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] px-3 text-[10px] font-medium transition ${transactionKind === kind ? "bg-[#173c31] text-white" : "bg-[#f5f7f4] text-[#758178] hover:bg-[#edf1ec]"}`}><Icon size={13} />{kindLabel(kind)}</button>; })}</div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {(transactionKind === "CASH_IN" || transactionKind === "CASH_OUT") && <label className="field-label">{transactionKind === "CASH_IN" ? "Received via" : "Paid to"}<span className="select-wrap"><select value={serviceAccountId} onChange={(event) => setServiceAccountId(event.target.value as AccountId)}>{accounts.filter((account) => account.id !== "cash-drawer").map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><ChevronDown size={14} /></span></label>}
                {transactionKind === "TRANSFER" && <><label className="field-label">From account<span className="select-wrap"><select value={fromAccountId} onChange={(event) => setFromAccountId(event.target.value as AccountId)}>{accounts.filter((account) => account.id !== "cash-drawer").map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><ChevronDown size={14} /></span></label><label className="field-label">To account<span className="select-wrap"><select value={toAccountId} onChange={(event) => setToAccountId(event.target.value as AccountId)}>{accounts.filter((account) => account.id !== "cash-drawer").map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><ChevronDown size={14} /></span></label></>}
                {transactionKind === "EXPENSE" && <label className="field-label">Paid from<span className="flex h-[38px] items-center rounded-[7px] border border-[#e3e8e2] bg-[#f8faf7] px-3 text-[11px] font-normal text-[#536258]">Cash in drawer</span></label>}
                <label className="field-label">Amount · MMK<span className="input-wrap"><input required min="1" step="1" inputMode="numeric" type="number" placeholder="0" value={amountInput} onChange={(event) => setAmountInput(event.target.value)} /></span></label>
                {transactionKind !== "EXPENSE" && <label className="field-label">Commission · MMK<span className="input-wrap"><input min="0" step="1" inputMode="numeric" type="number" placeholder="0" value={commissionInput} onChange={(event) => setCommissionInput(event.target.value)} /></span></label>}
                <label className="field-label">Customer name <span className="optional-label">Optional</span><span className="input-wrap"><input autoComplete="name" placeholder="Name at counter" value={customerInput} onChange={(event) => setCustomerInput(event.target.value)} /></span></label>
                <label className="field-label">Phone number <span className="optional-label">Optional</span><span className="input-wrap"><input autoComplete="tel" inputMode="tel" placeholder="09 xxx xxx xxx" value={phoneInput} onChange={(event) => setPhoneInput(event.target.value)} /></span></label>
                <label className="field-label sm:col-span-2">Note <span className="optional-label">Optional</span><span className="input-wrap"><input placeholder="Reference or short note" value={noteInput} onChange={(event) => setNoteInput(event.target.value)} /></span></label>
              </div><div className="mt-4 flex flex-col-reverse justify-between gap-3 border-t border-[#edf0ec] pt-3.5 sm:flex-row sm:items-center"><span className="text-[9px] text-[#99a39b]">Transactions are saved in this browser on this device.</span><button disabled={!isOpen} type="submit" className="flex h-9 items-center justify-center gap-2 rounded-[7px] bg-[#c6f36b] px-4 text-[10px] font-semibold text-[#244330] transition hover:bg-[#b5e659] disabled:cursor-not-allowed disabled:opacity-45"><Plus size={14} />Add transaction</button></div>
            </form></section>

          <section className="mb-7 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <div id="reconciliation" className="scroll-mt-24 rounded-[10px] border border-[#e4e8e3] bg-white p-4 md:p-5"><div className="mb-4 flex items-start justify-between gap-3"><div><h3 className="m-0 text-[13px] font-semibold">Evening reconciliation</h3><p className="mb-0 mt-1 text-[10px] text-[#8b968d]">Cash drawer · today</p></div><span className="grid size-8 place-items-center rounded-[7px] bg-[#eef5e7] text-[#6a913f]"><CircleCheck size={16} /></span></div>
              <div className="overflow-hidden rounded-[8px] border border-[#edf0ec]">{[["Opening balance", openingBalance, "#"], ["Cash-in", cashInTotal, "+"], ["Cash-out & expenses", cashOutTotal + expenseTotal, "−"], ["Commissions", commissions, "+"]].map(([label, amount, sign]) => <div key={label} className="flex items-center justify-between border-b border-[#edf0ec] px-3.5 py-2.5 last:border-0"><span className="text-[10px] text-[#758178]">{label}</span><span className="number-font text-[10px] font-medium text-[#3a4940]">{sign === "#" ? "" : sign}{formatMMK(Number(amount))} <span className="text-[8px] text-[#a0aaa2]">MMK</span></span></div>)}<div className="flex items-center justify-between bg-[#f4f7f1] px-3.5 py-3"><span className="text-[10px] font-semibold text-[#304439]">System closing</span><span className="number-font text-[13px] font-semibold text-[#21392b]">{formatMMK(systemClosing)} <span className="text-[8px] font-medium">MMK</span></span></div></div>
              {todaySession?.closingBalance != null && <div className={`mt-3 flex items-center justify-between rounded-[7px] px-3 py-2.5 ${closingDifference === 0 ? "bg-[#eaf5df] text-[#4f7937]" : "bg-[#fff0e9] text-[#b05a3b]"}`}><span className="flex items-center gap-1.5 text-[10px] font-semibold">{closingDifference === 0 ? <CircleCheck size={13} /> : <CircleAlert size={13} />}{closingDifference === 0 ? "Balanced" : "Discrepancy"}<span className="font-normal opacity-70">· actual {formatMMK(todaySession.closingBalance)} MMK</span></span><span className="number-font text-[11px] font-semibold">{closingDifference === 0 ? "0" : `${closingDifference! > 0 ? "+" : "−"}${formatMMK(Math.abs(closingDifference!))}`} MMK</span></div>}
              {isOpen && <button onClick={() => setModal("close")} className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-[7px] border border-[#dce5d9] text-[10px] font-semibold text-[#3e6248] transition hover:bg-[#f4f8ef]"><Check size={14} />Enter actual cash & close</button>}{!todaySession && <button onClick={() => setModal("open")} className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-[7px] border border-[#dce5d9] text-[10px] font-semibold text-[#3e6248] transition hover:bg-[#f4f8ef]"><Plus size={14} />Open session to begin</button>}
            </div>
            <div className="rounded-[10px] border border-[#e4e8e3] bg-white p-4 md:p-5"><div className="mb-4 flex items-start justify-between"><div><h3 className="m-0 text-[13px] font-semibold">Today’s activity</h3><p className="mb-0 mt-1 text-[10px] text-[#8b968d]">Account movement in the session</p></div><span className="text-[9px] text-[#929d94]">{todayTransactions.length} records</span></div><div className="space-y-3.5">{[
              { label: "Cash received", value: cashInTotal, icon: ArrowDownLeft, color: "text-[#608c3f]", percent: systemClosing ? Math.min((cashInTotal / Math.abs(systemClosing || 1)) * 100, 100) : 0 },
              { label: "Cash paid out", value: cashOutTotal + expenseTotal, icon: ArrowUpRight, color: "text-[#bc7452]", percent: systemClosing ? Math.min(((cashOutTotal + expenseTotal) / Math.abs(systemClosing || 1)) * 100, 100) : 0 },
              { label: "Fees earned", value: commissions, icon: TrendingUp, color: "text-[#5282a0]", percent: systemClosing ? Math.min((commissions / Math.abs(systemClosing || 1)) * 100, 100) : 0 },
            ].map((item) => <div key={item.label}><div className="mb-1.5 flex items-center justify-between"><span className="flex items-center gap-1.5 text-[10px] text-[#6f7b73]"><item.icon size={13} className={item.color} />{item.label}</span><span className="number-font text-[10px] font-semibold">{formatMMK(item.value)} <span className="text-[8px] font-normal text-[#9ba59d]">MMK</span></span></div><div className="h-[5px] overflow-hidden rounded-full bg-[#f0f2ef]"><div className={`h-full rounded-full ${item.label === "Cash received" ? "bg-[#a9d47a]" : item.label === "Cash paid out" ? "bg-[#efb088]" : "bg-[#9bc9eb]"}`} style={{ width: `${item.percent}%` }} /></div></div>)}</div><div className="mt-5 flex items-center justify-between border-t border-[#edf0ec] pt-3"><span className="flex items-center gap-1.5 text-[9px] text-[#89948c]"><Activity size={12} />Net drawer change</span><span className="number-font text-[11px] font-semibold">{systemClosing - openingBalance >= 0 ? "+" : "−"}{formatMMK(Math.abs(systemClosing - openingBalance))} <span className="text-[8px] font-normal text-[#9ba59d]">MMK</span></span></div></div>
          </section>

          <section id="reports" className="scroll-mt-24"><div className="mb-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h3 className="m-0 text-[13px] font-semibold">Transaction register</h3><p className="mb-0 mt-1 text-[10px] text-[#8b968d]">Search the ledger by date and export a statement</p></div><div className="flex flex-wrap items-center gap-2"><label className="flex h-8 items-center gap-1.5 rounded-[7px] border border-[#e1e6e0] bg-white px-2"><span className="text-[9px] text-[#87928a]">From</span><input aria-label="Start date" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="w-[112px] bg-transparent text-[9px] text-[#46544b] outline-none" /></label><label className="flex h-8 items-center gap-1.5 rounded-[7px] border border-[#e1e6e0] bg-white px-2"><span className="text-[9px] text-[#87928a]">To</span><input aria-label="End date" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="w-[112px] bg-transparent text-[9px] text-[#46544b] outline-none" /></label></div></div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[#e5e9e4] bg-white px-3 py-2.5"><div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[9px] text-[#78847c]"><span className="flex items-center gap-1.5"><Search size={12} />{filteredTransactions.length} entries</span><span>Inflow <b className="number-font text-[#4c7540]">{formatMMK(rangeInflow)} MMK</b></span><span>Outflow <b className="number-font text-[#ad6749]">{formatMMK(rangeOutflow)} MMK</b></span></div><div className="flex items-center gap-1.5"><button onClick={exportExcel} title="Export Excel" aria-label="Export Excel" className="grid size-7 place-items-center rounded-[6px] text-[#568447] transition hover:bg-[#eef5e7]"><FileSpreadsheet size={15} /></button><button onClick={exportPdf} title="Export PDF summary" aria-label="Export PDF summary" className="grid size-7 place-items-center rounded-[6px] text-[#62809a] transition hover:bg-[#edf4f8]"><FileText size={15} /></button><button onClick={printThermalSlip} title="Print 80 mm slip" aria-label="Print 80 mm slip" className="grid size-7 place-items-center rounded-[6px] text-[#a36e48] transition hover:bg-[#fbf0e7]"><Printer size={15} /></button></div></div>
            <div className="table-scroll rounded-[10px] border border-[#e4e8e3] bg-white"><table className="w-full min-w-[820px] border-collapse text-left"><thead><tr className="border-b border-[#edf0ec] bg-[#fafbf9] text-[9px] font-semibold uppercase tracking-[1px] text-[#929d95]"><th className="px-4 py-3 font-semibold">Time</th><th className="px-4 py-3 font-semibold">Type</th><th className="px-4 py-3 font-semibold">Customer</th><th className="px-4 py-3 font-semibold">Account movement</th><th className="px-4 py-3 text-right font-semibold">Amount</th><th className="px-4 py-3 text-right font-semibold">Fee</th><th className="w-10 px-3 py-3" /></tr></thead><tbody>{filteredTransactions.map((transaction) => { const Icon = kindIcons[transaction.kind]; return <tr key={transaction.id} className="border-b border-[#f0f2ef] last:border-0 hover:bg-[#fbfcfa]"><td className="px-4 py-3 text-[10px] text-[#77837a]">{transaction.time}<span className="mt-0.5 block text-[8px] text-[#a0aaa3]">{transaction.date}</span></td><td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[9px] font-medium ${kindColors[transaction.kind]}`}><Icon size={11} />{kindLabel(transaction.kind)}</span></td><td className="px-4 py-3"><span className="block max-w-[145px] truncate text-[10px] font-medium text-[#37463d]">{transaction.customer || "Walk-in customer"}</span>{transaction.phone && <span className="mt-0.5 block text-[9px] text-[#9ba59d]">{transaction.phone}</span>}{transaction.note && <span className="mt-0.5 block max-w-[145px] truncate text-[8px] text-[#9ba59d]">{transaction.note}</span>}</td><td className="px-4 py-3 text-[9px] text-[#768279]">{transactionParty(transaction)}</td><td className="number-font px-4 py-3 text-right text-[10px] font-semibold text-[#35443a]">{formatMMK(transaction.amount)} <span className="text-[8px] font-normal text-[#a0aaa3]">MMK</span></td><td className="number-font px-4 py-3 text-right text-[10px] text-[#66736a]">{transaction.commission ? formatMMK(transaction.commission) : "—"}</td><td className="px-3 py-3 text-right">{transaction.date === today && !isClosed && <button onClick={() => removeTransaction(transaction.id)} aria-label={`Remove ${kindLabel(transaction.kind)} transaction`} title="Remove transaction" className="grid size-6 place-items-center rounded-[5px] text-[#a1aba3] hover:bg-[#fff0e9] hover:text-[#b75c3d]"><X size={13} /></button>}</td></tr>; })}</tbody></table>
              {filteredTransactions.length === 0 && <div className="flex min-h-[126px] flex-col items-center justify-center px-4 text-center"><span className="grid size-8 place-items-center rounded-[8px] bg-[#f1f4ef] text-[#8a998c]"><ReceiptText size={15} /></span><p className="mb-0 mt-2 text-[10px] font-medium text-[#68756c]">No transactions in this date range</p><p className="mb-0 mt-1 text-[9px] text-[#9aa49c]">Entries will appear here as you record them.</p></div>}</div>
          </section>
          <footer className="mt-8 flex flex-col justify-between gap-2 border-t border-[#e3e8e2] pt-4 text-[9px] text-[#97a199] sm:flex-row"><span>Ledger · Daily cash operations</span><span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[#a5cf73]" />Local device storage active</span></footer>
        </div>
      </main>

      {modal && <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#10231c]/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><div role="dialog" aria-modal="true" aria-labelledby="session-dialog-title" className="fade-up w-full max-w-[420px] rounded-t-[12px] border border-[#e4e8e3] bg-white p-5 shadow-[0_18px_70px_rgba(12,35,23,0.2)] sm:rounded-[12px] sm:p-6">
        <div className="mb-4 flex items-start justify-between"><div><p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[1.6px] text-[#8b968d]">{formatDate(today, { weekday: "short", month: "short", day: "numeric" })}</p><h2 id="session-dialog-title" className="m-0 text-[17px] font-semibold tracking-[-0.4px]">{modal === "open" ? "Set opening balance" : "Close today’s session"}</h2></div><button onClick={() => setModal(null)} aria-label="Close dialog" className="grid size-7 place-items-center rounded-[6px] text-[#88938b] hover:bg-[#f2f4f1]"><X size={16} /></button></div>
        {modal === "open" ? <form onSubmit={openSession}><p className="mb-4 text-[11px] leading-5 text-[#7d8980]">Count the physical cash in your drawer before taking today’s first transaction.</p><label className="field-label">Opening cash · MMK<span className="input-wrap mt-1.5"><input required autoFocus min="0" step="1" inputMode="numeric" type="number" placeholder="0" value={openingInput} onChange={(event) => setOpeningInput(event.target.value)} /></span></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setModal(null)} className="h-9 rounded-[7px] border border-[#e3e8e2] px-3.5 text-[10px] font-medium text-[#6d7971]">Cancel</button><button type="submit" className="flex h-9 items-center gap-1.5 rounded-[7px] bg-[#173c31] px-4 text-[10px] font-semibold text-white hover:bg-[#245745]"><Check size={13} />Open session</button></div></form> : <form onSubmit={closeSession}><div className="mb-4 rounded-[8px] bg-[#f4f7f1] p-3.5"><div className="flex justify-between text-[10px] text-[#738078]"><span>System closing</span><span className="number-font font-semibold text-[#35463a]">{formatMMK(systemClosing)} MMK</span></div><p className="mb-0 mt-1.5 text-[9px] leading-4 text-[#98a198]">Opening + cash-in − cash-out and expenses + commissions</p></div><label className="field-label">Actual cash counted · MMK<span className="input-wrap mt-1.5"><input required autoFocus min="0" step="1" inputMode="numeric" type="number" placeholder="0" value={closingInput} onChange={(event) => setClosingInput(event.target.value)} /></span></label>{closingInput !== "" && Number.isFinite(Number(closingInput)) && <div className={`mt-3 flex items-center justify-between rounded-[7px] px-3 py-2.5 text-[10px] ${Number(closingInput) === systemClosing ? "bg-[#eaf5df] text-[#4f7937]" : "bg-[#fff0e9] text-[#ae5c3e]"}`}><span className="flex items-center gap-1.5 font-semibold">{Number(closingInput) === systemClosing ? <CircleCheck size={13} /> : <CircleAlert size={13} />}{Number(closingInput) === systemClosing ? "Balanced" : "Difference from system"}</span><span className="number-font font-semibold">{Number(closingInput) - systemClosing >= 0 ? "+" : "−"}{formatMMK(Math.abs(Number(closingInput) - systemClosing))} MMK</span></div>}<div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setModal(null)} className="h-9 rounded-[7px] border border-[#e3e8e2] px-3.5 text-[10px] font-medium text-[#6d7971]">Cancel</button><button type="submit" className="flex h-9 items-center gap-1.5 rounded-[7px] bg-[#173c31] px-4 text-[10px] font-semibold text-white hover:bg-[#245745]"><Check size={13} />Close day</button></div></form>}
      </div></div>}
    </div>
  );
}

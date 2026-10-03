import type { User } from "@supabase/supabase-js";
import {
  normalizeLedger,
  type LedgerData,
  type LedgerTransaction,
} from "@/lib/ledger";
import { supabase } from "@/lib/supabase";

export type CustomerDirectoryEntry = {
  id: string;
  name: string;
  phone: string;
  lastUsed: string;
  is_favorite: boolean;
};

type LedgerSnapshot = {
  ledger: LedgerData;
  customers: CustomerDirectoryEntry[];
};

type StoredCustomer = {
  id: string;
  data: unknown;
  is_favorite?: boolean | null;
};

export type CustomerAnalyticsTransaction = Pick<
  LedgerTransaction,
  "customer" | "phone" | "kind" | "amount" | "commission" | "date"
>;

function throwOnError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

function storageId(userId: string, recordId: string) {
  return `${userId}:${recordId}`;
}

function dataRecordId(data: unknown, table: "wallets" | "sessions"): string {
  if (data && typeof data === "object") {
    const id = table === "sessions" && "date" in data ? data.date : "id" in data ? data.id : undefined;
    if (typeof id === "string") return id;
  }
  throw new Error(`Supabase returned a ${table} record without its application ID.`);
}

function isMissingSchemaColumn(error: { code?: string } | null): boolean {
  return error?.code === "42703";
}

function parseCustomer(
  data: unknown,
  favoriteColumn?: boolean | null,
): CustomerDirectoryEntry | null {
  if (
    data === null ||
    typeof data !== "object" ||
    !("id" in data) ||
    typeof data.id !== "string" ||
    !("name" in data) ||
    typeof data.name !== "string" ||
    !("phone" in data) ||
    typeof data.phone !== "string" ||
    !("lastUsed" in data) ||
    typeof data.lastUsed !== "string"
  ) {
    return null;
  }

  return {
    id: data.id,
    name: data.name,
    phone: data.phone,
    lastUsed: data.lastUsed,
    is_favorite:
      favoriteColumn ?? ("is_favorite" in data && data.is_favorite === true),
  };
}

function parseAnalyticsTransaction(
  value: unknown,
): CustomerAnalyticsTransaction | null {
  if (
    value === null ||
    typeof value !== "object" ||
    !("date" in value) ||
    typeof value.date !== "string" ||
    !("kind" in value) ||
    (value.kind !== "CASH_IN" &&
      value.kind !== "CASH_OUT" &&
      value.kind !== "TRANSFER" &&
      value.kind !== "EXPENSE") ||
    !("amount" in value) ||
    !("commission" in value)
  ) {
    return null;
  }
  return {
    date: value.date,
    customer:
      "customer" in value && typeof value.customer === "string"
        ? value.customer
        : "",
    phone:
      "phone" in value && typeof value.phone === "string" ? value.phone : "",
    kind: value.kind,
    amount: Number(value.amount) || 0,
    commission: Number(value.commission) || 0,
  };
}

export async function loadCustomerAnalyticsTransactions(
  user: User,
  startDate?: string,
  endDate?: string,
): Promise<CustomerAnalyticsTransaction[]> {
  let query = supabase
    .from("transactions")
    .select(
      "customer_name, phone_number, kind, amount, commission, transaction_date",
    )
    .eq("user_id", user.id);
  if (startDate) query = query.gte("transaction_date", startDate);
  if (endDate) query = query.lte("transaction_date", endDate);
  const result = await query;

  if (isMissingSchemaColumn(result.error)) {
    const fallback = await supabase
      .from("transactions")
      .select("data")
      .eq("user_id", user.id);
    throwOnError(fallback.error);
    return (fallback.data ?? [])
      .map((record) => parseAnalyticsTransaction(record.data))
      .filter(
        (transaction): transaction is CustomerAnalyticsTransaction =>
          transaction !== null &&
          (!startDate || transaction.date >= startDate) &&
          (!endDate || transaction.date <= endDate),
      );
  }
  throwOnError(result.error);
  return (result.data ?? []).map((row) => ({
    date: row.transaction_date,
    customer: row.customer_name,
    phone: row.phone_number,
    kind: row.kind as LedgerTransaction["kind"],
    amount: Number(row.amount) || 0,
    commission: Number(row.commission) || 0,
  }));
}

export async function loadLedgerSnapshot(
  user: User,
): Promise<LedgerSnapshot> {
  const [wallets, sessions, transactions] = await Promise.all([
    supabase.from("wallets").select("id, data").eq("user_id", user.id),
    supabase.from("sessions").select("id, data").eq("user_id", user.id),
    supabase
      .from("transactions")
      .select("id, data, session_id, created_at")
      .eq("user_id", user.id),
  ]);

  throwOnError(wallets.error);
  throwOnError(sessions.error);
  throwOnError(transactions.error);

  const customersWithFavorite = await supabase
    .from("customers")
    .select("id, data, is_favorite")
    .eq("user_id", user.id);
  let customerRows: StoredCustomer[];
  if (isMissingSchemaColumn(customersWithFavorite.error)) {
    const customersWithoutFavorite = await supabase
      .from("customers")
      .select("id, data")
      .eq("user_id", user.id);
    throwOnError(customersWithoutFavorite.error);
    customerRows = (customersWithoutFavorite.data ?? []) as StoredCustomer[];
  } else {
    throwOnError(customersWithFavorite.error);
    customerRows = (customersWithFavorite.data ?? []) as StoredCustomer[];
  }

  const savedLedger = normalizeLedger({
    accounts: (wallets.data ?? []).map((record) => record.data),
    sessions: (sessions.data ?? []).map((record) => record.data),
    transactions: (transactions.data ?? []).map((record) => record.data),
  });
  const transactionRows = transactions.data ?? [];
  savedLedger.transactions = savedLedger.transactions.map((transaction) => {
    const stored = transactionRows.find((row) => row.id === transaction.id);
    const data =
      stored?.data && typeof stored.data === "object"
        ? (stored.data as Partial<LedgerTransaction>)
        : {};
    return {
      ...transaction,
      user_id: user.id,
      session_id: stored?.session_id ?? data.session_id ?? transaction.date,
      created_at: stored?.created_at ?? data.created_at,
    };
  });
  const customerDirectory = customerRows
    .map((record) =>
      parseCustomer(
        record.data,
        "is_favorite" in record ? record.is_favorite : undefined,
      ),
    )
    .filter((customer): customer is CustomerDirectoryEntry => customer !== null);

  return { ledger: savedLedger, customers: customerDirectory };
}

type LedgerTable = "wallets" | "sessions" | "transactions" | "customers";

type DataRow = {
  id: string;
  data: unknown;
  session_id?: string | null;
  created_at?: string;
  is_favorite?: boolean | null;
};

type DataEntry = {
  id: string;
  data: unknown;
};

function applicationRecordId(table: LedgerTable, data: unknown): string {
  if (table === "customers") {
    const customer = parseCustomer(data);
    if (customer) return customer.id;
  } else if (table === "sessions" || table === "wallets") {
    return dataRecordId(data, table);
  } else if (data && typeof data === "object" && "id" in data) {
    const id = data.id;
    if (typeof id === "string") return id;
  }
  throw new Error(`Supabase returned a ${table} record without a valid ID.`);
}

async function loadRowsForMutation(
  table: LedgerTable,
  userId: string,
): Promise<{ rows: DataRow[]; hasFavoriteColumn: boolean }> {
  if (table === "customers") {
    const withFavorite = await supabase
      .from(table)
      .select("id, data, is_favorite")
      .eq("user_id", userId);
    if (!isMissingSchemaColumn(withFavorite.error)) {
      throwOnError(withFavorite.error);
      return {
        rows: (withFavorite.data ?? []) as DataRow[],
        hasFavoriteColumn: true,
      };
    }
    const withoutFavorite = await supabase
      .from(table)
      .select("id, data")
      .eq("user_id", userId);
    throwOnError(withoutFavorite.error);
    return {
      rows: (withoutFavorite.data ?? []) as DataRow[],
      hasFavoriteColumn: false,
    };
  }

  if (table === "transactions") {
    const withMetadata = await supabase
      .from(table)
      .select("id, data, session_id, created_at")
      .eq("user_id", userId);
    if (!isMissingSchemaColumn(withMetadata.error)) {
      throwOnError(withMetadata.error);
      return {
        rows: (withMetadata.data ?? []) as DataRow[],
        hasFavoriteColumn: false,
      };
    }
  }

  const result = await supabase
    .from(table)
    .select("id, data")
    .eq("user_id", userId);
  throwOnError(result.error);
  return {
    rows: (result.data ?? []) as DataRow[],
    hasFavoriteColumn: false,
  };
}

async function applyTableChanges(
  table: LedgerTable,
  userId: string,
  before: DataEntry[],
  after: DataEntry[],
): Promise<void> {
  const beforeById = new Map(before.map((entry) => [entry.id, entry]));
  const afterById = new Map(after.map((entry) => [entry.id, entry]));
  const changedIds = new Set<string>();
  for (const id of new Set([...beforeById.keys(), ...afterById.keys()])) {
    const oldEntry = beforeById.get(id);
    const newEntry = afterById.get(id);
    if (
      !oldEntry ||
      !newEntry ||
      JSON.stringify(oldEntry.data) !== JSON.stringify(newEntry.data)
    ) {
      changedIds.add(id);
    }
  }
  if (!changedIds.size) return;

  const { rows, hasFavoriteColumn } = await loadRowsForMutation(table, userId);
  const remoteById = new Map(
    rows.map((row) => [applicationRecordId(table, row.data), row]),
  );

  for (const id of changedIds) {
    const oldEntry = beforeById.get(id);
    const newEntry = afterById.get(id);
    const existing = remoteById.get(id);
    if (!newEntry) {
      if (!existing) continue;
      const result = await supabase
        .from(table)
        .delete()
        .eq("user_id", userId)
        .eq("id", existing.id)
        .select("id")
        .maybeSingle();
      throwOnError(result.error);
      if (!result.data) {
        throw new Error(`Supabase did not delete ${table} record ${id}.`);
      }
      continue;
    }

    const databaseId = existing?.id ?? storageId(userId, id);
    const values: Record<string, unknown> = {
      user_id: userId,
      id: databaseId,
      data: newEntry.data,
    };
    if (table === "customers" && hasFavoriteColumn) {
      const customer = newEntry.data as CustomerDirectoryEntry;
      values.is_favorite = customer.is_favorite;
    }
    if (table === "transactions") {
      const transaction = newEntry.data as LedgerTransaction;
      values.session_id = transaction.session_id ?? transaction.date ?? null;
      values.created_at =
        transaction.created_at ?? new Date().toISOString();
    }

    if (existing) {
      const result = await supabase
        .from(table)
        .update(values)
        .eq("user_id", userId)
        .eq("id", existing.id)
        .select("id")
        .maybeSingle();
      throwOnError(result.error);
      if (!result.data) {
        throw new Error(`Supabase did not update ${table} record ${id}.`);
      }
    } else {
      const result = await supabase.from(table).insert(values).select("id").single();
      throwOnError(result.error);
      if (!result.data) {
        throw new Error(`Supabase did not insert ${table} record ${id}.`);
      }
    }
    void oldEntry;
  }
}

export async function commitLedgerChanges(
  user: User,
  beforeLedger: LedgerData,
  nextLedger: LedgerData,
  beforeCustomers: CustomerDirectoryEntry[],
  nextCustomers: CustomerDirectoryEntry[],
) {
  const {
    data: { user: authenticatedUser },
    error: authError,
  } = await supabase.auth.getUser();
  throwOnError(authError);
  if (!authenticatedUser || authenticatedUser.id !== user.id) {
    throw new Error("The active Supabase user changed before ledger sync.");
  }

  await applyTableChanges(
    "wallets",
    user.id,
    beforeLedger.accounts.map((account) => ({ id: account.id, data: account })),
    nextLedger.accounts.map((account) => ({ id: account.id, data: account })),
  );
  await applyTableChanges(
    "sessions",
    user.id,
    beforeLedger.sessions.map((session) => ({
      id: session.date,
      data: session,
    })),
    nextLedger.sessions.map((session) => ({ id: session.date, data: session })),
  );
  await applyTableChanges(
    "customers",
    user.id,
    beforeCustomers.map((customer) => ({ id: customer.id, data: customer })),
    nextCustomers.map((customer) => ({ id: customer.id, data: customer })),
  );
  await applyTableChanges(
    "transactions",
    user.id,
    beforeLedger.transactions.map((transaction) => ({
      id: transaction.id,
      data: transaction,
    })),
    nextLedger.transactions.map((transaction) => ({
      id: transaction.id,
      data: transaction,
    })),
  );
}

async function findCustomerRow(user: User, customerId: string) {
  const {
    data: { user: authenticatedUser },
    error: authError,
  } = await supabase.auth.getUser();
  throwOnError(authError);
  if (!authenticatedUser || authenticatedUser.id !== user.id) {
    throw new Error("The active Supabase user changed before customer update.");
  }

  const withFavorite = await supabase
    .from("customers")
    .select("id, data, is_favorite")
    .eq("user_id", user.id);
  let rows: DataRow[];
  let hasFavoriteColumn = true;
  if (isMissingSchemaColumn(withFavorite.error)) {
    const withoutFavorite = await supabase
      .from("customers")
      .select("id, data")
      .eq("user_id", user.id);
    throwOnError(withoutFavorite.error);
    rows = (withoutFavorite.data ?? []) as DataRow[];
    hasFavoriteColumn = false;
  } else {
    throwOnError(withFavorite.error);
    rows = (withFavorite.data ?? []) as DataRow[];
  }

  const matches = rows.filter(
    (row) => parseCustomer(row.data)?.id === customerId,
  );
  const row =
    matches.find((candidate) => candidate.id === storageId(user.id, customerId)) ??
    matches[0];
  if (!row) {
    throw new Error(`Customer ${customerId} was not found in Supabase.`);
  }
  const customer = parseCustomer(
    row.data,
    "is_favorite" in row ? row.is_favorite : undefined,
  );
  if (!customer) {
    throw new Error(`Supabase returned an invalid customer record ${customerId}.`);
  }
  return { row, customer, hasFavoriteColumn };
}

export async function updateCustomerRecord(
  user: User,
  customer: CustomerDirectoryEntry,
): Promise<void> {
  const { row, hasFavoriteColumn } = await findCustomerRow(user, customer.id);
  const values: Record<string, unknown> = { data: customer };
  if (hasFavoriteColumn) values.is_favorite = customer.is_favorite;
  const result = await supabase
    .from("customers")
    .update(values)
    .eq("user_id", user.id)
    .eq("id", row.id)
    .select("id")
    .maybeSingle();
  throwOnError(result.error);
  if (!result.data) {
    throw new Error(`Supabase did not update customer ${customer.id}.`);
  }
}

export async function deleteCustomerRecord(
  user: User,
  customerId: string,
): Promise<void> {
  const { row } = await findCustomerRow(user, customerId);
  const result = await supabase
    .from("customers")
    .delete()
    .eq("user_id", user.id)
    .eq("id", row.id)
    .select("id")
    .maybeSingle();
  throwOnError(result.error);
  if (!result.data) {
    throw new Error(`Supabase did not delete customer ${customerId}.`);
  }
}

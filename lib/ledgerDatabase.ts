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

type StoredRecord = {
  id: string;
  data: unknown;
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

function throwOnSyncError(
  table: "wallets" | "sessions" | "transactions" | "customers",
  operation: "upsert" | "delete",
  error: { message: string } | null,
  payload: unknown,
) {
  if (!error) return;
  console.error(`[Supabase sync] ${table} ${operation} failed.`, {
    error,
    payload,
  });
  throw new Error(`${table} ${operation} failed: ${error.message}`);
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

async function synchronizeTable(
  table: "wallets" | "sessions",
  userId: string,
  records: StoredRecord[],
) {
  const { data, error } = await supabase
    .from(table)
    .select("id, data")
    .eq("user_id", userId);
  throwOnError(error);

  const existingRecords = (data ?? []) as StoredRecord[];
  const existingById = new Map(
    existingRecords.map((record) => [
      dataRecordId(record.data, table),
      record,
    ]),
  );
  const desiredById = new Map(records.map((record) => [record.id, record]));
  const upserts: Array<{ id: string; user_id: string; data: unknown }> = [];
  for (const record of desiredById.values()) {
    const existing = existingById.get(record.id);
    if (!existing) {
      upserts.push({
        ...record,
        id: storageId(userId, record.id),
        user_id: userId,
      });
    } else if (JSON.stringify(existing.data) !== JSON.stringify(record.data)) {
      upserts.push({
        ...record,
        id: storageId(userId, record.id),
        user_id: userId,
      });
    }
  }

  if (upserts.length) {
    const result = await supabase
      .from(table)
      .upsert(upserts, { onConflict: "id" });
    throwOnSyncError(table, "upsert", result.error, upserts);
  }

  const removedIds = existingRecords
    .filter(
      (record) => !desiredById.has(dataRecordId(record.data, table)),
    )
    .map((record) => record.id);
  if (removedIds.length) {
    const result = await supabase
      .from(table)
      .delete()
      .eq("user_id", userId)
      .in("id", removedIds);
    throwOnSyncError(table, "delete", result.error, removedIds);
  }
}

async function synchronizeTransactions(
  userId: string,
  ledger: LedgerData,
) {
  const { data, error } = await supabase
    .from("transactions")
    .select("id, data, session_id, created_at")
    .eq("user_id", userId);
  throwOnError(error);

  const existingRecords = data ?? [];
  const existingById = new Map(
    existingRecords.map((record) => {
      const data =
        record.data && typeof record.data === "object"
          ? (record.data as Partial<LedgerTransaction>)
          : {};
      return [data.id ?? record.id, record] as const;
    }),
  );
  const desiredById = new Map(
    ledger.transactions.map((transaction) => [
      transaction.id,
      {
        ...transaction,
        user_id: userId,
        session_id: transaction.session_id ?? transaction.date,
        created_at:
          transaction.created_at ?? `${transaction.date}T00:00:00.000Z`,
      },
    ]),
  );
  const upserts: Array<{
    id: string;
    user_id: string;
    session_id: string | null;
    created_at: string;
    data: LedgerTransaction;
  }> = [];
  for (const transaction of desiredById.values()) {
    const existing = existingById.get(transaction.id);
    const dataIsCurrent =
      existing && JSON.stringify(existing.data) === JSON.stringify(transaction);
    const metadataIsCurrent =
      existing?.session_id === transaction.session_id &&
      existing?.created_at === transaction.created_at;
    if (!dataIsCurrent || !metadataIsCurrent) {
      upserts.push({
        id: storageId(userId, transaction.id),
        user_id: userId,
        session_id: transaction.session_id ?? null,
        created_at: transaction.created_at ?? new Date().toISOString(),
        data: transaction,
      });
    }
  }

  if (upserts.length) {
    const result = await supabase
      .from("transactions")
      .upsert(upserts, { onConflict: "id" })
      .select("id");
    throwOnSyncError("transactions", "upsert", result.error, upserts);
    const confirmedIds = new Set((result.data ?? []).map((row) => row.id));
    const unconfirmedIds = upserts
      .filter((record) => !confirmedIds.has(record.id))
      .map((record) => record.id);
    if (unconfirmedIds.length) {
      throw new Error(
        `Supabase did not confirm transaction writes: ${unconfirmedIds.join(", ")}`,
      );
    }
  }

  const removedIds = existingRecords
    .filter((record) => {
      const data =
        record.data && typeof record.data === "object"
          ? (record.data as Partial<LedgerTransaction>)
          : {};
      return !desiredById.has(data.id ?? record.id);
    })
    .map((record) => record.id);
  if (removedIds.length) {
    const result = await supabase
      .from("transactions")
      .delete()
      .eq("user_id", userId)
      .in("id", removedIds)
      .select("id");
    throwOnSyncError("transactions", "delete", result.error, removedIds);
    const deletedIds = new Set((result.data ?? []).map((row) => row.id));
    const unconfirmedIds = removedIds.filter((id) => !deletedIds.has(id));
    if (unconfirmedIds.length) {
      throw new Error(
        `Supabase did not confirm transaction deletions: ${unconfirmedIds.join(", ")}`,
      );
    }
  }
}

async function synchronizeCustomers(
  userId: string,
  customers: CustomerDirectoryEntry[],
) {
  const existingWithFavorite = await supabase
    .from("customers")
    .select("id, data, is_favorite")
    .eq("user_id", userId);
  const hasFavoriteColumn = !isMissingSchemaColumn(
    existingWithFavorite.error,
  );
  let existingRows: StoredCustomer[];
  if (!hasFavoriteColumn) {
    const existingWithoutFavorite = await supabase
      .from("customers")
      .select("id, data")
      .eq("user_id", userId);
    throwOnError(existingWithoutFavorite.error);
    existingRows = (existingWithoutFavorite.data ?? []) as StoredCustomer[];
  } else {
    throwOnError(existingWithFavorite.error);
    existingRows = (existingWithFavorite.data ?? []) as StoredCustomer[];
  }

  const existingRecords = existingRows;
  const existingById = new Map(
    existingRecords.map((record) => {
      const customer = parseCustomer(record.data);
      if (!customer) {
        throw new Error("Supabase returned a customer without a valid record ID.");
      }
      return [customer.id, record] as const;
    }),
  );
  const desiredById = new Map(customers.map((customer) => [customer.id, customer]));
  const upserts: Array<{
    id: string;
    user_id: string;
    data: CustomerDirectoryEntry;
    is_favorite?: boolean;
  }> = [];

  for (const customer of desiredById.values()) {
    const stored = { ...customer };
    const current = existingById.get(customer.id);
    if (!current) {
      upserts.push({
        id: storageId(userId, customer.id),
        user_id: userId,
        data: stored,
        ...(hasFavoriteColumn ? { is_favorite: customer.is_favorite } : {}),
      });
    } else {
      const columnDiffers =
        hasFavoriteColumn && current.is_favorite !== customer.is_favorite;
      if (
        JSON.stringify(current.data) !== JSON.stringify(stored) ||
        columnDiffers
      ) {
        upserts.push({
          id: storageId(userId, customer.id),
          user_id: userId,
          data: stored,
          ...(hasFavoriteColumn
            ? { is_favorite: customer.is_favorite }
            : {}),
        });
      }
    }
  }

  if (upserts.length) {
    const result = await supabase
      .from("customers")
      .upsert(upserts, { onConflict: "id" });
    throwOnSyncError("customers", "upsert", result.error, upserts);
  }

  const removedIds = existingRecords
    .filter((record) => {
      const customer = parseCustomer(record.data);
      return !customer || !desiredById.has(customer.id);
    })
    .map((record) => record.id);
  if (removedIds.length) {
    const result = await supabase
      .from("customers")
      .delete()
      .eq("user_id", userId)
      .in("id", removedIds);
    throwOnSyncError("customers", "delete", result.error, removedIds);
  }
}

export async function saveLedgerSnapshot(
  user: User,
  ledger: LedgerData,
  customers: CustomerDirectoryEntry[],
) {
  const {
    data: { user: authenticatedUser },
    error: authError,
  } = await supabase.auth.getUser();
  throwOnError(authError);
  if (!authenticatedUser || authenticatedUser.id !== user.id) {
    throw new Error("The active Supabase user changed before ledger sync.");
  }

  await Promise.all([
    synchronizeTable(
      "wallets",
      user.id,
      ledger.accounts.map((account) => ({ id: account.id, data: account })),
    ),
    synchronizeTable(
      "sessions",
      user.id,
      ledger.sessions.map((session) => ({
        id: session.date,
        data: session,
      })),
    ),
    synchronizeTransactions(user.id, ledger),
    synchronizeCustomers(user.id, customers),
  ]);
}

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
    supabase.from("transactions").select("id, data").eq("user_id", user.id),
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
  table: "wallets" | "sessions" | "transactions" | "customers",
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
    existingRecords.map((record) => [record.id, record]),
  );
  const desiredById = new Map(records.map((record) => [record.id, record]));

  const inserts: Array<{ id: string; user_id: string; data: unknown }> = [];
  for (const record of records) {
    const existing = existingById.get(record.id);
    if (!existing) {
      inserts.push({ ...record, user_id: userId });
    } else if (JSON.stringify(existing.data) !== JSON.stringify(record.data)) {
      const result = await supabase
        .from(table)
        .update({ data: record.data })
        .eq("user_id", userId)
        .eq("id", record.id);
      throwOnError(result.error);
    }
  }

  if (inserts.length) {
    const result = await supabase.from(table).insert(inserts);
    throwOnError(result.error);
  }

  const removedIds = existingRecords
    .filter((record) => !desiredById.has(record.id))
    .map((record) => record.id);
  if (removedIds.length) {
    const result = await supabase
      .from(table)
      .delete()
      .eq("user_id", userId)
      .in("id", removedIds);
    throwOnError(result.error);
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
    existingRecords.map((record) => [record.id, record]),
  );
  const desiredById = new Map(customers.map((customer) => [customer.id, customer]));

  for (const customer of customers) {
    const stored = { ...customer };
    const current = existingById.get(customer.id);
    if (!current) {
      const row = {
        id: customer.id,
        user_id: userId,
        data: stored,
        ...(hasFavoriteColumn ? { is_favorite: customer.is_favorite } : {}),
      };
      const result = await supabase.from("customers").insert(row);
      throwOnError(result.error);
    } else {
      const columnDiffers =
        hasFavoriteColumn && current.is_favorite !== customer.is_favorite;
      if (
        JSON.stringify(current.data) !== JSON.stringify(stored) ||
        columnDiffers
      ) {
        const result = await supabase
          .from("customers")
          .update({
            data: stored,
            ...(hasFavoriteColumn
              ? { is_favorite: customer.is_favorite }
              : {}),
          })
          .eq("user_id", userId)
          .eq("id", customer.id);
        throwOnError(result.error);
      }
    }
  }

  const removedIds = existingRecords
    .filter((record) => !desiredById.has(record.id))
    .map((record) => record.id);
  if (removedIds.length) {
    const result = await supabase
      .from("customers")
      .delete()
      .eq("user_id", userId)
      .in("id", removedIds);
    throwOnError(result.error);
  }
}

export async function saveLedgerSnapshot(
  user: User,
  ledger: LedgerData,
  customers: CustomerDirectoryEntry[],
) {
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
    synchronizeTable(
      "transactions",
      user.id,
      ledger.transactions.map((transaction) => ({
        id: transaction.id,
        data: transaction,
      })),
    ),
    synchronizeCustomers(user.id, customers),
  ]);
}

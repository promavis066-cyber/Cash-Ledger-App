import type { User } from "@supabase/supabase-js";
import {
  normalizeLedger,
  type LedgerData,
} from "@/lib/ledger";
import { supabase } from "@/lib/supabase";

export type CustomerDirectoryEntry = {
  id: string;
  name: string;
  phone: string;
  lastUsed: string;
};

type StoredRecord = {
  id: string;
  data: unknown;
};

type LedgerSnapshot = {
  ledger: LedgerData;
  customers: CustomerDirectoryEntry[];
};

function throwOnError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadLedgerSnapshot(
  user: User,
): Promise<LedgerSnapshot> {
  const [wallets, sessions, transactions, customers] = await Promise.all([
    supabase.from("wallets").select("id, data").eq("user_id", user.id),
    supabase.from("sessions").select("id, data").eq("user_id", user.id),
    supabase.from("transactions").select("id, data").eq("user_id", user.id),
    supabase.from("customers").select("id, data").eq("user_id", user.id),
  ]);

  throwOnError(wallets.error);
  throwOnError(sessions.error);
  throwOnError(transactions.error);
  throwOnError(customers.error);

  const savedLedger = normalizeLedger({
    accounts: (wallets.data ?? []).map((record) => record.data),
    sessions: (sessions.data ?? []).map((record) => record.data),
    transactions: (transactions.data ?? []).map((record) => record.data),
  });
  const customerDirectory = (customers.data ?? [])
    .map((record) => record.data)
    .filter(
      (customer): customer is CustomerDirectoryEntry =>
        customer !== null &&
        typeof customer === "object" &&
        "id" in customer &&
        typeof customer.id === "string" &&
        "name" in customer &&
        typeof customer.name === "string" &&
        "phone" in customer &&
        typeof customer.phone === "string" &&
        "lastUsed" in customer &&
        typeof customer.lastUsed === "string",
    );

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
    synchronizeTable(
      "customers",
      user.id,
      customers.map((customer) => ({ id: customer.id, data: customer })),
    ),
  ]);
}

create table if not exists public.wallets (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  primary key (user_id, id)
);

create table if not exists public.sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  primary key (user_id, id)
);

create table if not exists public.transactions (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  primary key (user_id, id)
);

create table if not exists public.customers (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  primary key (user_id, id)
);

alter table public.transactions
  add column if not exists session_id text,
  add column if not exists created_at timestamptz not null default now();

do $$
declare
  table_name text;
  primary_key_name text;
begin
  foreach table_name in array array[
    'wallets',
    'sessions',
    'transactions',
    'customers'
  ]
  loop
    execute format(
      'update public.%I set id = user_id::text || '':'' || id where id not like user_id::text || '':%%''',
      table_name
    );

    select constraint_row.conname
    into primary_key_name
    from pg_constraint as constraint_row
    where constraint_row.conrelid = to_regclass('public.' || table_name)
      and constraint_row.contype = 'p';

    if primary_key_name is not null then
      execute format(
        'alter table public.%I drop constraint %I',
        table_name,
        primary_key_name
      );
    end if;
    execute format(
      'alter table public.%I add constraint %I primary key (id)',
      table_name,
      table_name || '_pkey'
    );
    primary_key_name := null;
  end loop;
end $$;

alter table public.wallets enable row level security;
alter table public.sessions enable row level security;
alter table public.transactions enable row level security;
alter table public.customers enable row level security;

alter table public.customers
  add column if not exists is_favorite boolean not null default false;

alter table public.customers
  alter column is_favorite set default false;

update public.customers
set is_favorite = (data->>'is_favorite') = 'true'
where data ? 'is_favorite';

alter table public.transactions
  add column if not exists customer_name text
    generated always as (coalesce(data->>'customer', '')) stored,
  add column if not exists phone_number text
    generated always as (coalesce(data->>'phone', '')) stored,
  add column if not exists transaction_date text
    generated always as (coalesce(data->>'date', '')) stored;

create index if not exists transactions_customer_date_idx
  on public.transactions (user_id, transaction_date, customer_name, phone_number);

grant select, insert, update, delete
  on public.wallets, public.sessions, public.transactions, public.customers
  to authenticated;

drop policy if exists "Users can access their own wallets" on public.wallets;
create policy "Users can access their own wallets"
  on public.wallets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can access their own sessions" on public.sessions;
create policy "Users can access their own sessions"
  on public.sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can access their own transactions"
  on public.transactions;
create policy "Users can access their own transactions"
  on public.transactions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can access their own customers" on public.customers;
create policy "Users can access their own customers"
  on public.customers for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

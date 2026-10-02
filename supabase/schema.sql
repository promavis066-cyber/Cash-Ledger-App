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

alter table public.wallets enable row level security;
alter table public.sessions enable row level security;
alter table public.transactions enable row level security;
alter table public.customers enable row level security;

grant select, insert, update, delete
  on public.wallets, public.sessions, public.transactions, public.customers
  to authenticated;

create policy "Users can access their own wallets"
  on public.wallets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can access their own sessions"
  on public.sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can access their own transactions"
  on public.transactions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can access their own customers"
  on public.customers for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =====================================================================
-- Boli · Supabase schema (Postgres 15+, Supabase free tier)
-- Run once in Supabase > SQL Editor (or `supabase db push` / psql).
-- Safe to re-run: objects are created with IF NOT EXISTS / OR REPLACE.
--
-- Security model
--   * Every table has Row Level Security ON.
--   * anon / authenticated can: INSERT into waitlist; SELECT approved
--     listings (public columns only) and the public views. Nothing else.
--   * No one but service_role (edge functions) can write listings,
--     payments, clicks or visits. Emails, GST details and Razorpay ids
--     are never readable by anon.
--   * Every paid payment adds to the listing's All-time total AND to the
--     IST day it was paid on (Today board / Daily archive). payments.board
--     only records which board the bidder was aiming at.
--   * Board/stat views run with the view owner's rights
--     (security_invoker = false) so they can aggregate payments while
--     exposing only public columns. They are read-only.
-- =====================================================================

-- gen_random_uuid() is built into Postgres 13+, no extension needed.

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.ist_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.waitlist (
  id          bigint generated always as identity primary key,
  email       text        not null,
  brand       text,
  created_at  timestamptz not null default now(),
  constraint waitlist_email_format check (char_length(email) <= 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'),
  constraint waitlist_brand_len   check (brand is null or char_length(brand) <= 80)
);
create unique index if not exists waitlist_email_key on public.waitlist (lower(email));

create table if not exists public.listings (
  id               uuid        primary key default gen_random_uuid(),
  name             text        not null check (char_length(name) between 2 and 60),
  url              text        not null check (char_length(url) <= 300 and url ~* '^https?://'),
  category         text        not null check (category in ('Skincare & Beauty','Snacks & Food','Fashion','Health & Fitness','Home','Startups')),
  city             text        not null check (city in ('Mumbai','Delhi NCR','Bengaluru','Hyderabad','Pune','Jaipur','Other')),
  story            text        check (story is null or char_length(story) <= 140),
  offer            text        check (offer is null or char_length(offer) <= 40),
  discount_code    text        check (discount_code is null or discount_code ~ '^[A-Z0-9]{3,20}$'),
  -- founder fields: the name is only stored when the founder consented
  founder_name     text        check (founder_name is null or char_length(founder_name) <= 60),
  founder_consent  boolean     not null default false,
  rivalry_opt_in   boolean     not null default false,
  -- private fields (never granted to anon)
  contact_email    text        not null check (char_length(contact_email) <= 254 and contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'),
  business_details text        not null check (char_length(business_details) between 5 and 200),
  -- money (whole rupees)
  total_paid       integer     not null default 0 check (total_paid >= 0),
  approved         boolean     not null default false,  -- becomes true on first verified payment
  removed          boolean     not null default false,  -- set true by an admin to take a listing down
  created_at       timestamptz not null default now(),
  first_paid_at    timestamptz,
  constraint listings_founder_consent check (founder_consent or founder_name is null)
);
create index if not exists listings_board_idx on public.listings (approved, removed, total_paid desc, first_paid_at);

create table if not exists public.payments (
  id                  uuid        primary key default gen_random_uuid(),
  listing_id          uuid        not null references public.listings(id) on delete restrict,
  board               text        not null check (board in ('all','today')),
  amount              integer     not null check (amount >= 1),          -- rupees actually charged (the difference)
  bid_total           integer     not null check (bid_total >= 199),     -- the board total the bidder asked for
  currency            text        not null default 'INR' check (currency = 'INR'),
  razorpay_order_id   text        not null unique,
  razorpay_payment_id text        unique,
  razorpay_signature  text,
  status              text        not null default 'created' check (status in ('created','paid','failed','refunded')),
  created_at          timestamptz not null default now(),
  paid_at             timestamptz,
  constraint payments_paid_has_time check (status <> 'paid' or (paid_at is not null and razorpay_payment_id is not null))
);
create index if not exists payments_listing_idx on public.payments (listing_id);
create index if not exists payments_paid_idx on public.payments (status, paid_at desc);

create table if not exists public.clicks (
  id            bigint      generated always as identity primary key,
  listing_id    uuid        not null references public.listings(id) on delete cascade,
  visitor_hash  text        not null check (char_length(visitor_hash) = 64),  -- sha256 hex of salted ip+ua
  day           date        not null default public.ist_today(),
  created_at    timestamptz not null default now(),
  constraint clicks_unique_per_day unique (listing_id, visitor_hash, day)
);

create table if not exists public.visits (
  visitor_hash  text        not null check (char_length(visitor_hash) = 64),
  day           date        not null default public.ist_today(),
  created_at    timestamptz not null default now(),
  primary key (visitor_hash, day)
);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.waitlist enable row level security;
alter table public.listings enable row level security;
alter table public.payments enable row level security;
alter table public.clicks   enable row level security;
alter table public.visits   enable row level security;

-- Start from zero: Supabase grants broad table privileges to anon/authenticated by default.
revoke all on public.waitlist, public.listings, public.payments, public.clicks, public.visits from anon, authenticated;
revoke all on sequence public.waitlist_id_seq, public.clicks_id_seq from anon, authenticated;

-- waitlist: anon may insert, never read
grant insert (email, brand) on public.waitlist to anon, authenticated;
drop policy if exists waitlist_insert_anon on public.waitlist;
create policy waitlist_insert_anon on public.waitlist
  for insert to anon, authenticated
  with check (char_length(email) <= 254 and (brand is null or char_length(brand) <= 80));

-- listings: anon may read approved, non-removed rows, public columns only
grant select (id, name, url, category, city, story, offer, discount_code, founder_name, total_paid, created_at, first_paid_at)
  on public.listings to anon, authenticated;
drop policy if exists listings_read_approved on public.listings;
create policy listings_read_approved on public.listings
  for select to anon, authenticated
  using (approved and not removed);

-- payments, clicks, visits: no policies for anon/authenticated => no access at all.
-- service_role bypasses RLS and is only used inside edge functions.

-- ---------------------------------------------------------------------
-- Public views (read-only)
-- ---------------------------------------------------------------------
create or replace view public.board_all_time with (security_invoker = false) as
select
  row_number() over (order by l.total_paid desc, l.first_paid_at asc nulls last, l.created_at asc)::int as rank,
  l.id, l.name, l.url, l.category, l.city,
  case when l.founder_consent then l.founder_name end as founder_name,
  l.story, l.offer, l.discount_code,
  l.total_paid as total,
  coalesce(c.n, 0)::int as clicks,
  l.created_at
from public.listings l
left join (select listing_id, count(*) as n from public.clicks group by listing_id) c on c.listing_id = l.id
where l.approved and not l.removed and l.total_paid > 0;

create or replace view public.board_today with (security_invoker = false) as
with t as (
  select p.listing_id, sum(p.amount)::int as total, min(p.paid_at) as first_paid
  from public.payments p
  where p.status = 'paid'
    and (p.paid_at at time zone 'Asia/Kolkata')::date = public.ist_today()
  group by p.listing_id
)
select
  row_number() over (order by t.total desc, t.first_paid asc)::int as rank,
  l.id, l.name, l.url, l.category, l.city,
  case when l.founder_consent then l.founder_name end as founder_name,
  l.story, l.offer, l.discount_code,
  t.total,
  coalesce(c.n, 0)::int as clicks,
  l.created_at
from t
join public.listings l on l.id = t.listing_id and l.approved and not l.removed
left join (select listing_id, count(*) as n from public.clicks where day = public.ist_today() group by listing_id) c on c.listing_id = l.id;

-- Daily archive: one board per IST day (completed days only; today lives in board_today)
create or replace view public.board_daily with (security_invoker = false) as
with d as (
  select p.listing_id, (p.paid_at at time zone 'Asia/Kolkata')::date as day,
         sum(p.amount)::int as total, min(p.paid_at) as first_paid
  from public.payments p
  where p.status = 'paid'
    and (p.paid_at at time zone 'Asia/Kolkata')::date < public.ist_today()
  group by p.listing_id, (p.paid_at at time zone 'Asia/Kolkata')::date
)
select
  d.day,
  row_number() over (partition by d.day order by d.total desc, d.first_paid asc)::int as rank,
  l.id, l.name, l.url, l.category, l.city,
  case when l.founder_consent then l.founder_name end as founder_name,
  l.story, l.offer, l.discount_code,
  d.total,
  coalesce(c.n, 0)::int as clicks,
  l.created_at
from d
join public.listings l on l.id = d.listing_id and l.approved and not l.removed
left join (select listing_id, day, count(*) as n from public.clicks group by listing_id, day) c
  on c.listing_id = l.id and c.day = d.day;

create or replace view public.daily_days with (security_invoker = false) as
select distinct (p.paid_at at time zone 'Asia/Kolkata')::date as day
from public.payments p
where p.status = 'paid'
  and (p.paid_at at time zone 'Asia/Kolkata')::date < public.ist_today();

create or replace view public.public_stats with (security_invoker = false) as
select
  (select count(distinct visitor_hash) from public.visits)::int                         as visitors,
  (select count(*) from public.visits where day = public.ist_today())::int              as visitors_today,
  (select coalesce(sum(amount), 0) from public.payments where status = 'paid')::bigint  as revenue,
  (select count(*) from public.payments where status = 'paid')::int                     as bids,
  (select count(*) from public.listings where approved and not removed and total_paid > 0)::int as listings,
  (select coalesce(max(total_paid), 0) from public.listings where approved and not removed)::int as top_total,
  (select count(*) from public.clicks)::int                                              as clicks;

create or replace view public.public_activity with (security_invoker = false) as
select p.id, l.name, l.category, l.city, p.amount, p.bid_total, p.board, p.paid_at
from public.payments p
join public.listings l on l.id = p.listing_id and l.approved and not l.removed
where p.status = 'paid'
order by p.paid_at desc
limit 50;

revoke all on public.board_all_time, public.board_today, public.board_daily, public.daily_days, public.public_stats, public.public_activity from public, anon, authenticated;
grant select on public.board_all_time, public.board_today, public.board_daily, public.daily_days, public.public_stats, public.public_activity to anon, authenticated;

-- ---------------------------------------------------------------------
-- record_payment: called by the verify-payment edge function (service_role)
-- after the Razorpay signature is verified. Atomic and idempotent.
-- ---------------------------------------------------------------------
create or replace function public.record_payment(p_order_id text, p_payment_id text, p_signature text)
returns table (listing_id uuid, amount integer, already_paid boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payments%rowtype;
begin
  select * into v from public.payments where razorpay_order_id = p_order_id for update;
  if not found then
    raise exception 'unknown order %', p_order_id using errcode = 'P0002';
  end if;

  if v.status = 'paid' then
    return query select v.listing_id, v.amount, true;
    return;
  end if;
  if v.status <> 'created' then
    raise exception 'order % is %', p_order_id, v.status using errcode = 'P0001';
  end if;

  update public.payments
     set status = 'paid', razorpay_payment_id = p_payment_id, razorpay_signature = p_signature, paid_at = now()
   where id = v.id;

  update public.listings l
     set total_paid    = l.total_paid + v.amount,
         approved      = not l.removed,
         first_paid_at = coalesce(l.first_paid_at, now())
   where l.id = v.listing_id;

  return query select v.listing_id, v.amount, false;
end;
$$;

revoke all on function public.record_payment(text, text, text) from public, anon, authenticated;
grant execute on function public.record_payment(text, text, text) to service_role;

-- ist_today is harmless, but keep the API surface minimal
revoke all on function public.ist_today() from public, anon, authenticated;
grant execute on function public.ist_today() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- service_role needs normal table access (it bypasses RLS)
-- ---------------------------------------------------------------------
grant all on public.waitlist, public.listings, public.payments, public.clicks, public.visits to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select on public.board_all_time, public.board_today, public.board_daily, public.daily_days, public.public_stats, public.public_activity to service_role;

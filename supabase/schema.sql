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
  business_details text        check (business_details is null or char_length(business_details) <= 200),
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
  bid_total           integer     not null check (bid_total >= 1),     -- the board total the bidder asked for
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

-- =====================================================================
-- Migration 2026-10-28 · UPI payments with automatic confirmation
-- Safe to re-run. Razorpay rows keep working (provider = 'razorpay').
--
--  * payments.amount stays the whole-rupee charge credited to the board
--    (all views keep summing it). payments.amount_paise is what the buyer
--    actually pays: for UPI that is charge + a unique 1-99 paise tag.
--  * UPI orders: provider='upi', status 'pending' until upi-notify (or an
--    admin) confirms them, expires_at = created + 24h, short order_code
--    used in the UPI note.
--  * upi_unmatched: credit notifications that matched no single pending
--    order, for manual review in admin.html.
--  * No anon access to payments or upi_unmatched (RLS on, no policies).
-- =====================================================================
alter table public.payments add column if not exists provider        text not null default 'razorpay';
alter table public.payments add column if not exists amount_paise    integer;
alter table public.payments add column if not exists order_code      text;
alter table public.payments add column if not exists expires_at      timestamptz;
alter table public.payments add column if not exists upi_raw         text;
alter table public.payments add column if not exists upi_app         text;
alter table public.payments add column if not exists upi_notify_hash text;
alter table public.payments add column if not exists confirmed_by    text;
alter table public.payments alter column razorpay_order_id drop not null;
update public.payments set amount_paise = amount * 100 where amount_paise is null;

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add  constraint payments_status_check
  check (status in ('created','pending','paid','failed','expired','refunded'));
alter table public.payments drop constraint if exists payments_paid_has_time;
alter table public.payments add  constraint payments_paid_has_time
  check (status <> 'paid' or (paid_at is not null and (provider = 'upi' or razorpay_payment_id is not null)));
alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments add  constraint payments_provider_check check (provider in ('upi','razorpay'));
alter table public.payments drop constraint if exists payments_provider_fields;
alter table public.payments add  constraint payments_provider_fields check (
  (provider = 'razorpay' and razorpay_order_id is not null)
  or (provider = 'upi' and amount_paise is not null and order_code is not null and expires_at is not null));
alter table public.payments drop constraint if exists payments_amount_paise_check;
alter table public.payments add  constraint payments_amount_paise_check check (amount_paise is null or amount_paise >= 1);
alter table public.payments drop constraint if exists payments_confirmed_by_check;
alter table public.payments add  constraint payments_confirmed_by_check check (confirmed_by is null or confirmed_by in ('auto','admin','razorpay'));

create unique index if not exists payments_order_code_key on public.payments (order_code) where order_code is not null;
create index if not exists payments_upi_pending_idx on public.payments (amount_paise) where provider = 'upi' and status = 'pending';
create index if not exists payments_upi_hash_idx on public.payments (upi_notify_hash) where upi_notify_hash is not null;

create table if not exists public.upi_unmatched (
  id           bigint      generated always as identity primary key,
  title        text,
  body         text,
  app          text,
  amount_paise integer,
  reason       text        not null check (reason in ('no_amount','no_match','ambiguous')),
  notify_hash  text        not null,
  status       text        not null default 'open' check (status in ('open','approved','rejected')),
  payment_id   uuid        references public.payments(id) on delete set null,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index if not exists upi_unmatched_open_idx on public.upi_unmatched (status, created_at desc);
create index if not exists upi_unmatched_hash_idx on public.upi_unmatched (notify_hash, created_at desc);

alter table public.upi_unmatched enable row level security;
revoke all on public.upi_unmatched from public, anon, authenticated;
revoke all on sequence public.upi_unmatched_id_seq from public, anon, authenticated;
grant all on public.upi_unmatched to service_role;
grant usage, select on sequence public.upi_unmatched_id_seq to service_role;

-- ---------------------------------------------------------------------
-- reserve_upi_payment: pick a payable amount unique among live pending UPI
-- orders (and UPI payments confirmed in the last 30 min, so a repeated
-- notification text can't be confused), then insert the pending row.
-- Tier 1: charge + 0.01..0.99. Last resort: smallest extra ₹1..₹20 + paise.
-- ---------------------------------------------------------------------
create or replace function public.reserve_upi_payment(p_listing_id uuid, p_board text, p_amount integer, p_bid_total integer)
returns table (id uuid, amount_paise integer, order_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base  integer := p_amount * 100;
  v_taken integer[];
  v_free  integer[];
  v_amt   integer;
  v_code  text;
  v_id    uuid;
  v_exp   timestamptz := now() + interval '24 hours';
  v_off   integer;
begin
  perform pg_advisory_xact_lock(hashtext('boli_upi_amount'));

  update public.payments p set status = 'expired'
   where p.provider = 'upi' and p.status = 'pending' and p.expires_at <= now();

  select coalesce(array_agg(p.amount_paise), '{}') into v_taken
    from public.payments p
   where p.provider = 'upi'
     and ((p.status = 'pending' and p.expires_at > now() and p.created_at > now() - interval '24 hours')
       or (p.status = 'paid' and p.paid_at > now() - interval '30 minutes'));

  -- smallest rupee offset (0 first, then 1..20) that still has a free paise value
  for v_off in 0..20 loop
    select array_agg(x) into v_free from generate_series(v_base + v_off * 100 + 1, v_base + v_off * 100 + 99) x
     where not (x = any(v_taken));
    exit when v_free is not null;
  end loop;
  if v_free is null then
    raise exception 'no free upi amount' using errcode = 'P0001';
  end if;
  v_amt := v_free[1 + floor(random() * array_length(v_free, 1))::int];

  loop
    v_code := upper(substr(translate(encode(decode(md5(random()::text || clock_timestamp()::text), 'hex'), 'base64'), '+/=0O1Iloi', ''), 1, 6));
    exit when char_length(v_code) = 6 and not exists (select 1 from public.payments p where p.order_code = v_code);
  end loop;

  insert into public.payments (listing_id, board, amount, bid_total, provider, amount_paise, order_code, expires_at, status)
  values (p_listing_id, p_board, p_amount, p_bid_total, 'upi', v_amt, v_code, v_exp, 'pending')
  returning payments.id into v_id;

  return query select v_id, v_amt, v_code, v_exp;
end;
$$;

-- ---------------------------------------------------------------------
-- record_upi_payment: mark one UPI order paid and credit/activate its
-- listing exactly like record_payment. Idempotent.
-- ---------------------------------------------------------------------
create or replace function public.record_upi_payment(p_payment_id uuid, p_raw text, p_app text, p_hash text, p_by text)
returns table (listing_id uuid, amount integer, already_paid boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payments%rowtype;
begin
  select * into v from public.payments where payments.id = p_payment_id and provider = 'upi' for update;
  if not found then
    raise exception 'unknown upi order %', p_payment_id using errcode = 'P0002';
  end if;
  if v.status = 'paid' then
    return query select v.listing_id, v.amount, true;
    return;
  end if;
  if v.status not in ('pending','expired') and not (p_by = 'admin' and v.status = 'failed') then
    raise exception 'order is %', v.status using errcode = 'P0001';
  end if;

  update public.payments
     set status = 'paid', paid_at = now(), upi_raw = left(p_raw, 2000), upi_app = left(p_app, 100),
         upi_notify_hash = p_hash, confirmed_by = p_by
   where payments.id = v.id;

  update public.listings l
     set total_paid    = l.total_paid + v.amount,
         approved      = not l.removed,
         first_paid_at = coalesce(l.first_paid_at, now())
   where l.id = v.listing_id;

  return query select v.listing_id, v.amount, false;
end;
$$;

-- ---------------------------------------------------------------------
-- upi_match_notification: called by upi-notify for credit notifications.
-- ---------------------------------------------------------------------
create or replace function public.upi_match_notification(p_amount_paise integer, p_title text, p_body text, p_app text, p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_raw text := left(coalesce(p_title, '') || E'\n' || coalesce(p_body, ''), 2000);
  r record;
  v_code text;
begin
  perform pg_advisory_xact_lock(hashtext('boli_upi_amount'));

  if exists (select 1 from public.payments where upi_notify_hash = p_hash and paid_at > now() - interval '30 minutes')
     or exists (select 1 from public.upi_unmatched where notify_hash = p_hash and created_at > now() - interval '30 minutes') then
    return jsonb_build_object('result', 'duplicate');
  end if;

  if p_amount_paise is null then
    insert into public.upi_unmatched (title, body, app, amount_paise, reason, notify_hash)
    values (left(p_title, 300), left(p_body, 1000), left(p_app, 100), null, 'no_amount', p_hash);
    return jsonb_build_object('result', 'unmatched', 'reason', 'no_amount');
  end if;

  select array_agg(p.id) into v_ids from public.payments p
   where p.provider = 'upi' and p.status = 'pending' and p.expires_at > now() and p.amount_paise = p_amount_paise;

  if v_ids is null or array_length(v_ids, 1) <> 1 then
    insert into public.upi_unmatched (title, body, app, amount_paise, reason, notify_hash)
    values (left(p_title, 300), left(p_body, 1000), left(p_app, 100), p_amount_paise,
            case when v_ids is null then 'no_match' else 'ambiguous' end, p_hash);
    return jsonb_build_object('result', 'unmatched', 'reason', case when v_ids is null then 'no_match' else 'ambiguous' end);
  end if;

  select * into r from public.record_upi_payment(v_ids[1], v_raw, p_app, p_hash, 'auto');
  select order_code into v_code from public.payments where id = v_ids[1];
  return jsonb_build_object('result', 'paid', 'order_code', v_code, 'already', r.already_paid);
end;
$$;

-- ---------------------------------------------------------------------
-- admin_approve_upi: manual approval from admin.html, optionally linking
-- the unmatched notification that proves it.
-- ---------------------------------------------------------------------
create or replace function public.admin_approve_upi(p_payment_id uuid, p_unmatched_id bigint)
returns table (listing_id uuid, amount integer, already_paid boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  u public.upi_unmatched%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('boli_upi_amount'));
  if p_unmatched_id is not null then
    select * into u from public.upi_unmatched where id = p_unmatched_id for update;
    if not found or u.status <> 'open' then
      raise exception 'notification % is not open', p_unmatched_id using errcode = 'P0001';
    end if;
  end if;

  return query select * from public.record_upi_payment(
    p_payment_id,
    coalesce(left(coalesce(u.title, '') || E'\n' || coalesce(u.body, ''), 2000), 'approved manually'),
    coalesce(u.app, 'admin'), u.notify_hash, 'admin');

  if p_unmatched_id is not null then
    update public.upi_unmatched set status = 'approved', payment_id = p_payment_id, resolved_at = now() where id = p_unmatched_id;
  end if;
end;
$$;

revoke all on function public.reserve_upi_payment(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.record_upi_payment(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.upi_match_notification(integer, text, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_approve_upi(uuid, bigint) from public, anon, authenticated;
grant execute on function public.reserve_upi_payment(uuid, text, integer, integer) to service_role;
grant execute on function public.record_upi_payment(uuid, text, text, text, text) to service_role;
grant execute on function public.upi_match_notification(integer, text, text, text, text) to service_role;
grant execute on function public.admin_approve_upi(uuid, bigint) to service_role;

-- 2026-10-28: GST/company details optional
alter table public.listings alter column business_details drop not null;

-- =====================================================================
-- Migration 2026-10-28b · Owner admin (admin-api + admin-site)
-- Safe to re-run.
--  * listings.removed is the "hidden" flag (soft remove). Public views
--    already filter it; public_stats / daily_days now also ignore money on
--    hidden listings so nothing about them leaks on the public site.
--  * payments.provider 'manual': owner-recorded comp/offline payments,
--    credited exactly like UPI/Razorpay (paid row + listings.total_paid).
--  * app_settings: changeable settings (bidding_open). Edge functions read
--    it with the BIDDING_OPEN env secret as fallback; public_settings
--    exposes only bidding_open to the browser.
--  * admin_audit: one row per mutating admin action.
--  * admin_rate: per-user request counter for admin-api.
--  No anon/authenticated access to any of the new tables.
-- =====================================================================
alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments add  constraint payments_provider_check check (provider in ('upi','razorpay','manual'));
alter table public.payments drop constraint if exists payments_provider_fields;
alter table public.payments add  constraint payments_provider_fields check (
  (provider = 'razorpay' and razorpay_order_id is not null)
  or (provider = 'upi' and amount_paise is not null and order_code is not null and expires_at is not null)
  or (provider = 'manual' and amount_paise is not null));
alter table public.payments drop constraint if exists payments_paid_has_time;
alter table public.payments add  constraint payments_paid_has_time
  check (status <> 'paid' or (paid_at is not null and (provider in ('upi','manual') or razorpay_payment_id is not null)));
alter table public.payments add column if not exists admin_note text check (admin_note is null or char_length(admin_note) <= 200);

create table if not exists public.app_settings (
  key        text primary key check (key ~ '^[a-z_]{2,40}$'),
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from public, anon, authenticated;
grant all on public.app_settings to service_role;

create table if not exists public.admin_audit (
  id         bigint generated always as identity primary key,
  actor      text not null,
  action     text not null,
  target     text,
  details    jsonb,
  at         timestamptz not null default now()
);
create index if not exists admin_audit_at_idx on public.admin_audit (at desc);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from public, anon, authenticated;
revoke all on sequence public.admin_audit_id_seq from public, anon, authenticated;
grant all on public.admin_audit to service_role;
grant usage, select on sequence public.admin_audit_id_seq to service_role;

create table if not exists public.admin_rate (
  user_id uuid not null,
  bucket  timestamptz not null,
  hits    integer not null default 0,
  primary key (user_id, bucket)
);
alter table public.admin_rate enable row level security;
revoke all on public.admin_rate from public, anon, authenticated;
grant all on public.admin_rate to service_role;

-- true when this request is within p_limit per p_window_sec for the user
create or replace function public.admin_rate_hit(p_user uuid, p_limit integer, p_window_sec integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bucket timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_sec) * p_window_sec);
  v_hits integer;
begin
  insert into public.admin_rate (user_id, bucket, hits) values (p_user, v_bucket, 1)
  on conflict (user_id, bucket) do update set hits = public.admin_rate.hits + 1
  returning hits into v_hits;
  delete from public.admin_rate where bucket < now() - interval '1 day';
  return v_hits <= p_limit;
end;
$$;

-- Owner-recorded payment (comp / offline). Same crediting as record_payment / record_upi_payment.
create or replace function public.record_manual_payment(p_listing_id uuid, p_board text, p_amount integer, p_bid_total integer, p_note text)
returns table (payment_id uuid, listing_id uuid, amount integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_amount is null or p_amount < 1 then raise exception 'amount must be >= 1' using errcode = 'P0001'; end if;
  perform 1 from public.listings l where l.id = p_listing_id for update;
  if not found then raise exception 'unknown listing %', p_listing_id using errcode = 'P0002'; end if;

  insert into public.payments (listing_id, board, amount, bid_total, provider, amount_paise, status, paid_at, confirmed_by, admin_note)
  values (p_listing_id, p_board, p_amount, p_bid_total, 'manual', p_amount * 100, 'paid', now(), 'admin', left(p_note, 200))
  returning payments.id into v_id;

  update public.listings l
     set total_paid    = l.total_paid + p_amount,
         approved      = not l.removed,
         first_paid_at = coalesce(l.first_paid_at, now())
   where l.id = p_listing_id;

  return query select v_id, p_listing_id, p_amount;
end;
$$;

-- Hide / unhide. Unhide re-approves only listings that have a paid payment.
create or replace function public.admin_set_hidden(p_listing_id uuid, p_hidden boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.listings l
     set removed  = p_hidden,
         approved = case when p_hidden then l.approved
                         else exists (select 1 from public.payments p where p.listing_id = l.id and p.status = 'paid') end
   where l.id = p_listing_id;
  return found;
end;
$$;

-- Permanent delete: the listing, its payments (all statuses) and clicks.
create or replace function public.admin_delete_listing(p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text; v_pay integer; v_sum integer;
begin
  select name into v_name from public.listings where id = p_listing_id for update;
  if not found then return null; end if;
  select count(*), coalesce(sum(amount) filter (where status = 'paid'), 0) into v_pay, v_sum
    from public.payments where listing_id = p_listing_id;
  delete from public.payments where listing_id = p_listing_id;
  delete from public.listings where id = p_listing_id;
  return jsonb_build_object('name', v_name, 'payments_deleted', v_pay, 'paid_total_removed', v_sum);
end;
$$;

revoke all on function public.admin_rate_hit(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.record_manual_payment(uuid, text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.admin_set_hidden(uuid, boolean) from public, anon, authenticated;
revoke all on function public.admin_delete_listing(uuid) from public, anon, authenticated;
grant execute on function public.admin_rate_hit(uuid, integer, integer) to service_role;
grant execute on function public.record_manual_payment(uuid, text, integer, integer, text) to service_role;
grant execute on function public.admin_set_hidden(uuid, boolean) to service_role;
grant execute on function public.admin_delete_listing(uuid) to service_role;

-- Public views: ignore money on hidden listings
create or replace view public.daily_days with (security_invoker = false) as
select distinct (p.paid_at at time zone 'Asia/Kolkata')::date as day
from public.payments p
join public.listings l on l.id = p.listing_id and l.approved and not l.removed
where p.status = 'paid'
  and (p.paid_at at time zone 'Asia/Kolkata')::date < public.ist_today();

create or replace view public.public_stats with (security_invoker = false) as
select
  (select count(distinct visitor_hash) from public.visits)::int                         as visitors,
  (select count(*) from public.visits where day = public.ist_today())::int              as visitors_today,
  (select coalesce(sum(p.amount), 0) from public.payments p join public.listings l on l.id = p.listing_id and l.approved and not l.removed
     where p.status = 'paid')::bigint                                                    as revenue,
  (select count(*) from public.payments p join public.listings l on l.id = p.listing_id and l.approved and not l.removed
     where p.status = 'paid')::int                                                       as bids,
  (select count(*) from public.listings where approved and not removed and total_paid > 0)::int as listings,
  (select coalesce(max(total_paid), 0) from public.listings where approved and not removed)::int as top_total,
  (select count(*) from public.clicks c join public.listings l on l.id = c.listing_id and l.approved and not l.removed)::int as clicks;

create or replace view public.public_settings with (security_invoker = false) as
select (select (value #>> '{}')::boolean from public.app_settings where key = 'bidding_open') as bidding_open;

revoke all on public.daily_days, public.public_stats, public.public_settings from public, anon, authenticated;
grant select on public.daily_days, public.public_stats, public.public_settings to anon, authenticated, service_role;

create table if not exists public.lexoffice_import_queue (
  voucher_id text primary key,
  voucher_number text not null default '',
  voucher_type text not null default 'invoice',
  voucher_status text not null default '',
  voucher_date text not null default '',
  contact_name text not null default '',
  lexoffice_contact_id text not null default '',
  total_amount numeric not null default 0,
  currency text not null default 'EUR',
  is_storno boolean not null default false,
  confidence text not null default 'low' check (confidence in ('high', 'medium', 'low')),
  import_status text not null default 'pending_review' check (import_status in ('pending_review', 'auto_imported', 'duplicate', 'error')),
  review_reason text not null default '',
  detail_payload jsonb not null default '{}'::jsonb,
  positions_payload jsonb not null default '[]'::jsonb,
  suggested_customer_id text references public.customers (id) on delete set null,
  booking_ids text[] not null default '{}'::text[],
  error_message text not null default '',
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists lexoffice_import_queue_status_idx
  on public.lexoffice_import_queue (import_status, last_seen_at desc);

create index if not exists lexoffice_import_queue_contact_idx
  on public.lexoffice_import_queue (lexoffice_contact_id);

create table if not exists public.lexoffice_sync_state (
  id text primary key,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text not null default '',
  last_summary jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.lexoffice_sync_state (id)
values ('default')
on conflict (id) do nothing;

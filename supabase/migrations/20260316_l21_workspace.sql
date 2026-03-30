create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('admin', 'verwaltung', 'hausmeister', 'reinigung');
  end if;

  if not exists (select 1 from pg_type where typname = 'task_status') then
    create type public.task_status as enum ('offen', 'in_bearbeitung', 'wartet', 'erledigt');
  end if;

  if not exists (select 1 from pg_type where typname = 'task_priority') then
    create type public.task_priority as enum ('niedrig', 'mittel', 'hoch');
  end if;

  if not exists (select 1 from pg_type where typname = 'conversation_type') then
    create type public.conversation_type as enum ('direct', 'task');
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null,
  role public.app_role not null default 'reinigung',
  avatar_color text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type public.conversation_type not null,
  title text not null default '',
  task_id uuid unique,
  created_by uuid not null references public.profiles (id) on delete restrict,
  direct_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint direct_key_required check (
    (type = 'direct' and direct_key is not null) or
    (type = 'task' and direct_key is null)
  )
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  status public.task_status not null default 'offen',
  priority public.task_priority not null default 'mittel',
  due_at timestamptz not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  assignee_id uuid not null references public.profiles (id) on delete restrict,
  location_id text references public.locations (id) on delete set null,
  property_id text references public.properties (id) on delete set null,
  unit_label text,
  conversation_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.conversations
  add constraint conversations_task_id_fkey
  foreign key (task_id) references public.tasks (id) on delete cascade;

alter table public.tasks
  add constraint tasks_conversation_id_fkey
  foreign key (conversation_id) references public.conversations (id) on delete set null;

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

create or replace function public.touch_conversation_from_message()
returns trigger
language plpgsql
as $$
begin
  update public.conversations
  set updated_at = now()
  where id = new.conversation_id;

  return new;
end;
$$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
after insert on public.messages
for each row execute function public.touch_conversation_from_message();

create or replace function public.ensure_profile_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, ''),
    coalesce((new.raw_user_meta_data ->> 'role')::public.app_role, 'reinigung')
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = case when excluded.full_name <> '' then excluded.full_name else public.profiles.full_name end;

  return new;
exception
  when others then
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.ensure_profile_from_auth();

create or replace function public.create_task_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_id uuid;
begin
  insert into public.conversations (type, title, task_id, created_by)
  values ('task', new.title, new.id, new.created_by)
  returning id into conv_id;

  insert into public.conversation_members (conversation_id, profile_id)
  values (conv_id, new.created_by)
  on conflict do nothing;

  insert into public.conversation_members (conversation_id, profile_id)
  values (conv_id, new.assignee_id)
  on conflict do nothing;

  update public.tasks
  set conversation_id = conv_id
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists tasks_create_conversation on public.tasks;
create trigger tasks_create_conversation
after insert on public.tasks
for each row execute function public.create_task_conversation();

create or replace function public.sync_task_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.conversation_id is not null then
    insert into public.conversation_members (conversation_id, profile_id)
    values (new.conversation_id, new.assignee_id)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_sync_membership on public.tasks;
create trigger tasks_sync_membership
after update of assignee_id on public.tasks
for each row execute function public.sync_task_membership();

create or replace function public.current_profile_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() = 'admin', false)
$$;

alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

drop policy if exists "profiles_self_or_admin_select" on public.profiles;
create policy "profiles_self_or_admin_select" on public.profiles
for select
using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_admin_insert" on public.profiles;
create policy "profiles_admin_insert" on public.profiles
for insert
with check (public.is_admin());

drop policy if exists "profiles_admin_update_or_self" on public.profiles;
create policy "profiles_admin_update_or_self" on public.profiles
for update
using (public.is_admin() or auth.uid() = id)
with check (public.is_admin() or auth.uid() = id);

drop policy if exists "tasks_select_for_admin_or_assignee" on public.tasks;
create policy "tasks_select_for_admin_or_assignee" on public.tasks
for select
using (public.is_admin() or assignee_id = auth.uid() or created_by = auth.uid());

drop policy if exists "tasks_admin_insert" on public.tasks;
create policy "tasks_admin_insert" on public.tasks
for insert
with check (public.is_admin());

drop policy if exists "tasks_admin_update_or_assignee_status" on public.tasks;
create policy "tasks_admin_update_or_assignee_status" on public.tasks
for update
using (public.is_admin() or assignee_id = auth.uid())
with check (public.is_admin() or assignee_id = auth.uid());

drop policy if exists "conversations_member_select" on public.conversations;
create policy "conversations_member_select" on public.conversations
for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = id and cm.profile_id = auth.uid()
  )
);

drop policy if exists "conversations_admin_insert" on public.conversations;
create policy "conversations_admin_insert" on public.conversations
for insert
with check (public.is_admin() or created_by = auth.uid());

drop policy if exists "conversation_members_member_select" on public.conversation_members;
create policy "conversation_members_member_select" on public.conversation_members
for select
using (
  public.is_admin()
  or profile_id = auth.uid()
  or exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = conversation_id and cm.profile_id = auth.uid()
  )
);

drop policy if exists "conversation_members_admin_insert" on public.conversation_members;
create policy "conversation_members_admin_insert" on public.conversation_members
for insert
with check (public.is_admin());

drop policy if exists "messages_member_select" on public.messages;
create policy "messages_member_select" on public.messages
for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id and cm.profile_id = auth.uid()
  )
);

drop policy if exists "messages_member_insert" on public.messages;
create policy "messages_member_insert" on public.messages
for insert
with check (
  author_id = auth.uid()
  and exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id and cm.profile_id = auth.uid()
  )
);

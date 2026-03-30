create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.tasks
  add column if not exists archived_at timestamptz;

alter table public.tasks
  add column if not exists archived_by uuid references public.profiles (id) on delete set null;

alter table public.task_comments enable row level security;

drop policy if exists "task_comments_member_select" on public.task_comments;
create policy "task_comments_member_select" on public.task_comments
for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.tasks t
    where t.id = task_comments.task_id
      and (t.assignee_id = auth.uid() or t.created_by = auth.uid())
  )
);

drop policy if exists "task_comments_member_insert" on public.task_comments;
create policy "task_comments_member_insert" on public.task_comments
for insert
with check (
  author_id = auth.uid()
  and (
    public.is_admin()
    or exists (
      select 1
      from public.tasks t
      where t.id = task_comments.task_id
        and (t.assignee_id = auth.uid() or t.created_by = auth.uid())
    )
  )
);

drop policy if exists "tasks_admin_delete" on public.tasks;
create policy "tasks_admin_delete" on public.tasks
for delete
using (public.is_admin());

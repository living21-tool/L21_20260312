drop policy if exists "tasks_admin_delete" on public.tasks;
drop policy if exists "tasks_creator_delete" on public.tasks;

create policy "tasks_creator_delete" on public.tasks
for delete
using (
  public.is_admin()
  or created_by = auth.uid()
);

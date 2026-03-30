drop policy if exists "task_comments_member_delete" on public.task_comments;
create policy "task_comments_member_delete" on public.task_comments
for delete
using (
  public.is_admin()
  or author_id = auth.uid()
);

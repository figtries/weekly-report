-- ============================================================
-- FASE 3: Row Level Security — basic policies
-- FASE 4 replaces these with per-role policies using profiles.area_access.
-- ============================================================

-- Enable RLS on every table.
-- The profiles trigger runs on auth.users, so it doesn't need RLS itself.
alter table profiles           enable row level security;
alter table users              enable row level security;
alter table projects           enable row level security;
alter table memberships        enable row level security;
alter table app_state          enable row level security;
alter table wbs_nodes          enable row level security;
alter table bar_styles         enable row level security;
alter table milestones         enable row level security;
alter table baselines          enable row level security;
alter table node_schedules     enable row level security;
alter table weeks              enable row level security;
alter table leaf_progress      enable row level security;
alter table milestone_progress enable row level security;
alter table approvals          enable row level security;
alter table audit_log          enable row level security;
alter table transmittals       enable row level security;
alter table doc_categories     enable row level security;
alter table documents          enable row level security;
alter table doc_stages         enable row level security;
alter table doc_stage_weights  enable row level security;
alter table doc_numbering      enable row level security;

-- ─── FASE 2 policies: any authenticated user may read and write everything.
-- FASE 4 narrows these to per-area role checks using profiles.area_access.

create policy "auth_select" on profiles           for select using (auth.role() = 'authenticated');
create policy "auth_insert" on profiles           for insert with check (auth.uid() = id);
create policy "auth_update" on profiles           for update using (auth.uid() = id);

create policy "auth_all"    on users              for all using (auth.role() = 'authenticated');
create policy "auth_all"    on projects           for all using (auth.role() = 'authenticated');
create policy "auth_all"    on memberships        for all using (auth.role() = 'authenticated');
create policy "auth_all"    on app_state          for all using (auth.role() = 'authenticated');
create policy "auth_all"    on wbs_nodes          for all using (auth.role() = 'authenticated');
create policy "auth_all"    on bar_styles         for all using (auth.role() = 'authenticated');
create policy "auth_all"    on milestones         for all using (auth.role() = 'authenticated');
create policy "auth_all"    on baselines          for all using (auth.role() = 'authenticated');
create policy "auth_all"    on node_schedules     for all using (auth.role() = 'authenticated');
create policy "auth_all"    on weeks              for all using (auth.role() = 'authenticated');
create policy "auth_all"    on leaf_progress      for all using (auth.role() = 'authenticated');
create policy "auth_all"    on milestone_progress for all using (auth.role() = 'authenticated');
create policy "auth_all"    on approvals          for all using (auth.role() = 'authenticated');
create policy "auth_all"    on audit_log          for all using (auth.role() = 'authenticated');
create policy "auth_all"    on transmittals       for all using (auth.role() = 'authenticated');
create policy "auth_all"    on doc_categories     for all using (auth.role() = 'authenticated');
create policy "auth_all"    on documents          for all using (auth.role() = 'authenticated');
create policy "auth_all"    on doc_stages         for all using (auth.role() = 'authenticated');
create policy "auth_all"    on doc_stage_weights  for all using (auth.role() = 'authenticated');
create policy "auth_all"    on doc_numbering      for all using (auth.role() = 'authenticated');

-- ─── Auto-create a profiles row for every new Supabase user ──────────────
-- Runs in the auth schema so a new signup always has a row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, role, area_access)
  values (new.id, 'viewer', '{}')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

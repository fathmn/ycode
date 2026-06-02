-- Canonicalize platform operator roles to product-branded studio_* values.
-- This migration is intentionally tolerant because the table rename migration
-- may run before or after it depending on the target database history.

do $$
declare
  membership_table text;
begin
  if to_regclass('public.studio_project_memberships') is not null then
    membership_table := 'studio_project_memberships';
  elsif to_regclass('public.novum_project_memberships') is not null then
    membership_table := 'novum_project_memberships';
  else
    return;
  end if;

  execute format('alter table public.%I drop constraint if exists studio_project_memberships_role_check', membership_table);
  execute format('alter table public.%I drop constraint if exists novum_project_memberships_role_check', membership_table);
  execute format('update public.%I set role = %L where role = %L', membership_table, 'studio_admin', 'novum_admin');
  execute format('update public.%I set role = %L where role = %L', membership_table, 'studio_developer', 'novum_developer');
  execute format(
    'alter table public.%I add constraint studio_project_memberships_role_check check (role in (%L, %L, %L, %L, %L))',
    membership_table,
    'studio_admin',
    'studio_developer',
    'customer_owner',
    'customer_editor',
    'customer_viewer'
  );
end $$;

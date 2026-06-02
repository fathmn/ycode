-- Canonicalize platform operator roles from company-branded novum_* to product-branded studio_*.
-- Legacy application code still accepts novum_* during rollout, but new writes should use studio_*.

alter table public.novum_project_memberships
  drop constraint if exists novum_project_memberships_role_check;

update public.novum_project_memberships
set role = 'studio_admin'
where role = 'novum_admin';

update public.novum_project_memberships
set role = 'studio_developer'
where role = 'novum_developer';

alter table public.novum_project_memberships
  add constraint novum_project_memberships_role_check
  check (role in (
    'studio_admin',
    'studio_developer',
    'customer_owner',
    'customer_editor',
    'customer_viewer'
  ));

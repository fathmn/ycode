import type { Knex } from 'knex';

const BUILDER_CORE_TABLES = [
  'settings',
  'page_folders',
  'pages',
  'page_layers',
  'collections',
  'collection_fields',
  'collection_items',
  'collection_item_values',
  'assets',
  'asset_folders',
  'components',
  'layer_styles',
  'color_variables',
  'fonts',
  'locales',
  'translations',
  'form_submissions',
];

export async function up(knex: Knex): Promise<void> {
  for (const tableName of BUILDER_CORE_TABLES) {
    await knex.schema.raw(`
      alter table if exists public.${tableName}
      add column if not exists project_id uuid
    `);

    await knex.schema.raw(`
      do $$
      begin
        if not exists (
          select 1
          from pg_constraint
          where conname = '${tableName}_project_id_fkey'
            and conrelid = 'public.${tableName}'::regclass
        ) then
          alter table public.${tableName}
          add constraint ${tableName}_project_id_fkey
          foreign key (project_id)
          references public.studio_projects(id)
          on delete cascade;
        end if;
      end $$;
    `);

    await knex.schema.raw(`
      create index if not exists idx_${tableName}_project_id
      on public.${tableName}(project_id)
    `);
  }

  await knex.schema.raw(`
    do $$
    declare
      fallback_project_id uuid;
    begin
      select id
      into fallback_project_id
      from public.studio_projects
      where status = 'active'
      order by created_at asc
      limit 1;

      if fallback_project_id is not null then
        update public.settings set project_id = fallback_project_id where project_id is null;
        update public.page_folders set project_id = fallback_project_id where project_id is null;
        update public.pages set project_id = fallback_project_id where project_id is null;
        update public.page_layers set project_id = fallback_project_id where project_id is null;
        update public.collections set project_id = fallback_project_id where project_id is null;
        update public.collection_fields set project_id = fallback_project_id where project_id is null;
        update public.collection_items set project_id = fallback_project_id where project_id is null;
        update public.collection_item_values set project_id = fallback_project_id where project_id is null;
        update public.assets set project_id = fallback_project_id where project_id is null;
        update public.asset_folders set project_id = fallback_project_id where project_id is null;
        update public.components set project_id = fallback_project_id where project_id is null;
        update public.layer_styles set project_id = fallback_project_id where project_id is null;
        update public.color_variables set project_id = fallback_project_id where project_id is null;
        update public.fonts set project_id = fallback_project_id where project_id is null;
        update public.locales set project_id = fallback_project_id where project_id is null;
        update public.translations set project_id = fallback_project_id where project_id is null;
        update public.form_submissions set project_id = fallback_project_id where project_id is null;
      end if;
    end $$;
  `);

  await knex.schema.raw('alter table public.settings drop constraint if exists settings_key_key');
  await knex.schema.raw('alter table public.settings drop constraint if exists settings_project_id_key_unique');
  await knex.schema.raw('drop index if exists public.settings_key_key');
  await knex.schema.raw(`
    alter table public.settings
    add constraint settings_project_id_key_unique
    unique (project_id, key)
  `);

	  await knex.schema.raw('drop index if exists public.pages_slug_is_published_folder_unique');
	  await knex.schema.raw(`
	    create unique index if not exists pages_project_slug_is_published_folder_unique
    on public.pages(
      project_id,
      slug,
      is_published,
      coalesce(page_folder_id, '00000000-0000-0000-0000-000000000000'::uuid),
      coalesce(error_page, 0)
    )
	    where deleted_at is null and is_dynamic = false
	  `);

  await knex.schema.raw('alter table public.pages drop constraint if exists pages_project_folder_fkey');
  await knex.schema.raw('alter table public.page_folders drop constraint if exists page_folders_project_parent_fkey');
  await knex.schema.raw('alter table public.page_folders drop constraint if exists page_folders_project_id_id_is_published_unique');
  await knex.schema.raw(`
    alter table public.page_folders
    add constraint page_folders_project_id_id_is_published_unique
    unique (project_id, id, is_published)
  `);
  await knex.schema.raw(`
    alter table public.pages
    add constraint pages_project_folder_fkey
    foreign key (project_id, page_folder_id, is_published)
    references public.page_folders(project_id, id, is_published)
    on update cascade
  `);
  await knex.schema.raw(`
    alter table public.page_folders
    add constraint page_folders_project_parent_fkey
    foreign key (project_id, page_folder_id, is_published)
    references public.page_folders(project_id, id, is_published)
    on update cascade
  `);

	  await knex.schema.raw(`
	    create index if not exists idx_page_layers_project_page_id
    on public.page_layers(project_id, page_id, is_published)
    where deleted_at is null
  `);
  await knex.schema.raw(`
    create index if not exists idx_collection_items_project_collection
    on public.collection_items(project_id, collection_id, is_published)
    where deleted_at is null
  `);
  await knex.schema.raw(`
    create index if not exists idx_collection_item_values_project_item
    on public.collection_item_values(project_id, item_id, is_published)
    where deleted_at is null
  `);
  await knex.schema.raw(`
    create index if not exists idx_collection_fields_project_collection
    on public.collection_fields(project_id, collection_id, is_published)
    where deleted_at is null
  `);
  await knex.schema.raw(`
    create index if not exists idx_assets_project_published
    on public.assets(project_id, is_published)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('drop index if exists public.idx_assets_project_published');
  await knex.schema.raw('drop index if exists public.idx_collection_fields_project_collection');
  await knex.schema.raw('drop index if exists public.idx_collection_item_values_project_item');
  await knex.schema.raw('drop index if exists public.idx_collection_items_project_collection');
	  await knex.schema.raw('drop index if exists public.idx_page_layers_project_page_id');
  await knex.schema.raw('alter table public.page_folders drop constraint if exists page_folders_project_parent_fkey');
  await knex.schema.raw('alter table public.pages drop constraint if exists pages_project_folder_fkey');
  await knex.schema.raw('alter table public.page_folders drop constraint if exists page_folders_project_id_id_is_published_unique');
	  await knex.schema.raw('drop index if exists public.pages_project_slug_is_published_folder_unique');
  await knex.schema.raw(`
    create unique index if not exists pages_slug_is_published_folder_unique
    on public.pages(
      slug,
      is_published,
      coalesce(page_folder_id, '00000000-0000-0000-0000-000000000000'::uuid),
      coalesce(error_page, 0)
    )
    where deleted_at is null
  `);

  await knex.schema.raw('alter table public.settings drop constraint if exists settings_project_id_key_unique');
  await knex.schema.raw('alter table public.settings add constraint settings_key_key unique (key)');

  for (const tableName of [...BUILDER_CORE_TABLES].reverse()) {
    await knex.schema.raw(`drop index if exists public.idx_${tableName}_project_id`);
    await knex.schema.raw(`alter table if exists public.${tableName} drop constraint if exists ${tableName}_project_id_fkey`);
    await knex.schema.raw(`alter table if exists public.${tableName} drop column if exists project_id`);
  }
}

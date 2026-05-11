import type { Knex } from 'knex';

/**
 * Ensure each preview-render nonce can be consumed only once.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(`
    DO $$
    BEGIN
      IF to_regclass('public.novum_preview_runs') IS NOT NULL THEN
        CREATE UNIQUE INDEX IF NOT EXISTS novum_preview_runs_raw_nonce_hash_unique
        ON public.novum_preview_runs ((metadata->>'rawNonceHash'))
        WHERE metadata->>'rawNonceHash' IS NOT NULL;
      END IF;
    END
    $$;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP INDEX IF EXISTS public.novum_preview_runs_raw_nonce_hash_unique');
}

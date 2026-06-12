import type { Knex } from 'knex';
import path from 'path';
import { parseSupabaseConfig } from './lib/supabase-config-parser.ts';
import type { SupabaseConfig } from './types/index.ts';

/**
 * Knex Configuration for Ycode Supabase Migrations
 *
 * This configuration is used to run migrations programmatically
 * against the user's Supabase PostgreSQL database.
 */

/**
 * Load Supabase credentials from centralized storage
 * Uses environment variables on Vercel, file-based storage locally
 */
async function getSupabaseConnectionParams() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const config: SupabaseConfig = {
    anonKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '',
    serviceRoleKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    connectionUrl: process.env.SUPABASE_CONNECTION_URL || '',
    dbPassword: process.env.SUPABASE_DB_PASSWORD || '',
    ...(supabaseUrl ? { supabaseUrl } : {}),
  };

  if (!config?.connectionUrl || !config?.dbPassword) {
    throw new Error('SUPABASE_* environment variables are not configured. Please run setup first.');
  }

  const connectionParams = parseSupabaseConfig(config);
  const isSelfHosted = !!config.supabaseUrl;

  return {
    host: connectionParams.dbHost,
    port: connectionParams.dbPort,
    database: connectionParams.dbName,
    user: connectionParams.dbUser,
    password: connectionParams.dbPassword,
    ssl: isSelfHosted ? false : { rejectUnauthorized: false },
  };
}

const createConfig = (): Knex.Config => {
  const isVercel = process.env.VERCEL === '1';

  return {
    client: 'pg',
    connection: async () => {
      const connectionParams = await getSupabaseConnectionParams();

      return connectionParams;
    },
    migrations: {
      directory: path.join(process.cwd(), 'database/migrations'),
      extension: 'ts',
      tableName: 'migrations',
    },
    pool: isVercel ? {
      min: 0,
      max: 1,
      acquireTimeoutMillis: 10000,
      createTimeoutMillis: 10000,
      idleTimeoutMillis: 1000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 200,
    } : {
      min: 0,
      max: 3,
      idleTimeoutMillis: 30000,
    },
  };
};

const config: { [key: string]: Knex.Config } = {
  development: createConfig(),
  production: createConfig(),
};

export default config;

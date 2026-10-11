export const config = {
  ingestUrl: process.env.SCOUT_INGEST_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  timeoutMs: Number(process.env.SCOUT_TIMEOUT_MS || 15000),
  maxItems: Number(process.env.SCOUT_MAX_ITEMS_PER_SOURCE || 20),
  userAgent: process.env.SCOUT_USER_AGENT || 'tver-real-estate-scout/0.1',
};

export function assertConfig() {
  const missing = [];
  if (!config.ingestUrl) missing.push('SCOUT_INGEST_URL');
  if (!config.serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
}

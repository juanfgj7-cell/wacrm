import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for the social-post publish
// pipeline (cron worker + orchestrator). Mirrors
// src/lib/automations/admin-client.ts / src/lib/flows/admin-client.ts.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

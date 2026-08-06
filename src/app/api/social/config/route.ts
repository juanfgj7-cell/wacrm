import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  verifyPageAccess,
  verifyInstagramAccess,
} from '@/lib/social/meta-graph-api'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

/**
 * Resolve the caller's account_id from their profile. Same inlined
 * pattern as src/app/api/whatsapp/config/route.ts — the GET handler
 * wants shaped 200s for every non-auth failure, not thrown errors.
 */
async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

/**
 * GET /api/social/config
 *
 * Doubles as the initial load AND the "Test Connection" health check
 * (decrypts the stored Page token and pings Graph API). Always 200 for
 * expected failure modes so the UI renders specific guidance instead
 * of a generic error.
 *
 * Response shape:
 *   { connected: true,  page_info: {...}, ig_info?: {...} }
 *   { connected: false, reason: 'no_config',       message: '...' }
 *   { connected: false, reason: 'token_corrupted', message: '...', needs_reset: true }
 *   { connected: false, reason: 'meta_api_error',  message: '...' }
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { connected: false, reason: 'no_account', message: 'Your profile is not linked to an account.' },
        { status: 200 },
      )
    }

    const { data: config, error: configError } = await supabase
      .from('social_config')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle()

    if (configError) {
      console.error('Error fetching social_config:', configError)
      return NextResponse.json(
        { connected: false, reason: 'db_error', message: 'Failed to fetch configuration' },
        { status: 200 },
      )
    }

    if (!config || !config.page_id || !config.page_access_token) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message: 'No hay ninguna Página de Facebook conectada todavía. Completa el formulario y guarda.',
        },
        { status: 200 },
      )
    }

    let pageAccessToken: string
    try {
      pageAccessToken = decrypt(config.page_access_token as string)
    } catch (err) {
      console.error('[social/config GET] Token decryption failed:', err)
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message:
            'El token guardado no se puede leer con la ENCRYPTION_KEY actual. Esto suele pasar cuando la clave cambió o difiere entre entornos. Haz clic en "Restablecer" y vuelve a guardar.',
        },
        { status: 200 },
      )
    }

    try {
      const pageInfo = await verifyPageAccess({
        pageId: config.page_id as string,
        pageAccessToken,
      })
      let igInfo = null
      if (config.ig_business_account_id) {
        try {
          igInfo = await verifyInstagramAccess({
            igBusinessAccountId: config.ig_business_account_id as string,
            pageAccessToken,
          })
        } catch (err) {
          // Page token still valid — surface the IG-specific failure
          // separately rather than failing the whole connection.
          console.warn('[social/config GET] Instagram verify failed:', err)
        }
      }
      return NextResponse.json({ connected: true, page_info: pageInfo, ig_info: igInfo })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[social/config GET] Meta API verification failed:', message)
      return NextResponse.json(
        { connected: false, reason: 'meta_api_error', message: `Meta rechazó las credenciales: ${message}` },
        { status: 200 },
      )
    }
  } catch (error) {
    console.error('Error in social config GET:', error)
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/social/config
 *
 * Saves or updates the Facebook Page / Instagram config for the
 * authenticated user's account. Verifies against Graph API first,
 * then encrypts and stores — same order as
 * src/app/api/whatsapp/config/route.ts, for the same reason (never
 * persist a token that turned out to be garbage).
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }

    const body = await request.json()
    const { page_id, page_access_token, ig_business_account_id } = body

    if (!page_id || !page_access_token) {
      return NextResponse.json(
        { error: 'page_id and page_access_token are required' },
        { status: 400 },
      )
    }

    let pageInfo
    try {
      pageInfo = await verifyPageAccess({ pageId: page_id, pageAccessToken: page_access_token })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('Meta API verification failed during social config save:', message)
      return NextResponse.json({ error: `Meta rechazó las credenciales: ${message}` }, { status: 400 })
    }

    let igInfo = null
    if (ig_business_account_id) {
      try {
        igInfo = await verifyInstagramAccess({
          igBusinessAccountId: ig_business_account_id,
          pageAccessToken: page_access_token,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown Meta API error'
        return NextResponse.json(
          { error: `La Página es válida, pero la cuenta de Instagram no: ${message}` },
          { status: 400 },
        )
      }
    }

    let encryptedToken: string
    try {
      encryptedToken = encrypt(page_access_token)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown encryption error'
      console.error('Encryption failed:', message)
      return NextResponse.json(
        { error: 'No se pudo cifrar el token. Revisa que ENCRYPTION_KEY sea un hex de 64 caracteres válido.' },
        { status: 500 },
      )
    }

    const { data: existing } = await supabase
      .from('social_config')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle()

    const row = {
      page_id,
      page_name: pageInfo.name,
      page_access_token: encryptedToken,
      ig_business_account_id: ig_business_account_id || null,
      ig_username: igInfo?.username ?? null,
      status: 'connected',
      connected_at: new Date().toISOString(),
      last_verify_error: null,
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from('social_config')
        .update(row)
        .eq('account_id', accountId)
      if (updateError) {
        console.error('Error updating social_config:', updateError)
        return NextResponse.json({ error: 'Failed to update configuration' }, { status: 500 })
      }
    } else {
      const { error: insertError } = await supabase
        .from('social_config')
        .insert({ account_id: accountId, user_id: user.id, ...row })
      if (insertError) {
        console.error('Error inserting social_config:', insertError)
        return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true, page_info: pageInfo, ig_info: igInfo })
  } catch (error) {
    console.error('Error in social config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/social/config
 *
 * Removes the account's saved Facebook/Instagram configuration.
 * Recovery path for a corrupted encrypted token (mismatched
 * ENCRYPTION_KEY across environments) — same as WhatsApp's Reset.
 */
export async function DELETE() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }

    const { error: deleteError } = await supabase
      .from('social_config')
      .delete()
      .eq('account_id', accountId)

    if (deleteError) {
      console.error('Error deleting social_config:', deleteError)
      return NextResponse.json({ error: 'Failed to delete configuration' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in social config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

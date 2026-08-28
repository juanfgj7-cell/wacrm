import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'

// ============================================================
// Integration smoke test for the inbound WhatsApp webhook — the single
// most business-critical endpoint in the app (every customer message
// passes through here before it reaches the inbox, an automation, a
// flow, or the AI assistant).
//
// This test exercises `processWebhook` through the real `POST` export
// with a mocked Supabase admin client (same style as
// `whatsapp/send/route.test.ts`) and mocked dispatch modules
// (automations/flows/AI/webhooks — each has its own dedicated test
// suite, so here we only assert that the webhook *calls* them
// correctly, not what they do internally).
//
// `verifyMetaWebhookSignature` is NOT mocked — every request below is
// signed for real with the `META_APP_SECRET` vitest.config.ts sets for
// the whole suite, so the signature-verification path (see the
// security review) is exercised end-to-end too.
// ============================================================

const ACCOUNT_ID = 'acct-1'
const CONFIG_OWNER_USER_ID = 'user-1'
const PHONE_NUMBER_ID = 'PNID-1'
const META_APP_SECRET = 'test-meta-app-secret' // matches vitest.config.ts

const CONFIG_ROW = {
  id: 'cfg-1',
  account_id: ACCOUNT_ID,
  user_id: CONFIG_OWNER_USER_ID,
  phone_number_id: PHONE_NUMBER_ID,
  access_token: 'enc-token',
  verify_token: 'vt',
}

// --- Mutable scenario state, reset in beforeEach --------------------------
let configRows: Array<Record<string, unknown>> = []
let existingConversationRow: Record<string, unknown> | null = null
let priorMessageCount = 0
const contactInserts: Array<Record<string, unknown>> = []
const conversationInserts: Array<Record<string, unknown>> = []
const messageInserts: Array<Record<string, unknown>> = []

// `after()` callbacks in the real Next.js runtime run outside the
// request/response cycle. We capture the promise here so tests can
// await the webhook's background processing before asserting.
let pendingAfter: Promise<unknown> = Promise.resolve()
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (cb: () => unknown) => {
      pendingAfter = Promise.resolve().then(cb)
    },
  }
})

const { findExistingContact, isUniqueViolation } = vi.hoisted(() => ({
  findExistingContact: vi.fn(async () => null as Record<string, unknown> | null),
  isUniqueViolation: vi.fn(() => false),
}))
vi.mock('@/lib/contacts/dedupe', () => ({ findExistingContact, isUniqueViolation }))

const { dispatchInboundToFlows } = vi.hoisted(() => ({
  dispatchInboundToFlows: vi.fn(async () => ({ consumed: false })),
}))
vi.mock('@/lib/flows/engine', () => ({ dispatchInboundToFlows }))

const { runAutomationsForTrigger } = vi.hoisted(() => ({
  runAutomationsForTrigger: vi.fn(async () => undefined),
}))
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger }))

const { dispatchInboundToAiReply } = vi.hoisted(() => ({
  dispatchInboundToAiReply: vi.fn(async () => undefined),
}))
vi.mock('@/lib/ai/auto-reply', () => ({ dispatchInboundToAiReply }))

const { dispatchWebhookEvent } = vi.hoisted(() => ({
  dispatchWebhookEvent: vi.fn(async () => undefined),
}))
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent }))

vi.mock('@/lib/whatsapp/template-webhook', () => ({
  handleTemplateWebhookChange: vi.fn(async () => undefined),
  isTemplateWebhookField: vi.fn(() => false),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plaintext-token'),
  encrypt: vi.fn(() => 'enc-token'),
  isLegacyFormat: vi.fn(() => false),
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: vi.fn(async () => null),
}))

// Chainable Supabase mock — a fresh builder per `.from()` call reads the
// scenario state above at *call* time (not construction time), so the
// single `createClient()` result cached by the route's lazy
// `supabaseAdmin()` singleton still reflects per-test resets.
function builder(table: string) {
  // Booleans (not a single "mode" string) because the real chains call
  // `.insert(...).select().single()` — a trailing `.select()` after an
  // insert asks Supabase to return the row, it does NOT turn this into
  // a select query. Only the terminal booleans decide which branch wins.
  let didInsert = false
  let didUpdate = false
  let selectCountHead = false
  let insertPayload: Record<string, unknown> | null = null

  const b: Record<string, unknown> = {}
  const chain = () => b
  for (const m of ['eq', 'order', 'limit', 'in']) b[m] = vi.fn(chain)

  b.select = vi.fn((_cols?: string, opts?: { count?: string; head?: boolean }) => {
    if (opts?.head) selectCountHead = true
    return b
  })
  b.insert = vi.fn((payload: Record<string, unknown>) => {
    didInsert = true
    insertPayload = payload
    return b
  })
  b.update = vi.fn(() => {
    didUpdate = true
    return b
  })

  const resolveSelect = () => {
    switch (table) {
      case 'whatsapp_config':
        return { data: configRows, error: null }
      case 'conversations':
        return { data: existingConversationRow ? [existingConversationRow] : [], error: null }
      case 'broadcast_recipients':
        return { data: [], error: null }
      case 'messages':
        return selectCountHead
          ? { count: priorMessageCount, error: null }
          : { data: [], error: null }
      default:
        return { data: null, error: null }
    }
  }
  const resolveInsert = () => {
    if (table === 'contacts') {
      contactInserts.push(insertPayload!)
      return {
        data: { id: 'contact-new', account_id: ACCOUNT_ID, ...insertPayload },
        error: null,
      }
    }
    if (table === 'conversations') {
      conversationInserts.push(insertPayload!)
      return {
        data: { id: 'conv-new', account_id: ACCOUNT_ID, ...insertPayload },
        error: null,
      }
    }
    if (table === 'messages') {
      messageInserts.push(insertPayload!)
      return { data: { id: 'msg-new' }, error: null }
    }
    return { data: null, error: null }
  }
  const resolveUpdate = () => ({ data: null, error: null })

  const terminal = () =>
    Promise.resolve(didInsert ? resolveInsert() : didUpdate ? resolveUpdate() : resolveSelect())

  b.single = vi.fn(terminal)
  b.maybeSingle = vi.fn(terminal)
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    terminal().then(resolve, reject)
  return b
}

const supabaseMock = {
  from: vi.fn((table: string) => builder(table)),
  rpc: vi.fn(async () => ({ data: null, error: null })),
}

// The route calls `createClient()` from `@supabase/supabase-js` directly
// and caches the result in a module-level singleton — see the comment on
// `builder()` above for why per-test state lives in outer variables
// instead of swapping this mock object out.
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => supabaseMock),
}))

import { POST } from './route'

// The mock's inferred signature is a bare `() => Promise<undefined>`
// (its args are never asserted individually — only `.triggerType`,
// via this helper), so `.mock.calls` types as `[][]`. Cast once here
// instead of at every call site.
function dispatchedTriggerTypes(): string[] {
  return (
    runAutomationsForTrigger.mock.calls as unknown as Array<[{ triggerType: string }]>
  ).map((call) => call[0].triggerType)
}

function buildPayload(messageOverrides: Record<string, unknown> = {}) {
  return {
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+15550000000',
                phone_number_id: PHONE_NUMBER_ID,
              },
              contacts: [{ profile: { name: 'Jane Doe' }, wa_id: '15551234567' }],
              messages: [
                {
                  id: 'wamid.ABC123',
                  from: '15551234567',
                  timestamp: String(Math.floor(1755600000)),
                  type: 'text',
                  text: { body: 'Hola, necesito ayuda' },
                  ...messageOverrides,
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

function signedRequest(body: unknown, signature?: string) {
  const raw = JSON.stringify(body)
  const sig =
    signature ??
    'sha256=' + crypto.createHmac('sha256', META_APP_SECRET).update(raw).digest('hex')
  return new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
    body: raw,
  })
}

describe('POST /api/whatsapp/webhook', () => {
  beforeEach(() => {
    configRows = [CONFIG_ROW]
    existingConversationRow = null
    priorMessageCount = 0
    contactInserts.length = 0
    conversationInserts.length = 0
    messageInserts.length = 0
    pendingAfter = Promise.resolve()

    findExistingContact.mockResolvedValue(null)
    dispatchInboundToFlows.mockResolvedValue({ consumed: false })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('valida la firma, crea contacto+conversación nuevos, guarda el mensaje y despacha a flows/automations/IA', async () => {
    const res = await POST(signedRequest(buildPayload()))
    expect(res.status).toBe(200)
    await pendingAfter

    expect(contactInserts).toHaveLength(1)
    expect(contactInserts[0]).toMatchObject({
      account_id: ACCOUNT_ID,
      phone: '15551234567', // normalizePhone strips the '+'/spaces, keeps digits
      name: 'Jane Doe',
    })

    expect(conversationInserts).toHaveLength(1)
    expect(conversationInserts[0]).toMatchObject({
      account_id: ACCOUNT_ID,
      contact_id: 'contact-new',
    })

    expect(messageInserts).toHaveLength(1)
    expect(messageInserts[0]).toMatchObject({
      conversation_id: 'conv-new',
      sender_type: 'customer',
      content_type: 'text',
      content_text: 'Hola, necesito ayuda',
    })

    expect(dispatchInboundToFlows).toHaveBeenCalledTimes(1)

    const triggerTypes = dispatchedTriggerTypes()
    expect(triggerTypes).toEqual(
      expect.arrayContaining([
        'new_contact_created',
        'first_inbound_message',
        'new_message_received',
        'keyword_match',
      ]),
    )

    // A flow didn't consume the message, so the AI auto-reply path runs
    // too (its own internal eligibility gates decide whether it actually
    // replies — that's covered by ai/auto-reply's own test suite).
    expect(dispatchInboundToAiReply).toHaveBeenCalledTimes(1)

    expect(dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      ACCOUNT_ID,
      'conversation.created',
      expect.objectContaining({ contact_id: 'contact-new' }),
    )
  })

  it('cuando un Flow consume el mensaje, suprime new_message_received/keyword_match y no llama a la IA', async () => {
    findExistingContact.mockResolvedValue({
      id: 'contact-1',
      account_id: ACCOUNT_ID,
      name: 'Jane Doe',
      phone: '15551234567',
    })
    existingConversationRow = {
      id: 'conv-1',
      account_id: ACCOUNT_ID,
      contact_id: 'contact-1',
    }
    priorMessageCount = 3 // not the contact's first message
    dispatchInboundToFlows.mockResolvedValue({ consumed: true })

    const res = await POST(signedRequest(buildPayload()))
    expect(res.status).toBe(200)
    await pendingAfter

    // The message is still persisted regardless of who "handles" it.
    expect(messageInserts).toHaveLength(1)
    expect(contactInserts).toHaveLength(0) // reused the existing contact
    expect(conversationInserts).toHaveLength(0) // reused the existing conversation

    const triggerTypes = dispatchedTriggerTypes()
    expect(triggerTypes).not.toContain('new_message_received')
    expect(triggerTypes).not.toContain('keyword_match')

    expect(dispatchInboundToAiReply).not.toHaveBeenCalled()
  })

  it('rechaza con 401 cuando la firma HMAC no coincide y no procesa nada', async () => {
    const res = await POST(signedRequest(buildPayload(), 'sha256=' + '0'.repeat(64)))
    expect(res.status).toBe(401)
    await pendingAfter

    expect(messageInserts).toHaveLength(0)
    expect(contactInserts).toHaveLength(0)
    expect(dispatchInboundToFlows).not.toHaveBeenCalled()
    expect(runAutomationsForTrigger).not.toHaveBeenCalled()
  })
})

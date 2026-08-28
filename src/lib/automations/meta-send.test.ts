import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================
// meta-send.ts is the automation engine's only path to actually send a
// WhatsApp message. Two things matter most here:
//   1. Tenant isolation — a contact_id from another account must never
//      resolve (see the account_id filter comment in the source).
//   2. The phone-variant retry + persistence side effects (message
//      insert, conversation last-message update, contact phone
//      self-heal) actually happen in the right order with the right
//      data.
// ============================================================

const h = vi.hoisted(() => ({
  state: {
    contactRow: null as { id: string; phone: string } | null,
    configRow: null as Record<string, unknown> | null,
    messageInserts: [] as Record<string, unknown>[],
    conversationUpdates: [] as Record<string, unknown>[],
    contactUpdates: [] as { id: string; payload: Record<string, unknown> }[],
  },
}))

vi.mock('./admin-client', () => {
  const { state } = h
  return {
    supabaseAdmin: () => ({
      from: (table: string) => {
        const b: Record<string, unknown> = {}
        const chain = () => b
        b.eq = vi.fn(chain)
        b.select = vi.fn(chain)
        b.single = vi.fn(() =>
          Promise.resolve(
            table === 'whatsapp_config'
              ? { data: state.configRow, error: state.configRow ? null : { message: 'not found' } }
              : { data: null, error: null },
          ),
        )
        b.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: table === 'contacts' ? state.contactRow : null, error: null }),
        )
        b.insert = vi.fn((payload: Record<string, unknown>) => {
          if (table === 'messages') state.messageInserts.push(payload)
          return Promise.resolve({ error: null })
        })
        b.update = vi.fn((payload: Record<string, unknown>) => {
          if (table === 'conversations') state.conversationUpdates.push(payload)
          if (table === 'contacts') {
            // The real chain is `.update(payload).eq('id', contact.id)` —
            // capture the id off the next `.eq()` call.
            const origEq = b.eq as (col: string, id: string) => unknown
            b.eq = vi.fn((_col: string, id: string) => {
              state.contactUpdates.push({ id, payload })
              return origEq(_col, id)
            })
          }
          return b
        })
        return b
      },
    }),
  }
})

const { sendTextMessage, sendTemplateMessage } = vi.hoisted(() => ({
  sendTextMessage: vi.fn(),
  sendTemplateMessage: vi.fn(),
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({ sendTextMessage, sendTemplateMessage }))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plaintext-token'),
}))

vi.mock('@/lib/flows/meta-send', () => ({
  engineSendInteractiveButtons: vi.fn(),
  engineSendInteractiveList: vi.fn(),
}))

import { engineSendText, engineSendTemplate } from './meta-send'

const CONFIG_ROW = {
  id: 'cfg-1',
  account_id: 'acct-1',
  phone_number_id: 'PNID-1',
  access_token: 'enc-token',
}

describe('engineSendText / engineSendTemplate — tenant isolation', () => {
  beforeEach(() => {
    h.state.contactRow = null
    h.state.configRow = CONFIG_ROW
    h.state.messageInserts = []
    h.state.conversationUpdates = []
    h.state.contactUpdates = []
    sendTextMessage.mockReset()
    sendTemplateMessage.mockReset()
  })

  it('refuses to send when the contact does not resolve under this account_id', async () => {
    h.state.contactRow = null // simulates a contact_id from a different account

    await expect(
      engineSendText({
        accountId: 'acct-1',
        userId: 'user-1',
        conversationId: 'conv-1',
        contactId: 'contact-from-another-account',
        text: 'hi',
      }),
    ).rejects.toThrow('contact not found for this account')

    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  it('refuses to send to a contact with an invalid phone', async () => {
    h.state.contactRow = { id: 'contact-1', phone: 'not-a-phone' }

    await expect(
      engineSendText({
        accountId: 'acct-1',
        userId: 'user-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        text: 'hi',
      }),
    ).rejects.toThrow(/invalid/)

    expect(sendTextMessage).not.toHaveBeenCalled()
  })
})

describe('engineSendText — happy path', () => {
  beforeEach(() => {
    h.state.contactRow = { id: 'contact-1', phone: '+15551234567' }
    h.state.configRow = CONFIG_ROW
    h.state.messageInserts = []
    h.state.conversationUpdates = []
    h.state.contactUpdates = []
    sendTextMessage.mockReset()
    sendTemplateMessage.mockReset()
  })

  it('sends on the first attempt, persists the message as sender_type bot, and updates the conversation preview', async () => {
    sendTextMessage.mockResolvedValue({ messageId: 'wamid-1' })

    const result = await engineSendText({
      accountId: 'acct-1',
      userId: 'user-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      text: 'Your order shipped',
    })

    expect(result.whatsapp_message_id).toBe('wamid-1')
    expect(sendTextMessage).toHaveBeenCalledTimes(1)
    expect(sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumberId: 'PNID-1', to: '15551234567', text: 'Your order shipped' }),
    )

    expect(h.state.messageInserts).toHaveLength(1)
    expect(h.state.messageInserts[0]).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'bot',
      content_type: 'text',
      content_text: 'Your order shipped',
      message_id: 'wamid-1',
    })

    expect(h.state.conversationUpdates).toHaveLength(1)
    expect(h.state.conversationUpdates[0]).toMatchObject({
      last_message_text: 'Your order shipped',
    })

    // First attempt worked — no phone self-heal needed.
    expect(h.state.contactUpdates).toHaveLength(0)
  })

  it('retries with a phone variant when Meta rejects the first as "not in allowed list", then self-heals the stored number', async () => {
    sendTextMessage
      .mockRejectedValueOnce(new Error('#131030 Recipient phone number not in allowed list'))
      .mockResolvedValueOnce({ messageId: 'wamid-2' })

    const result = await engineSendText({
      accountId: 'acct-1',
      userId: 'user-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      text: 'hi again',
    })

    expect(result.whatsapp_message_id).toBe('wamid-2')
    expect(sendTextMessage).toHaveBeenCalledTimes(2)
    const [firstTo, secondTo] = sendTextMessage.mock.calls.map(
      (c) => (c[0] as { to: string }).to,
    )
    expect(firstTo).not.toBe(secondTo)

    // The working (second) variant got written back onto the contact.
    expect(h.state.contactUpdates).toHaveLength(1)
    expect(h.state.contactUpdates[0]).toMatchObject({ id: 'contact-1' })
    expect((h.state.contactUpdates[0].payload as { phone: string }).phone).toBe(secondTo)
  })

  it('gives up and throws once every phone variant is rejected', async () => {
    sendTextMessage.mockRejectedValue(
      new Error('#131030 Recipient phone number not in allowed list'),
    )

    await expect(
      engineSendText({
        accountId: 'acct-1',
        userId: 'user-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        text: 'hi',
      }),
    ).rejects.toThrow(/131030/)

    expect(h.state.messageInserts).toHaveLength(0)
  })

  it('propagates a non-"not allowed" Meta error immediately without retrying other variants', async () => {
    sendTextMessage.mockRejectedValue(new Error('rate limited'))

    await expect(
      engineSendText({
        accountId: 'acct-1',
        userId: 'user-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        text: 'hi',
      }),
    ).rejects.toThrow('rate limited')

    expect(sendTextMessage).toHaveBeenCalledTimes(1)
  })
})

describe('engineSendTemplate — happy path', () => {
  beforeEach(() => {
    h.state.contactRow = { id: 'contact-1', phone: '+15551234567' }
    h.state.configRow = CONFIG_ROW
    h.state.messageInserts = []
    sendTemplateMessage.mockReset()
  })

  it('sends the template and persists content_type=template with no content_text', async () => {
    sendTemplateMessage.mockResolvedValue({ messageId: 'wamid-3' })

    const result = await engineSendTemplate({
      accountId: 'acct-1',
      userId: 'user-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      templateName: 'order_update',
      language: 'en_US',
      params: ['Acme', '#1234'],
    })

    expect(result.whatsapp_message_id).toBe('wamid-3')
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: 'order_update', language: 'en_US' }),
    )
    expect(h.state.messageInserts[0]).toMatchObject({
      content_type: 'template',
      content_text: null,
      template_name: 'order_update',
    })
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================
// steps-tree.ts converts between the builder UI's nested shape
// (Condition steps carry `branches: { yes, no }`) and the flat
// `automation_steps` table (`parent_step_id` + `branch` columns) in
// both directions. A bug here silently misfiles a step into the wrong
// branch or drops it — the automation then runs differently than what
// the user built, with nothing in the UI to suggest why.
// ============================================================

const h = vi.hoisted(() => ({
  state: {
    inserted: [] as Record<string, unknown>[],
    deletedFor: [] as string[],
    deleteError: null as { message: string } | null,
    insertError: null as { message: string } | null,
    loadRows: [] as Record<string, unknown>[],
  },
}))

vi.mock('./admin-client', () => {
  const { state } = h
  return {
    supabaseAdmin: () => ({
      from: (table: string) => {
        if (table !== 'automation_steps') throw new Error(`unexpected table: ${table}`)
        let isSelect = false
        let deleteTarget: string | null = null
        const b: Record<string, unknown> = {}
        b.delete = vi.fn(() => b)
        b.select = vi.fn(() => {
          isSelect = true
          return b
        })
        b.order = vi.fn(() => b)
        b.eq = vi.fn((_col: string, val: string) => {
          if (!isSelect) deleteTarget = val
          return b
        })
        b.insert = vi.fn((rows: Record<string, unknown>[]) => {
          state.inserted.push(...rows)
          return Promise.resolve({ error: state.insertError })
        })
        // `.select().eq().order()` (load) and `.delete().eq()` (replace)
        // are both awaited directly with no further terminal call.
        b.then = (resolve: (v: unknown) => unknown) => {
          if (isSelect) return resolve({ data: state.loadRows, error: null })
          if (deleteTarget) state.deletedFor.push(deleteTarget)
          return resolve({ error: state.deleteError })
        }
        return b
      },
    }),
  }
})

import { insertSteps, replaceSteps, loadStepsTree, type BuilderStepInput } from './steps-tree'

describe('insertSteps — nested (builder) input', () => {
  beforeEach(() => {
    h.state.inserted = []
    h.state.deletedFor = []
    h.state.deleteError = null
    h.state.insertError = null
  })

  it('flattens a Condition step with both branches into parent/branch/position rows', async () => {
    const input: BuilderStepInput[] = [
      { step_type: 'send_message', step_config: { text: 'hi' } },
      {
        step_type: 'condition',
        step_config: { field: 'tag', op: 'has', value: 'vip' },
        branches: {
          yes: [{ step_type: 'send_message', step_config: { text: 'vip path' } }],
          no: [
            { step_type: 'send_message', step_config: { text: 'no1' } },
            { step_type: 'send_message', step_config: { text: 'no2' } },
          ],
        },
      },
    ]

    const err = await insertSteps('auto-1', input)
    expect(err).toBeNull()

    const rows = h.state.inserted
    expect(rows).toHaveLength(5) // 2 roots (send_message + condition) + 1 yes child + 2 no children

    const root1 = rows.find((r) => r.step_config && (r.step_config as { text?: string }).text === 'hi')!
    const conditionRow = rows.find((r) => r.step_type === 'condition')!
    const yesRow = rows.find(
      (r) => (r.step_config as { text?: string }).text === 'vip path',
    )!
    const noRows = rows.filter((r) => r.branch === 'no')

    expect(root1.parent_step_id).toBeNull()
    expect(root1.position).toBe(0)
    expect(conditionRow.position).toBe(1)
    expect(conditionRow.parent_step_id).toBeNull()

    expect(yesRow.parent_step_id).toBe(conditionRow.id)
    expect(yesRow.branch).toBe('yes')

    expect(noRows).toHaveLength(2)
    expect(noRows.every((r) => r.parent_step_id === conditionRow.id)).toBe(true)
    expect(noRows.map((r) => r.position)).toEqual([0, 1]) // position resets per branch
  })

  it('returns null and never calls insert for an empty step list', async () => {
    const err = await insertSteps('auto-1', [])
    expect(err).toBeNull()
    expect(h.state.inserted).toHaveLength(0)
  })

  it('surfaces the insert error message instead of throwing', async () => {
    h.state.insertError = { message: 'automation_id fkey violation' }
    const err = await insertSteps('auto-missing', [
      { step_type: 'send_message', step_config: {} },
    ])
    expect(err).toBe('automation_id fkey violation')
  })
})

describe('insertSteps — legacy flat seed input (template seeds)', () => {
  beforeEach(() => {
    h.state.inserted = []
    h.state.insertError = null
  })

  it('rebuilds the tree from parent_index/branch before inserting', async () => {
    // Mirrors a TemplateStepSeed list: a Condition at index 0, with a
    // "yes" child pointing back at parent_index 0.
    const input: BuilderStepInput[] = [
      { step_type: 'condition', step_config: {}, branch: null, parent_index: null },
      {
        step_type: 'send_message',
        step_config: { text: 'qualified' },
        branch: 'yes',
        parent_index: 0,
      },
      {
        step_type: 'send_message',
        step_config: { text: 'not qualified' },
        branch: 'no',
        parent_index: 0,
      },
    ]

    await insertSteps('auto-2', input)

    const rows = h.state.inserted
    const conditionRow = rows.find((r) => r.step_type === 'condition')!
    const yes = rows.find((r) => (r.step_config as { text?: string }).text === 'qualified')!
    const no = rows.find(
      (r) => (r.step_config as { text?: string }).text === 'not qualified',
    )!

    expect(conditionRow.parent_step_id).toBeNull()
    expect(yes.parent_step_id).toBe(conditionRow.id)
    expect(yes.branch).toBe('yes')
    expect(no.parent_step_id).toBe(conditionRow.id)
    expect(no.branch).toBe('no')
  })
})

describe('replaceSteps', () => {
  beforeEach(() => {
    h.state.inserted = []
    h.state.deletedFor = []
    h.state.deleteError = null
  })

  it('deletes the automation’s existing steps before inserting the new set', async () => {
    await replaceSteps('auto-3', [{ step_type: 'send_message', step_config: {} }])
    expect(h.state.deletedFor).toEqual(['auto-3'])
    expect(h.state.inserted).toHaveLength(1)
  })

  it('stops and returns the error without inserting when the delete fails', async () => {
    h.state.deleteError = { message: 'permission denied' }
    const err = await replaceSteps('auto-3', [
      { step_type: 'send_message', step_config: {} },
    ])
    expect(err).toBe('permission denied')
    expect(h.state.inserted).toHaveLength(0)
  })
})

describe('loadStepsTree', () => {
  beforeEach(() => {
    h.state.loadRows = []
  })

  it('reassembles flat rows into the nested branches shape', async () => {
    h.state.loadRows = [
      {
        id: 'root-1',
        parent_step_id: null,
        branch: null,
        step_type: 'condition',
        step_config: {},
        position: 0,
      },
      {
        id: 'child-yes',
        parent_step_id: 'root-1',
        branch: 'yes',
        step_type: 'send_message',
        step_config: { text: 'yes path' },
        position: 0,
      },
      {
        id: 'child-no',
        parent_step_id: 'root-1',
        branch: 'no',
        step_type: 'send_message',
        step_config: { text: 'no path' },
        position: 0,
      },
    ]

    const tree = await loadStepsTree('auto-1')
    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe('root-1')
    expect(tree[0].branches.yes).toHaveLength(1)
    expect(tree[0].branches.yes[0].id).toBe('child-yes')
    expect(tree[0].branches.no).toHaveLength(1)
    expect(tree[0].branches.no[0].id).toBe('child-no')
  })

  it('drops a child silently rather than throwing when its parent_step_id is missing', async () => {
    h.state.loadRows = [
      {
        id: 'orphan',
        parent_step_id: 'does-not-exist',
        branch: 'yes',
        step_type: 'send_message',
        step_config: {},
        position: 0,
      },
    ]

    const tree = await loadStepsTree('auto-1')
    // Not a root (it has a parent_step_id) and its parent was never
    // found, so it's neither returned as a root nor attached anywhere.
    expect(tree).toHaveLength(0)
  })
})

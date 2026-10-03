import type { EntryRow } from '@/data/types'

// 瞭望台运行状态机：状态、动作、合法迁移、统计口径的唯一事实来源。
// 值班、故障、恢复不再各写一份——页面按钮、旧记录迁移、装备待归还台账、
// 统计卡片全部从这一份派生；不在这份表里的 (状态, 动作) 组合一律不允许落地。

export const LOOKOUT_MODULE_KEY = 'lookout'

export const LOOKOUT_STATES = ['正常值守', '临时关闭', '设备故障', '维修中'] as const
export type LookoutState = (typeof LOOKOUT_STATES)[number]

export const LOOKOUT_ACTIONS = ['记录值守', '登记故障', '关闭瞭望台', '开始维修', '确认恢复'] as const
export type LookoutAction = (typeof LOOKOUT_ACTIONS)[number]

export type LookoutTransition = {
  action: LookoutAction
  from: readonly LookoutState[]
  to: LookoutState
  /** true = 状态不变的交接登记（值守打卡）：只追加交接档案，不改行、不占用版本号 */
  handoverOnly?: boolean
}

export const LOOKOUT_TRANSITIONS: readonly LookoutTransition[] = [
  { action: '记录值守', from: ['正常值守'], to: '正常值守', handoverOnly: true },
  { action: '记录值守', from: ['临时关闭'], to: '正常值守' },
  { action: '登记故障', from: ['正常值守'], to: '设备故障' },
  { action: '关闭瞭望台', from: ['正常值守'], to: '临时关闭' },
  { action: '开始维修', from: ['设备故障'], to: '维修中' },
  // 恢复条件：必须先在「维修中」，从「设备故障」直接恢复会被拦截
  { action: '确认恢复', from: ['维修中'], to: '正常值守' },
]

/** 装备待归还台账口径：瞭望台处于这些状态时，名下「已领用」装备应挂在台账上。 */
export const PENDING_RETURN_STATES: readonly LookoutState[] = ['临时关闭', '设备故障', '维修中']

export function isLookoutAction(action: string): action is LookoutAction {
  return (LOOKOUT_ACTIONS as readonly string[]).includes(action)
}

/** 旧记录状态归一：认识的原样返回，不认识的返回 null，由调用方决定兜底。 */
export function normalizeLookoutState(status: unknown): LookoutState | null {
  const text = String(status ?? '')
  return (LOOKOUT_STATES as readonly string[]).includes(text) ? (text as LookoutState) : null
}

export function findTransition(state: LookoutState, action: LookoutAction): LookoutTransition | null {
  return (
    LOOKOUT_TRANSITIONS.find((item) => item.action === action && item.from.includes(state)) ?? null
  )
}

export function availableActions(state: LookoutState): LookoutAction[] {
  return LOOKOUT_TRANSITIONS.filter((item) => item.from.includes(state)).map((item) => item.action)
}

export function expectedFromStates(action: LookoutAction): LookoutState[] {
  const states = LOOKOUT_TRANSITIONS.filter((item) => item.action === action).flatMap((item) => [
    ...item.from,
  ])
  return [...new Set(states)]
}

/** 行上的 pending / abnormal 由状态派生：待跟进 = 还没回到值守；异常 = 故障未恢复（含维修中）。 */
export function deriveFlags(state: LookoutState): { pending: boolean; abnormal: boolean } {
  return {
    pending: state !== '正常值守',
    abnormal: state === '设备故障' || state === '维修中',
  }
}

export type LedgerEffect = 'markPendingReturn' | 'clearPendingReturn' | 'none'

/** 台账联动方向由迁移两端的状态派生，不在迁移表里另写一份。 */
export function deriveLedgerEffect(from: LookoutState, to: LookoutState): LedgerEffect {
  const wasHeld = PENDING_RETURN_STATES.includes(from)
  const willHold = PENDING_RETURN_STATES.includes(to)
  if (!wasHeld && willHold) {
    return 'markPendingReturn'
  }
  if (wasHeld && !willHold) {
    return 'clearPendingReturn'
  }
  return 'none'
}

export type LookoutSummary = {
  total: number
  byStatus: Record<LookoutState, number>
  metrics: { label: string; value: number }[]
}

/** 统计只认这一份：故障台数含「维修中」（故障未恢复），恢复条件调整时不用改第二处。 */
export function summarizeLookouts(rows: EntryRow[]): LookoutSummary {
  const byStatus = Object.fromEntries(
    LOOKOUT_STATES.map((state) => [state, 0]),
  ) as Record<LookoutState, number>
  for (const row of rows) {
    const state = normalizeLookoutState(row.status)
    if (state) {
      byStatus[state] += 1
    }
  }
  return {
    total: rows.length,
    byStatus,
    metrics: [
      { label: '瞭望台总数', value: rows.length },
      { label: '正常值守数', value: byStatus['正常值守'] },
      { label: '故障台数', value: byStatus['设备故障'] + byStatus['维修中'] },
    ],
  }
}

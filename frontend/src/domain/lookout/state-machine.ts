import type { LookoutEvent } from './types'

/**
 * 瞭望台运行状态机：全系统唯一的状态口径。
 * 以前值班（记录值守）、故障（登记故障）、恢复各写一份，统计恢复时容易漏条件；
 * 现在「有哪些状态、每个动作允许从哪到哪、怎么算待处理/异常、怎么统计」都集中在这一份里。
 */

export const LOOKOUT_KEY = 'lookout'
export const STATE_VERSION = 2

// 状态：运行中的只有「正常值守」；故障必须先进「维修中」，修好走「恢复值守」才算恢复。
export const LOOKOUT_STATUSES = [
  '正常值守',
  '临时关闭',
  '设备故障',
  '维修中',
] as const

export type LookoutStatus = (typeof LOOKOUT_STATUSES)[number]

export const ACTIONS = [
  '记录值守', // 重新开放
  '登记故障',
  '安排维修',
  '恢复值守', // 恢复条件：只有维修完成后才允许
  '关闭瞭望台',
] as const

export type LookoutAction = (typeof ACTIONS)[number]

// 合法流转表：from -> 允许落地的 (动作, 目标状态)。表外一律拦截。
type AllowedTransition = { action: LookoutAction; to: LookoutStatus }
const TRANSITIONS: Record<LookoutStatus, AllowedTransition[]> = {
  正常值守: [
    { action: '登记故障', to: '设备故障' },
    { action: '关闭瞭望台', to: '临时关闭' },
  ],
  临时关闭: [
    { action: '记录值守', to: '正常值守' },
  ],
  设备故障: [
    // 故障不能通过「先关闭再重启」绕过维修：关闭只允许在正常值守时执行。
    { action: '安排维修', to: '维修中' },
  ],
  维修中: [
    { action: '恢复值守', to: '正常值守' },
    { action: '登记故障', to: '设备故障' }, // 维修未排除，退回故障
  ],
}

export type TransitionPlan = {
  to: LookoutStatus
  kind: LookoutEvent['kind']
}

// 查某个状态下某动作是否合法；返回落地目标与事件类别，非法返回 null。
export function planTransition(
  from: string,
  action: string,
): TransitionPlan | null {
  if (!LOOKOUT_STATUSES.includes(from as LookoutStatus)) {
    return null
  }
  const hit = TRANSITIONS[from as LookoutStatus].find((item) => item.action === action)
  if (!hit) {
    return null
  }
  return { to: hit.to, kind: eventKind(action) }
}

// 当前状态下所有可执行动作——页面只渲染合法入口，服务端再用同一张表兜底。
export function legalActions(status: string): LookoutAction[] {
  if (!LOOKOUT_STATUSES.includes(status as LookoutStatus)) {
    return []
  }
  return TRANSITIONS[status as LookoutStatus].map((item) => item.action)
}

function eventKind(action: string): LookoutEvent['kind'] {
  switch (action) {
    case '记录值守':
      return 'reopen'
    case '登记故障':
      return 'fault'
    case '安排维修':
      return 'repair'
    case '恢复值守':
      return 'recovery'
    case '关闭瞭望台':
      return 'close'
    default:
      return 'duty'
  }
}

// 待处理：只有正常值守是稳态；临时关闭是有计划的停用，不算异常。
export function isPending(status: string): boolean {
  return status !== '正常值守'
}

export function isAbnormal(status: string): boolean {
  return status === '设备故障' || status === '维修中'
}

export type LookoutStats = {
  total: number
  onDuty: number
  fault: number // 设备故障 + 维修中，和看板「故障台数」口径一致
  closed: number
  recovered: number // 历史上完成「恢复值守」的次数——从交接记录统计，恢复条件不会再被漏掉
  pendingReturns: number
}

export type LookoutStatsInput = {
  status: string
  events?: LookoutEvent[]
  pendingReturn?: boolean
}

// 唯一统计口径：状态计数看当前状态，恢复计数看历史事件。
export function summarizeLookouts(rows: LookoutStatsInput[]): LookoutStats {
  const stats: LookoutStats = {
    total: rows.length,
    onDuty: 0,
    fault: 0,
    closed: 0,
    recovered: 0,
    pendingReturns: 0,
  }
  for (const row of rows) {
    if (row.status === '正常值守') {
      stats.onDuty += 1
    } else if (row.status === '设备故障' || row.status === '维修中') {
      stats.fault += 1
    } else if (row.status === '临时关闭') {
      stats.closed += 1
    }
    if (row.events?.some((event) => event.kind === 'recovery')) {
      stats.recovered += 1
    }
    if (row.pendingReturn) {
      stats.pendingReturns += 1
    }
  }
  return stats
}

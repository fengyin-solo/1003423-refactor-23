import {
  commitCollections,
  getCollection,
  listRows,
} from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'
import {
  reconcileReturnLedger,
  RETURNS_COLLECTION,
} from './equipment-returns'
import {
  ACTIONS,
  isAbnormal,
  isPending,
  legalActions,
  LOOKOUT_KEY,
  planTransition,
} from './state-machine'
import type { EquipmentReturnEntry, LookoutEvent } from './types'
import { nowStamp } from './migration'

/**
 * 瞭望台动作落地：统一入口，值班 / 故障 / 恢复都只走这一条事务。
 * 两道闸保证「只允许合法路径落地」：
 * 1. 状态机合法流转表拦截非法路径（含遗漏的恢复条件）；
 * 2. rowVersion 乐观锁（CAS）——两个动作并发改同一座台时，
 *    先提交的版本号 +1，后提交的因版本不符被拒，不会覆盖前者的结果。
 * 瞭望台与装备待归还台账在同一次提交里原子写入。
 */

export type LookoutActionContext = {
  id: number
  action: string
  expectedVersion?: number
}

export function runLookoutAction(context: LookoutActionContext): ActionResult {
  const { id, action } = context
  if (!(ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, message: `瞭望台没有登记「${action}」这个动作` }
  }

  const lookouts = listRows(LOOKOUT_KEY)
  const index = lookouts.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的瞭望台` }
  }

  const current = lookouts[index]
  const currentVersion = typeof current.rowVersion === 'number' ? current.rowVersion : 1
  if (
    typeof context.expectedVersion === 'number' &&
    context.expectedVersion !== currentVersion
  ) {
    return {
      ok: false,
      message: `该瞭望台状态已被其他操作更新（当前版本 ${currentVersion}），请刷新后再操作`,
    }
  }

  const from = String(current.status)
  const plan = planTransition(from, action)
  if (!plan) {
    const allowed = legalActions(from)
    const hint = allowed.length ? `，当前只允许：${allowed.join('、')}` : ''
    return {
      ok: false,
      message: `瞭望台处于「${from}」时不能执行「${action}」${hint}`,
    }
  }

  const events: LookoutEvent[] = Array.isArray(current.events)
    ? (current.events as LookoutEvent[])
    : []
  const at = nowStamp()
  const event: LookoutEvent = {
    seq: events.length + 1,
    at,
    action,
    from,
    to: plan.to,
    kind: plan.kind,
  }

  const updated: EntryRow = {
    ...current,
    status: plan.to,
    pending: isPending(plan.to),
    abnormal: isAbnormal(plan.to),
    events: [...events, event],
    rowVersion: currentVersion + 1,
  }
  updated['运行状态'] = plan.to

  const nextLookouts = [...lookouts]
  nextLookouts[index] = updated

  const ledger = getCollection<EquipmentReturnEntry>(RETURNS_COLLECTION)
  const { ledger: nextLedger } = reconcileReturnLedger(
    nextLookouts,
    ledger,
    () => at,
  )

  // 一次原子提交：瞭望台状态、交接记录、装备台账要么一起落地，要么都不落地。
  commitCollections({
    [LOOKOUT_KEY]: nextLookouts,
    [RETURNS_COLLECTION]: nextLedger,
  })

  return { ok: true, message: `瞭望台已${action}，当前状态「${plan.to}」` }
}

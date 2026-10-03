import {
  LOOKOUT_MODULE_KEY,
  deriveFlags,
  deriveLedgerEffect,
  expectedFromStates,
  findTransition,
  isLookoutAction,
  normalizeLookoutState,
  type LookoutState,
} from '@/domain/lookout/lifecycle'
import { loadSnapshot, transact } from '@/data/local-store'
import type { ActionResult, HandoverRecord, StorageSnapshot } from '@/data/types'

// 瞭望台状态流转的统一入口：值班、故障、恢复都走这里，不再各写一份。
// 落地前过三道闸：动作已登记 → revision 没被别人改过（并发防护）→
// (当前状态, 动作) 在合法迁移表里。三道都过，才在同一个事务里写：
// 瞭望台行 + 交接档案 + 装备待归还台账，要么一起落地要么都不落。

const EQUIPMENT_MODULE_KEY = 'equipment'

export type LookoutTransitionInput = {
  id: number
  action: string
  /** 发起动作时读到的行版本号：对不上说明期间已被其他操作变更 */
  expectedRevision: number
  operator: string
  note?: string
}

type LockManagerLike = {
  request<T>(name: string, callback: () => T | Promise<T>): Promise<T>
}

function lockManager(): LockManagerLike | null {
  if (typeof navigator === 'undefined') {
    return null
  }
  const candidate = (navigator as { locks?: LockManagerLike }).locks
  return candidate && typeof candidate.request === 'function' ? candidate : null
}

// 每座瞭望台一条锁链：Web Locks 可用时跨页签互斥；不可用时退化为页内 Promise 链，
// 页签间再由 revision 乐观校验兜底——并发动作只有一个能落地。
const localChains = new Map<number, Promise<unknown>>()

function withTowerLock<T>(towerId: number, task: () => T): Promise<T> {
  const locks = lockManager()
  if (locks) {
    return locks.request(`forest-fire-patrol:lookout:${towerId}`, () => task())
  }
  const previous = localChains.get(towerId) ?? Promise.resolve()
  const result = previous.then(() => task())
  localChains.set(
    towerId,
    result.catch(() => undefined),
  )
  return result
}

export async function applyLookoutTransition(input: LookoutTransitionInput): Promise<ActionResult> {
  if (!isLookoutAction(input.action)) {
    return { ok: false, message: `瞭望台没有登记「${input.action}」这个动作` }
  }
  const action = input.action
  return withTowerLock(input.id, () =>
    transact<ActionResult>((snapshot) => {
      const rows = snapshot.entries[LOOKOUT_MODULE_KEY] ?? []
      const index = rows.findIndex((row) => Number(row.id) === input.id)
      if (index < 0) {
        return { ok: false, message: `没有找到编号为 ${input.id} 的瞭望台` }
      }
      const row = rows[index]
      const revision = Number(row.revision ?? 0)
      if (revision !== input.expectedRevision) {
        return { ok: false, message: '这座瞭望台刚被其他操作变更，请刷新后基于最新状态重试' }
      }
      const state = normalizeLookoutState(row.status)
      if (!state) {
        return {
          ok: false,
          message: `瞭望台当前状态「${String(row.status)}」无法识别，请先完成数据迁移`,
        }
      }
      const transition = findTransition(state, action)
      if (!transition) {
        const expects = expectedFromStates(action)
          .map((item) => `「${item}」`)
          .join('、')
        return { ok: false, message: `「${action}」只能在${expects}下发起，当前是「${state}」` }
      }
      if (!transition.handoverOnly) {
        const nextRows = [...rows]
        nextRows[index] = {
          ...row,
          status: transition.to,
          ...deriveFlags(transition.to),
          revision: revision + 1,
        }
        snapshot.entries[LOOKOUT_MODULE_KEY] = nextRows
        applyLedgerEffect(snapshot, String(row['瞭望台编号'] ?? ''), state, transition.to)
      }
      snapshot.lookoutHandover.push({
        seq: nextHandoverSeq(snapshot),
        towerId: input.id,
        towerCode: String(row['瞭望台编号'] ?? ''),
        action,
        fromStatus: state,
        toStatus: transition.to,
        operator: input.operator,
        at: new Date().toISOString(),
        note:
          input.note?.trim() ||
          (transition.handoverOnly ? '值守交接登记' : `${state} → ${transition.to}`),
      })
      return { ok: true, message: `瞭望台已${action}，当前状态「${transition.to}」` }
    }),
  )
}

export function listLookoutHandover(towerId: number): HandoverRecord[] {
  return loadSnapshot()
    .lookoutHandover.filter((record) => record.towerId === towerId)
    .slice()
    .sort((a, b) => b.seq - a.seq)
}

function nextHandoverSeq(snapshot: StorageSnapshot): number {
  return snapshot.lookoutHandover.reduce((max, record) => Math.max(max, record.seq), 0) + 1
}

/** 装备待归还台账联动：与瞭望台行写在同一个事务里，口径由状态机派生。 */
function applyLedgerEffect(
  snapshot: StorageSnapshot,
  towerCode: string,
  from: LookoutState,
  to: LookoutState,
): void {
  const effect = deriveLedgerEffect(from, to)
  const equipment = snapshot.entries[EQUIPMENT_MODULE_KEY]
  if (effect === 'none' || !towerCode || !equipment) {
    return
  }
  const mark = effect === 'markPendingReturn'
  snapshot.entries[EQUIPMENT_MODULE_KEY] = equipment.map((item) => {
    if (String(item['配属瞭望台'] ?? '') !== towerCode) {
      return item
    }
    if (mark && String(item.status) !== '已领用') {
      return item // 只有领用中的装备才挂账
    }
    if (Boolean(item['待归还']) === mark) {
      return item
    }
    return { ...item, '待归还': mark }
  })
}

import {
  applyMigrations,
  commitCollections,
  getCollection,
  listRows,
  registerResetHook,
} from '@/data/local-store'
import { SEED_ROWS } from '@/data/seed'
import type { EntryRow } from '@/data/types'
import {
  reconcileReturnLedger,
  RETURNS_COLLECTION,
} from './equipment-returns'
import {
  ACTIONS,
  isAbnormal,
  isPending,
  LOOKOUT_KEY,
  LOOKOUT_STATUSES,
  STATE_VERSION,
} from './state-machine'
import type { EquipmentReturnEntry, LookoutEvent } from './types'

/**
 * 瞭望台旧记录迁移与历史交接保留。
 * 不是简单合并函数：v1 的平铺记录会被逐条归一到统一状态机，
 * 迁移前的状态以「交接事件」形式完整留在每座台的时间线上（只增不删），
 * 同时按当前状态对账装备待归还台账；整个过程幂等，可重复执行。
 */

export function nowStamp(): string {
  return new Date().toISOString()
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

type InitContext = 'migrate' | 'init'

function asEventList(row: EntryRow): LookoutEvent[] {
  const raw = row.events
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter(
    (item): item is LookoutEvent =>
      typeof item === 'object' && item !== null && 'seq' in item && 'to' in item,
  )
}

// 把任意来源的一条瞭望台记录归一成统一状态机格式。
export function normalizeLookoutRow(
  source: EntryRow,
  context: InitContext,
  at: string,
): EntryRow {
  const row: EntryRow = { ...source }
  const originalStatus = String(row.status ?? '')
  const known = (LOOKOUT_STATUSES as readonly string[]).includes(originalStatus)
  if (!known) {
    // 旧数据里状态口径外的值不能丢：落到正常值守并在交接记录里留痕。
    row.status = '正常值守'
  }

  const events = asEventList(row)
  if (events.length === 0) {
    const event: LookoutEvent =
      context === 'migrate'
        ? {
            seq: 1,
            at,
            action: '旧记录迁移',
            from: originalStatus || '（原状态为空）',
            to: row.status,
            kind: 'migration',
            note: known
              ? '按统一瞭望台状态机迁移，原状态保留在交接记录中'
              : '旧状态不在统一状态口径内，迁移为正常值守',
          }
        : {
            seq: 1,
            at,
            action: '初始登记',
            from: row.status,
            to: row.status,
            kind: 'duty',
            note: '按统一状态机登记初始状态',
          }
    events.push(event)
  }

  row.events = events
  row.rowVersion = typeof row.rowVersion === 'number' ? row.rowVersion : 1
  row['运行状态'] = row.status
  row.pending = isPending(row.status)
  row.abnormal = isAbnormal(row.status)
  return row
}

// 归一一批记录，并补齐台账；返回可一次提交的集合补丁。
function buildLookoutPatch(
  sources: EntryRow[],
  context: InitContext,
  existingLedger: EquipmentReturnEntry[],
): Record<string, unknown[]> {
  const at = nowStamp()
  const lookouts = sources.map((row) => normalizeLookoutRow(row, context, at))
  const { ledger } = reconcileReturnLedger(
    lookouts,
    existingLedger,
    nowStamp,
    context === 'migrate' ? '历史记录迁移对账' : undefined,
  )
  return { [LOOKOUT_KEY]: lookouts, [RETURNS_COLLECTION]: ledger }
}

// v1 → v2：真正的旧记录升级（用户浏览器里已有的平铺数据）。
applyMigrations((fromVersion, envelope) => {
  if (fromVersion >= STATE_VERSION) {
    return envelope
  }
  const sources = (envelope.collections[LOOKOUT_KEY] as EntryRow[] | undefined) ?? []
  const ledger =
    (envelope.collections[RETURNS_COLLECTION] as EquipmentReturnEntry[] | undefined) ?? []
  const patch = buildLookoutPatch(sources, 'migrate', ledger)
  envelope.collections = { ...envelope.collections, ...patch }
  envelope.stateVersion = STATE_VERSION
  return envelope
})

// 启动兜底：全新安装的种子数据同样要进统一口径（幂等，只补缺、不重记）。
export function ensureLookoutDomain(): void {
  const lookouts = listRows(LOOKOUT_KEY)
  const needsNormalize = lookouts.some(
    (row) => typeof row.rowVersion !== 'number' || !Array.isArray(row.events),
  )
  const ledger = getCollection<EquipmentReturnEntry>(RETURNS_COLLECTION)
  if (needsNormalize) {
    commitCollections(buildLookoutPatch(lookouts, 'init', ledger))
    return
  }
  // 即使记录已归一，也要按当前状态对账一次台账，防止历史上漏挂/漏销。
  const at = nowStamp()
  const { ledger: reconciled } = reconcileReturnLedger(lookouts, ledger, () => at)
  if (JSON.stringify(reconciled) !== JSON.stringify(ledger)) {
    commitCollections({ [RETURNS_COLLECTION]: reconciled })
  }
}

// 重置瞭望台：种子也走同一套归一和台账对账，绝不回到「无状态机」的旧格式。
registerResetHook(LOOKOUT_KEY, () =>
  buildLookoutPatch(
    clone(SEED_ROWS[LOOKOUT_KEY] ?? []),
    'init',
    [],
  ),
)

// 动作清单由状态机统一导出，避免别的模块再手抄一份。
export { ACTIONS as LOOKOUT_ACTIONS }

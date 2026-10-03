import {
  LOOKOUT_MODULE_KEY,
  PENDING_RETURN_STATES,
  deriveFlags,
  normalizeLookoutState,
  type LookoutState,
} from '@/domain/lookout/lifecycle'
import type { EntryRow, HandoverRecord, StorageSnapshot } from './types'

// 存储结构迁移：v1 是纯 entries 表（没有版本号、没有交接档案、行上没有 revision），
// v2 起统一为 { version, entries, lookoutHandover } 容器。
// 迁移幂等：已经是 v2 的原样返回；首次播种也走同一套建档逻辑，保证口径只有一份。

export const SCHEMA_VERSION = 2

const EQUIPMENT_MODULE_KEY = 'equipment'

export type HandoverOrigin = '初始建档' | '旧记录迁移'

function isCurrentSnapshot(value: unknown): value is StorageSnapshot {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<StorageSnapshot>
  return (
    candidate.version === SCHEMA_VERSION &&
    Boolean(candidate.entries) &&
    Array.isArray(candidate.lookoutHandover)
  )
}

export function migrateToCurrent(parsed: unknown, origin: HandoverOrigin): StorageSnapshot {
  if (isCurrentSnapshot(parsed)) {
    return parsed
  }
  const legacy = parsed && typeof parsed === 'object' ? (parsed as Record<string, EntryRow[]>) : {}
  const entries: Record<string, EntryRow[]> = { ...legacy }
  const lookoutHandover: HandoverRecord[] = []
  if (entries[LOOKOUT_MODULE_KEY]) {
    entries[LOOKOUT_MODULE_KEY] = entries[LOOKOUT_MODULE_KEY].map((row) =>
      normalizeLookoutRow(row, lookoutHandover, origin),
    )
  }
  alignPendingReturnLedger(entries)
  return { version: SCHEMA_VERSION, entries, lookoutHandover }
}

/** 瞭望台旧行 → 新行：状态归一、补 revision、按新口径重打标记，并留一条建档交接记录。 */
function normalizeLookoutRow(
  row: EntryRow,
  handover: HandoverRecord[],
  origin: HandoverOrigin,
): EntryRow {
  const rawStatus = String(row.status ?? '')
  const state = normalizeLookoutState(rawStatus) ?? '临时关闭'
  const revision = Number(row.revision) > 0 ? Number(row.revision) : 1
  handover.push({
    seq: handover.length + 1,
    towerId: Number(row.id),
    towerCode: String(row['瞭望台编号'] ?? ''),
    action: origin,
    fromStatus: rawStatus || '（空）',
    toStatus: state,
    operator: '系统',
    at: new Date().toISOString(),
    note:
      rawStatus === state
        ? `${origin}，当前状态「${state}」`
        : `${origin}：旧状态「${rawStatus}」无法识别，按「${state}」建档，需人工核实`,
  })
  return { ...row, status: state, ...deriveFlags(state), revision }
}

/**
 * 装备待归还台账对齐：按瞭望台迁移后的状态重算每件装备的挂账标记。
 * 与状态机联动（deriveLedgerEffect）共用同一份 PENDING_RETURN_STATES 口径，
 * 迁移之后台账随瞭望台流转继续自动更新。
 */
function alignPendingReturnLedger(entries: Record<string, EntryRow[]>): void {
  const equipment = entries[EQUIPMENT_MODULE_KEY]
  if (!equipment) {
    return
  }
  const stateByTower = new Map(
    (entries[LOOKOUT_MODULE_KEY] ?? []).map((row) => [
      String(row['瞭望台编号'] ?? ''),
      row.status,
    ]),
  )
  entries[EQUIPMENT_MODULE_KEY] = equipment.map((item) => {
    const towerCode = String(item['配属瞭望台'] ?? '')
    const towerState = towerCode ? stateByTower.get(towerCode) : undefined
    const shouldHold =
      towerState !== undefined &&
      PENDING_RETURN_STATES.includes(towerState as LookoutState) &&
      String(item.status) === '已领用'
    return { ...item, '待归还': shouldHold }
  })
}

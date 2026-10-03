import { LOOKOUT_STATUSES, type LookoutStatus } from './state-machine'
import type { EquipmentReturnEntry } from './types'
import type { EntryRow } from '@/data/types'

/**
 * 装备待归还台账：跟随瞭望台运行状态联动。
 * 瞭望台一旦进不了值守（故障/维修/关闭），其配置的装备必须挂账追还；
 * 恢复值守时统一销账。台账由状态机事务统一对账，任何入口都改不漏。
 */

export const RETURNS_COLLECTION = 'equipmentReturnLedger'
const EQUIP_CODE = /EQUI-\d{4}/g

// 瞭望台处于占用装备、需要追还的状态。
const HOLDING_STATUSES: LookoutStatus[] = ['设备故障', '维修中', '临时关闭']

const HOLD_REASON: Record<string, string> = {
  设备故障: '瞭望台设备故障，装备暂停使用待归还',
  维修中: '瞭望台维修期间，装备暂停使用待归还',
  临时关闭: '瞭望台临时关闭，装备暂停使用待归还',
}

export function isHoldingStatus(status: string): boolean {
  return HOLDING_STATUSES.includes(status as LookoutStatus)
}

// 从「设备配置」文本里解析装备编号。
export function equipmentCodesOf(row: EntryRow): string[] {
  const matched = String(row['设备配置'] ?? '').match(EQUIP_CODE)
  return matched ? [...new Set(matched)] : []
}

type ReconcileChange = {
  added: EquipmentReturnEntry[]
  resolved: EquipmentReturnEntry[]
}

/**
 * 按当前所有瞭望台状态对账台账（幂等）：
 * - 占用状态下、尚欠的装备：补挂待归还
 * - 瞭望台已恢复正常值守：核销其名下未归还项
 * 迁移旧记录和每次状态流转后都跑同一套逻辑，历史挂账不会因换入口而漏更新。
 */
export function reconcileReturnLedger(
  lookouts: EntryRow[],
  ledger: EquipmentReturnEntry[],
  clock: () => string,
  reasonNote?: string,
): { ledger: EquipmentReturnEntry[]; change: ReconcileChange } {
  const next = ledger.map((item) => ({ ...item }))
  const change: ReconcileChange = { added: [], resolved: [] }
  const now = clock()

  for (const lookout of lookouts) {
    const code = String(lookout['瞭望台编号'] ?? '')
    const hill = String(lookout['所在山头'] ?? '')
    const status = String(lookout.status)
    const codes = equipmentCodesOf(lookout)

    if (isHoldingStatus(status)) {
      for (const equipCode of codes) {
        const open = next.find(
          (item) =>
            item.装备编号 === equipCode &&
            item.瞭望台编号 === code &&
            item.status === '待归还',
        )
        if (open) {
          continue
        }
        const entry: EquipmentReturnEntry = {
          id: nextLedgerId(next),
          装备编号: equipCode,
          瞭望台编号: code,
          所在山头: hill,
          登记原因: HOLD_REASON[status] ?? '瞭望台暂停值守，装备待归还',
          登记时间: now,
          status: '待归还',
        }
        if (reasonNote) {
          entry.登记原因 = `${entry.登记原因}（${reasonNote}）`
        }
        next.push(entry)
        change.added.push(entry)
      }
      continue
    }

    if (status === '正常值守') {
      for (const item of next) {
        if (item.瞭望台编号 === code && item.status === '待归还') {
          item.status = '已归还'
          item.核销时间 = now
          item.核销原因 = '瞭望台恢复正常值守，装备归还销账'
          change.resolved.push(item)
        }
      }
    }
  }

  return { ledger: next, change }
}

function nextLedgerId(ledger: EquipmentReturnEntry[]): number {
  return ledger.reduce((max, item) => Math.max(max, item.id), 0) + 1
}

export function openReturns(ledger: EquipmentReturnEntry[]): EquipmentReturnEntry[] {
  return ledger.filter((item) => item.status === '待归还')
}

// 供瞭望台卡片标记「该台有装备待归还」。
export function openReturnsByLookout(
  ledger: EquipmentReturnEntry[],
): Map<string, number> {
  const map = new Map<string, number>()
  for (const item of openReturns(ledger)) {
    map.set(item.瞭望台编号, (map.get(item.瞭望台编号) ?? 0) + 1)
  }
  return map
}

export function isKnownLookoutStatus(status: string): boolean {
  return (LOOKOUT_STATUSES as readonly string[]).includes(status)
}

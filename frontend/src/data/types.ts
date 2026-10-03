/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 瞭望台交接档案记录：每次合法流转（含迁移建档、值守打卡）追加一条，只增不改。 */
export type HandoverRecord = {
  seq: number
  towerId: number
  towerCode: string
  action: string
  fromStatus: string
  toStatus: string
  operator: string
  at: string
  note: string
}

/** localStorage 里的整体结构：version 用于旧记录迁移，lookoutHandover 是瞭望台交接档案。 */
export type StorageSnapshot = {
  version: number
  entries: Record<string, EntryRow[]>
  lookoutHandover: HandoverRecord[]
}

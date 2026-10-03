import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'forest-fire-patrol:entries'

// 版本化数据信封：所有模块的数据都挂在 collections 下，stateVersion 驱动旧记录迁移。
export type Envelope = {
  stateVersion: number
  collections: Record<string, unknown[]>
}

const CURRENT_STATE_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 首次使用：直接播种当前版本的信封。
function seedEnvelope(): Envelope {
  return {
    stateVersion: CURRENT_STATE_VERSION,
    collections: clone(SEED_ROWS) as Record<string, unknown[]>,
  }
}

type StorageShape = Envelope | (Record<string, EntryRow[]> & { stateVersion?: undefined })

function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Envelope).stateVersion === 'number' &&
    Array.isArray((value as Envelope).collections) === false &&
    typeof (value as Envelope).collections === 'object'
  )
}

function persist(envelope: Envelope): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope))
  }
}

function readStorage(): Envelope {
  if (typeof window === 'undefined' || !window.localStorage) {
    return seedEnvelope()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = seedEnvelope()
    persist(seeded)
    return seeded
  }
  let parsed: StorageShape
  try {
    parsed = JSON.parse(raw) as StorageShape
  } catch {
    const seeded = seedEnvelope()
    persist(seeded)
    return seeded
  }
  if (isEnvelope(parsed)) {
    return parsed
  }
  // 旧版（无信封）：包成 v1，交给注册好的迁移函数升级。
  return { stateVersion: 1, collections: clone(parsed as Record<string, EntryRow[]>) }
}

let cache: Envelope | null = null

export function envelope(): Envelope {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

// 迁移入口：由各业务域在启动时注册并执行（见 domain/lookout/migration.ts）。
export function applyMigrations(
  migrate: (fromVersion: number, envelope: Envelope) => Envelope,
): void {
  const current = envelope()
  if (current.stateVersion >= CURRENT_STATE_VERSION) {
    return
  }
  const upgraded = migrate(current.stateVersion, current)
  upgraded.stateVersion = Math.max(upgraded.stateVersion, CURRENT_STATE_VERSION)
  cache = upgraded
  persist(upgraded)
}

// 其他标签页改了数据：本页缓存作废，下一次读取拿最新版，CAS 才不会拿旧版本去覆盖。
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      cache = null
    }
  })
}

export function allRows(): Record<string, EntryRow[]> {
  const { collections } = envelope()
  const result: Record<string, EntryRow[]> = {}
  for (const [key, rows] of Object.entries(collections)) {
    result[key] = rows as EntryRow[]
  }
  return result
}

export function listRows(key: string): EntryRow[] {
  return (envelope().collections[key] as EntryRow[] | undefined) ?? []
}

export function getCollection<T>(key: string): T[] {
  return (envelope().collections[key] as T[] | undefined) ?? []
}

// 单集合写入（通用模块仍走这里）。
export function saveRows(key: string, rows: EntryRow[]): void {
  commitCollections({ [key]: rows })
}

// 原子提交：一次状态流转可能同时改瞭望台和装备台账，必须一次写入，不能半落地。
export function commitCollections(patch: Record<string, unknown[]>): void {
  const next: Envelope = {
    ...envelope(),
    collections: { ...envelope().collections, ...patch },
  }
  cache = next
  persist(next)
}

// 重置钩子：瞭望台重置时要连带按新状态机重建台账，不能只还原种子。
type ResetHook = () => Record<string, unknown[]>
const resetHooks = new Map<string, ResetHook>()

export function registerResetHook(key: string, hook: ResetHook): void {
  resetHooks.set(key, hook)
}

export function resetRows(key: string): EntryRow[] {
  const hook = resetHooks.get(key)
  if (hook) {
    commitCollections(hook())
  } else {
    saveRows(key, clone(SEED_ROWS[key] ?? []))
  }
  return listRows(key)
}

export function storageKey(): string {
  return STORAGE_KEY
}

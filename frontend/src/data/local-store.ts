import { migrateToCurrent } from './migrations'
import { SEED_ROWS } from './seed'
import type { EntryRow, StorageSnapshot } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 存储结构带版本号：v1 是纯 entries 表，v2 起是 { version, entries, lookoutHandover }。
// 读取时自动迁移旧记录；写入统一走 transact，重读-变更-整体写回。
const STORAGE_KEY = 'forest-fire-patrol:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

let cache: StorageSnapshot | null = null

function seedSnapshot(): StorageSnapshot {
  return migrateToCurrent(clone(SEED_ROWS), '初始建档')
}

function persist(snapshot: StorageSnapshot): void {
  cache = snapshot
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  }
}

function readStorage(): StorageSnapshot {
  if (typeof window === 'undefined' || !window.localStorage) {
    // 非浏览器环境（构建、脚本）：用内存缓存当存储
    if (cache === null) {
      cache = seedSnapshot()
    }
    return cache
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = seedSnapshot()
    persist(seeded)
    return seeded
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    const snapshot = migrateToCurrent(parsed, '旧记录迁移')
    if (snapshot !== parsed) {
      // 发生了迁移：写回新结构，保证只迁一次
      persist(snapshot)
    }
    return snapshot
  } catch {
    const seeded = seedSnapshot()
    persist(seeded)
    return seeded
  }
}

// 其他页签写入后本地缓存立即失效，下一次读取拿最新快照
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      cache = null
    }
  })
}

export function loadSnapshot(): StorageSnapshot {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function allRows(): Record<string, EntryRow[]> {
  return loadSnapshot().entries
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const snapshot = loadSnapshot()
  snapshot.entries[key] = rows
  persist(snapshot)
}

/**
 * 唯一的原子写通道：绕过缓存重读存储 → 变更 → 整体写回。
 * 调用方在锁内执行（见 lookout-service），读-改-写同步完成，不会互相覆盖。
 */
export function transact<T>(mutate: (snapshot: StorageSnapshot) => T): T {
  const snapshot = readStorage()
  const result = mutate(snapshot)
  persist(snapshot)
  return result
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

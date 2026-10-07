import { MODULES, MODULE_BY_KEY } from './modules'
import { SEED_ROWS } from './seed'
import type { EntryRow, ModuleMeta } from './types'

// 本地持久化：业务数据与迁移清单分两个键存放。
// entries 只在迁移收尾或业务写操作时整体回写一次；manifest 是迁移日志，
// 记录待处理项，迁移中断后下次启动从待处理项继续。
const STORAGE_KEY = 'airport-ground-handling:entries'
const MANIFEST_KEY = 'airport-ground-handling:manifest'
const CORRUPT_KEY = 'airport-ground-handling:corrupt'

// 结构版本：没有清单的旧数据视为 1，当前结构为 2。
const SCHEMA_VERSION = 2

// 读取整仓快照需要的权限：会话里没有它，越权读取直接拒绝。
export const SNAPSHOT_READ_PERMISSION = 'snapshot:read'

export type SnapshotAuthority = {
  permissions: string[]
}

type Manifest = {
  version: number
  /** 已初始化、允许存在的模块 */
  modules: string[]
  /** 显式删除的模块：过滤掉之后不再被种子带回 */
  removed: string[]
  /** 待处理模块：迁移中断后从这里继续 */
  pending: string[]
  /** 已处理完、尚未随整仓回写的模块结果（断点续迁用） */
  stash: Record<string, EntryRow[]>
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function storage(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  return window.localStorage
}

function emptyManifest(): Manifest {
  return { version: SCHEMA_VERSION, modules: [], removed: [], pending: [], stash: {} }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function readManifest(): Manifest | null {
  const store = storage()
  if (!store) {
    return null
  }
  const raw = store.getItem(MANIFEST_KEY)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Manifest>
    return {
      version: Number(parsed.version) || 1,
      modules: stringList(parsed.modules),
      removed: stringList(parsed.removed),
      pending: stringList(parsed.pending),
      stash: parsed.stash && typeof parsed.stash === 'object' ? (parsed.stash as Record<string, EntryRow[]>) : {},
    }
  } catch {
    // 清单坏了就当没有，按业务数据本身重建
    return null
  }
}

function writeManifest(manifest: Manifest): void {
  storage()?.setItem(MANIFEST_KEY, JSON.stringify(manifest))
}

function readEntries(): Record<string, EntryRow[]> {
  const store = storage()
  if (!store) {
    return {}
  }
  const raw = store.getItem(STORAGE_KEY)
  if (!raw) {
    return {}
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return parsed as Record<string, EntryRow[]>
  } catch {
    // 解析失败不直接覆盖：先备份原数据再按空仓初始化，原记录可从备份键找回
    store.setItem(CORRUPT_KEY, raw)
    store.removeItem(STORAGE_KEY)
    return {}
  }
}

/** 唯一的业务数据回写出口：所有写路径都走这里，保证一次迁移只回写一次。 */
function writeSnapshot(snapshot: Record<string, EntryRow[]>): void {
  cache = snapshot
  storage()?.setItem(STORAGE_KEY, JSON.stringify(snapshot))
}

/**
 * 字段级迁移：逐行补齐缺失字段，已有的值一个都不动。
 * 缺字段时从同编号的种子行借值，借不到给空串，绝不整行覆盖，原记录不丢。
 */
function migrateRows(meta: ModuleMeta, rows: EntryRow[]): EntryRow[] {
  const seedById = new Map((SEED_ROWS[meta.key] ?? []).map((row) => [Number(row.id), row]))
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const list = Array.isArray(rows) ? rows : []
  return list.map((row, index) => {
    const source = row && typeof row === 'object' ? row : ({} as EntryRow)
    const next: EntryRow = { ...source }
    const donor = seedById.get(Number(source.id))
    next.id = Number.isFinite(Number(source.id)) ? Number(source.id) : index + 1
    for (const field of meta.fields) {
      if (next[field] === undefined) {
        next[field] = donor?.[field] ?? ''
      }
    }
    if (typeof next.status !== 'string' || !meta.statuses.includes(next.status)) {
      next.status = donor ? String(donor.status) : meta.statuses[0]
    }
    if (typeof next.pending !== 'boolean') {
      next.pending = next.status !== lastStatus
    }
    if (typeof next.abnormal !== 'boolean') {
      next.abnormal = false
    }
    return next
  })
}

let cache: Record<string, EntryRow[]> | null = null

/**
 * 唯一的初始化与迁移入口，所有读路径（列表、详情、数据面板）都先过这里，
 * 保证同一份本地数据在任何入口读数一致。幂等：已是最新时纯读不写。
 */
function ensureStore(): Record<string, EntryRow[]> {
  if (cache !== null) {
    return cache
  }
  const stored = readEntries()
  const existing = readManifest()
  const manifest = existing ?? emptyManifest()

  // 1) 计算待处理项
  let pending: string[]
  if (existing === null) {
    // 没有清单：老版本数据或全新浏览器，所有注册模块统一过一遍
    pending = MODULES.map((meta) => meta.key)
  } else if (existing.pending.length > 0) {
    // 上次迁移中断：只处理待处理项，其余模块保持现状
    pending = existing.pending.filter((key) => MODULE_BY_KEY.has(key))
  } else {
    // 清单是最新的：只处理注册表新增、且没被显式删除的模块
    pending = MODULES.map((meta) => meta.key).filter(
      (key) => !existing.modules.includes(key) && !existing.removed.includes(key),
    )
  }

  // 2) 组装基底快照：只保留注册表内、未被删除的模块；
  //    已下线模块的残留与已删除模块一律过滤，不再带回
  const snapshot: Record<string, EntryRow[]> = {}
  for (const meta of MODULES) {
    if (manifest.removed.includes(meta.key) || pending.includes(meta.key)) {
      continue
    }
    if (Array.isArray(stored[meta.key])) {
      snapshot[meta.key] = stored[meta.key]
    } else if (existing === null || manifest.modules.includes(meta.key)) {
      // 清单承认它但数据缺失（存储被外部清过）：补种
      pending.push(meta.key)
    }
  }
  const hasStray = Object.keys(stored).some((key) => !(key in snapshot))

  if (pending.length === 0 && !hasStray && existing !== null) {
    cache = snapshot
    return cache
  }

  // 3) 逐模块处理，结果先记进迁移日志；中断后下次从待处理项继续
  const journal: Manifest = {
    ...manifest,
    pending: [...pending],
    stash: { ...manifest.stash },
  }
  writeManifest(journal)
  for (const key of pending) {
    const meta = MODULE_BY_KEY.get(key)
    if (!meta) {
      continue
    }
    const rows =
      journal.stash[key] ??
      (Array.isArray(stored[key]) ? migrateRows(meta, stored[key]) : clone(SEED_ROWS[key] ?? []))
    journal.stash[key] = rows
    journal.pending = journal.pending.filter((item) => item !== key)
    snapshot[key] = rows
    // 每完成一项就更新日志，中断时待处理项是准确的
    writeManifest(journal)
  }

  // 4) 全部处理完，业务数据只回写这一次，然后收尾清单
  writeSnapshot(snapshot)
  writeManifest({
    version: SCHEMA_VERSION,
    modules: Object.keys(snapshot),
    removed: manifest.removed.filter((key) => MODULE_BY_KEY.has(key)),
    pending: [],
    stash: {},
  })
  return snapshot
}

/**
 * 读取整仓快照：需要 snapshot:read 权限，越权读取直接拒绝。
 * 返回内部快照，调用方只读，不要改。
 */
export function readSnapshot(authority: SnapshotAuthority): Record<string, EntryRow[]> {
  if (!authority.permissions.includes(SNAPSHOT_READ_PERMISSION)) {
    throw new Error('越权读取整仓快照：缺少 snapshot:read 权限，已拒绝')
  }
  return ensureStore()
}

/** 单模块读取：模块页面只能读自己模块的数据，不需要整仓权限。 */
export function listRows(key: string): EntryRow[] {
  return ensureStore()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const snapshot = { ...ensureStore(), [key]: rows }
  writeSnapshot(snapshot)
  // 同步清单：重建的模块从删除名单里拿掉
  const manifest = readManifest()
  if (manifest) {
    writeManifest({
      ...manifest,
      modules: [...new Set([...manifest.modules, key])],
      removed: manifest.removed.filter((item) => item !== key),
    })
  }
}

/** 删除模块：数据与清单同步移除并记入删除名单，之后初始化与迁移都不会再把它带回。 */
export function removeModule(key: string): void {
  const snapshot = { ...ensureStore() }
  delete snapshot[key]
  writeSnapshot(snapshot)
  const manifest = readManifest()
  if (manifest) {
    writeManifest({
      ...manifest,
      modules: manifest.modules.filter((item) => item !== key),
      removed: manifest.removed.includes(key) ? manifest.removed : [...manifest.removed, key],
    })
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

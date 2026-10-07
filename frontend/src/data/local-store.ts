import { MODULE_BY_KEY, MODULES } from './modules'
import { SEED_ROWS } from './seed'
import type { EntryRow, SnapshotAuth } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 快照带版本号：v1 是平铺的 模块key -> 行数组，v2 起包一层信封，迁移走同一条管线。
const STORAGE_KEY = 'airport-ground-handling:entries'
const MIGRATION_KEY = 'airport-ground-handling:migration'
const SNAPSHOT_VERSION = 2

// v2 快照信封：modules 里只放登记在册的模块，已删除的模块不会出现在这里。
type SnapshotFile = {
  version: number
  modules: Record<string, EntryRow[]>
}

// 迁移台账：记录哪些模块已迁完、哪些还待处理，中断后下次从待处理项继续。
type MigrationJournal = {
  version: number
  pending: string[]
  completed: Record<string, EntryRow[]>
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage
}

// 行级归一化：原记录里已有的字段一律保留，缺的才补，绝不整行覆盖——
// 直接拿种子行或空对象覆盖，浏览器里的原记录就丢了。
function normalizeRow(key: string, row: Record<string, unknown>, id: number): EntryRow {
  const meta = MODULE_BY_KEY.get(key)
  const statuses = meta?.statuses ?? []
  const normalized = { ...row } as EntryRow
  normalized.id = id
  normalized.status =
    typeof row.status === 'string' && row.status.trim() !== '' ? row.status : (statuses[0] ?? '')
  // pending 缺省时按状态推导（与 runAction 同一口径），abnormal 缺省按无异常。
  normalized.pending =
    typeof row.pending === 'boolean'
      ? row.pending
      : normalized.status !== statuses[statuses.length - 1]
  normalized.abnormal = row.abnormal === true
  for (const field of meta?.fields ?? []) {
    const value = row[field]
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      normalized[field] = ''
    }
  }
  return normalized
}

function normalizeRows(key: string, rows: unknown[]): EntryRow[] {
  const used = new Set<number>()
  let spare = 1
  const normalized: EntryRow[] = []
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      continue
    }
    const row = raw as Record<string, unknown>
    let id = Number(row.id)
    if (!Number.isInteger(id) || id <= 0 || used.has(id)) {
      while (used.has(spare)) {
        spare += 1
      }
      id = spare
    }
    used.add(id)
    normalized.push(normalizeRow(key, row, id))
  }
  return normalized
}

// 初始化和迁移共用这一条口径：模块数据缺失或损坏时用种子播种；
// 空数组是用户清空过的合法状态，原样保留，不把种子带回来。
function migrateRows(key: string, stored: unknown): EntryRow[] {
  if (!Array.isArray(stored)) {
    return normalizeRows(key, clone(SEED_ROWS[key] ?? []))
  }
  return normalizeRows(key, stored)
}

function parseSnapshot(raw: string | null): SnapshotFile | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SnapshotFile> | null
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.version === SNAPSHOT_VERSION &&
      parsed.modules &&
      typeof parsed.modules === 'object'
    ) {
      return parsed as SnapshotFile
    }
  } catch {
    // 损坏内容按未迁移处理，走下面的统一管线重建。
  }
  return null
}

// v1 平铺格式：整个对象就是 模块key -> 行数组；读不出来就当作空仓库。
function parseLegacyModules(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {}
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // 损坏内容按空仓库处理，各模块会用种子重新播种。
  }
  return {}
}

function readJournal(): MigrationJournal | null {
  if (!storageAvailable()) {
    return null
  }
  const raw = window.localStorage.getItem(MIGRATION_KEY)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MigrationJournal> | null
    if (
      parsed &&
      parsed.version === SNAPSHOT_VERSION &&
      Array.isArray(parsed.pending) &&
      parsed.completed &&
      typeof parsed.completed === 'object'
    ) {
      return parsed as MigrationJournal
    }
  } catch {
    // 台账损坏则清掉重迁，幂等管线重跑一遍结果一致。
  }
  window.localStorage.removeItem(MIGRATION_KEY)
  return null
}

function writeJournal(journal: MigrationJournal): void {
  if (storageAvailable()) {
    window.localStorage.setItem(MIGRATION_KEY, JSON.stringify(journal))
  }
}

function clearJournal(): void {
  if (storageAvailable()) {
    window.localStorage.removeItem(MIGRATION_KEY)
  }
}

// 主快照唯一的回写点：初始化、迁移、日常改动都经这里落盘，一次提交写全量模块。
function commitSnapshot(modules: Record<string, EntryRow[]>): void {
  if (!storageAvailable()) {
    return
  }
  const file: SnapshotFile = { version: SNAPSHOT_VERSION, modules }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(file))
}

// 统一的数据初始化与迁移入口：首次播种、旧版升级、损坏重建、中断续迁都走这条管线。
// 只有全部模块迁完才一次性回写主快照，机位分配台账与其他模块看到的永远是同一代数据。
function loadSnapshot(): Record<string, EntryRow[]> {
  const registeredKeys = MODULES.map((meta) => meta.key)
  if (!storageAvailable()) {
    const seeded: Record<string, EntryRow[]> = {}
    for (const key of registeredKeys) {
      seeded[key] = migrateRows(key, undefined)
    }
    return seeded
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  const current = parseSnapshot(raw)
  const journal = readJournal()
  const currentComplete =
    current !== null && registeredKeys.every((key) => key in current.modules)
  if (currentComplete) {
    if (journal) {
      // 提交已完成，台账只是残留，清掉即可，主快照零回写。
      clearJournal()
    }
    return current.modules
  }
  // 续迁时只保留仍登记在册的已完成项；已删除的模块既不迁也不回写。
  const completed: Record<string, EntryRow[]> = {}
  if (journal) {
    for (const key of registeredKeys) {
      if (key in journal.completed) {
        completed[key] = journal.completed[key]
      }
    }
  }
  const legacy: Record<string, unknown> = current ? current.modules : parseLegacyModules(raw)
  const pending = registeredKeys.filter((key) => !(key in completed))
  writeJournal({ version: SNAPSHOT_VERSION, pending: [...pending], completed })
  while (pending.length > 0) {
    const key = pending.shift() as string
    completed[key] = migrateRows(key, legacy[key])
    writeJournal({ version: SNAPSHOT_VERSION, pending: [...pending], completed })
  }
  commitSnapshot(completed)
  clearJournal()
  return completed
}

let cache: Record<string, EntryRow[]> | null = null

function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = loadSnapshot()
  }
  return cache
}

// 整仓快照涉及全部模块数据，必须持有效授权才能读；没有授权一律拒绝。
export function readSnapshot(auth: SnapshotAuth | null | undefined): Record<string, EntryRow[]> {
  if (
    !auth ||
    typeof auth.operator !== 'string' ||
    auth.operator.trim() === '' ||
    typeof auth.scope !== 'string' ||
    auth.scope.trim() === ''
  ) {
    throw new Error('越权读取整仓快照被拒绝：需要有效的值班授权')
  }
  return allRows()
}

export function listRows(key: string): EntryRow[] {
  if (!MODULE_BY_KEY.has(key)) {
    // 已删除的模块一律读不到，不会被旧数据带回来。
    return []
  }
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  if (!MODULE_BY_KEY.has(key)) {
    throw new Error(`没有登记名为 ${key} 的业务模块，已删除的模块不会回写`)
  }
  const next = { ...allRows(), [key]: rows }
  cache = next
  commitSnapshot(next)
}

export function resetRows(key: string): EntryRow[] {
  // 重置就是用种子重新播种，走的还是同一条归一化管线。
  const rows = migrateRows(key, undefined)
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

import { MODULE_BY_KEY } from './modules'

// 跨会话定位：记住上次所在的业务模块，下次打开直接回到那里。
// 定位只认登记在册的模块 key，已删除的模块定位一律清除，绝不指过去。
const POSITION_KEY = 'airport-ground-handling:last-position'

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage
}

export function rememberPosition(key: string): void {
  if (!storageAvailable()) {
    return
  }
  if (!MODULE_BY_KEY.has(key)) {
    window.localStorage.removeItem(POSITION_KEY)
    return
  }
  window.localStorage.setItem(POSITION_KEY, JSON.stringify({ module: key }))
}

export function recallPosition(): string | null {
  if (!storageAvailable()) {
    return null
  }
  const raw = window.localStorage.getItem(POSITION_KEY)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as { module?: unknown }
    const key = typeof parsed.module === 'string' ? parsed.module : ''
    if (MODULE_BY_KEY.has(key)) {
      return key
    }
  } catch {
    // 损坏的定位按无效处理，落到下面统一清除。
  }
  window.localStorage.removeItem(POSITION_KEY)
  return null
}

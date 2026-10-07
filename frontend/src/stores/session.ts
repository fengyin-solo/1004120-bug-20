import { defineStore } from 'pinia'

import { MODULE_BY_KEY } from '@/data/modules'
import { SNAPSHOT_READ_PERMISSION } from '@/data/local-store'

// 跨会话定位：记住最后所在模块，重开浏览器能回到正确模块
const POSITION_KEY = 'airport-ground-handling:position'

function readPosition(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  const raw = window.localStorage.getItem(POSITION_KEY)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as { module?: unknown }
    return typeof parsed.module === 'string' ? parsed.module : null
  } catch {
    return null
  }
}

function writePosition(key: string | null): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  if (key === null) {
    window.localStorage.removeItem(POSITION_KEY)
  } else {
    window.localStorage.setItem(POSITION_KEY, JSON.stringify({ module: key }))
  }
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '机场地面保障调度管理系统',
    permissions: [SNAPSHOT_READ_PERMISSION] as string[],
    lastModule: null as string | null,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    canReadSnapshot: (state) => state.permissions.includes(SNAPSHOT_READ_PERMISSION),
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    // 记录当前模块：只承认注册表里的模块，定位才不会指错
    rememberModule(key: string) {
      if (!MODULE_BY_KEY.has(key)) {
        return
      }
      this.lastModule = key
      writePosition(key)
    },
    // 恢复定位：存储里的模块已下线就清掉，绝不指向错误模块
    restoreModule(): string | null {
      const key = readPosition()
      if (key && MODULE_BY_KEY.has(key)) {
        this.lastModule = key
        return key
      }
      if (key) {
        writePosition(null)
      }
      this.lastModule = null
      return null
    },
  },
})

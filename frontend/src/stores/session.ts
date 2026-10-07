import { defineStore } from 'pinia'

import type { SnapshotAuth } from '@/data/types'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '机场地面保障调度管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    // 整仓快照的读取授权只签发给在岗操作员；不在岗时拿到的是 null，数据层会拒绝。
    snapshotAuth(state): SnapshotAuth | null {
      if (!state.operator.trim()) {
        return null
      }
      return { operator: state.operator, scope: state.scope }
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
  },
})

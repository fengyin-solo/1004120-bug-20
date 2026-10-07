import { createRouter, createWebHistory } from 'vue-router'

import Dashboard from '@/views/Dashboard.vue'
import { useSessionStore } from '@/stores/session'
const Stand = () => import('@/views/stand/index.vue')
const Bridge = () => import('@/views/bridge/index.vue')
const GroundPower = () => import('@/views/ground_power/index.vue')
const Baggage = () => import('@/views/baggage/index.vue')
const Cargo = () => import('@/views/cargo/index.vue')
const Fueling = () => import('@/views/fueling/index.vue')
const Catering = () => import('@/views/catering/index.vue')
const CabinClean = () => import('@/views/cabin_clean/index.vue')
const Lavatory = () => import('@/views/lavatory/index.vue')
const Deicing = () => import('@/views/deicing/index.vue')
const Pushback = () => import('@/views/pushback/index.vue')
const CrewSchedule = () => import('@/views/crew_schedule/index.vue')
const SpecialVehicle = () => import('@/views/special_vehicle/index.vue')
const FlightOps = () => import('@/views/flight_ops/index.vue')
const Turnaround = () => import('@/views/turnaround/index.vue')
const ApronSafety = () => import('@/views/apron_safety/index.vue')
const LoadEquip = () => import('@/views/load_equip/index.vue')
const AirEmergency = () => import('@/views/air_emergency/index.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: Dashboard },
    { path: '/stand', name: 'stand', component: Stand },
    { path: '/bridge', name: 'bridge', component: Bridge },
    { path: '/ground_power', name: 'ground_power', component: GroundPower },
    { path: '/baggage', name: 'baggage', component: Baggage },
    { path: '/cargo', name: 'cargo', component: Cargo },
    { path: '/fueling', name: 'fueling', component: Fueling },
    { path: '/catering', name: 'catering', component: Catering },
    { path: '/cabin_clean', name: 'cabin_clean', component: CabinClean },
    { path: '/lavatory', name: 'lavatory', component: Lavatory },
    { path: '/deicing', name: 'deicing', component: Deicing },
    { path: '/pushback', name: 'pushback', component: Pushback },
    { path: '/crew_schedule', name: 'crew_schedule', component: CrewSchedule },
    { path: '/special_vehicle', name: 'special_vehicle', component: SpecialVehicle },
    { path: '/flight_ops', name: 'flight_ops', component: FlightOps },
    { path: '/turnaround', name: 'turnaround', component: Turnaround },
    { path: '/apron_safety', name: 'apron_safety', component: ApronSafety },
    { path: '/load_equip', name: 'load_equip', component: LoadEquip },
    { path: '/air_emergency', name: 'air_emergency', component: AirEmergency },
  ],
})

// 跨会话定位：每次进入模块页都记住位置，重开浏览器能回到正确模块
router.afterEach((to) => {
  if (typeof to.name === 'string' && to.name !== 'dashboard') {
    useSessionStore().rememberModule(to.name)
  }
})

export default router

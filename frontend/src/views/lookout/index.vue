<template>
  <section class="page" data-module="lookout">
    <header class="page-head">
      <div>
        <h2>瞭望台管理管理</h2>
        <p class="page-desc">维护瞭望台，围绕瞭望台编号、所在山头、海拔高度、视野覆盖面积做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记瞭望台</button>
        <button class="btn" type="button" @click="exportRows">导出瞭望台管理清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in rowActions(row)"
              :key="action"
              class="link"
              type="button"
              :disabled="pendingAction !== ''"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openHandover(row)">交接记录</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无瞭望台管理数据，可先登记瞭望台</td>
        </tr>
      </tbody>
    </table>

    <section v-if="selectedTower" class="panel-block">
      <h3 class="panel-title">
        交接记录 · {{ selectedTower['瞭望台编号'] }}（{{ selectedTower['所在山头'] }}）
      </h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>序号</th>
            <th>时间</th>
            <th>动作</th>
            <th>原状态</th>
            <th>新状态</th>
            <th>操作人</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in handover" :key="record.seq">
            <td>{{ record.seq }}</td>
            <td>{{ formatTime(record.at) }}</td>
            <td>{{ record.action }}</td>
            <td>{{ record.fromStatus }}</td>
            <td>{{ record.toStatus }}</td>
            <td>{{ record.operator }}</td>
            <td>{{ record.note }}</td>
          </tr>
          <tr v-if="!handover.length">
            <td colspan="7" class="empty-state">暂无交接记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条瞭望台管理记录</span>
      <span v-if="notice" class="ok-text">{{ notice }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
} from '@/api/local-service'
import { applyLookoutTransition, listLookoutHandover } from '@/api/lookout-service'
import {
  LOOKOUT_STATES,
  availableActions,
  normalizeLookoutState,
  summarizeLookouts,
} from '@/domain/lookout/lifecycle'
import { useSessionStore } from '@/stores/session'
import type { EntryRow, HandoverRecord } from '@/data/types'

const meta = moduleMeta('lookout')
const store = useSessionStore()
const columns = ["瞭望台编号", "所在山头", "海拔高度", "视野覆盖面积", "瞭望员", "通讯方式", "设备配置", "运行状态"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const notice = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
// 正在落地的动作（"行id:动作"），落地期间禁用所有动作按钮，防止连点产生并发写
const pendingAction = ref('')

const selectedId = ref<number | null>(null)
const handover = ref<HandoverRecord[]>([])

// 统计口径统一从状态机派生：故障台数含维修中，恢复条件只维护一份
const summary = computed(() => summarizeLookouts(rows.value))
const stats = computed(() => summary.value.metrics)
const statusSummary = computed(() =>
  LOOKOUT_STATES.map((status) => ({ status, count: summary.value.byStatus[status] })),
)
const selectedTower = computed(
  () => rows.value.find((row) => Number(row.id) === selectedId.value) ?? null,
)

function rowActions(row: EntryRow) {
  const state = normalizeLookoutState(row.status)
  return state ? availableActions(state) : []
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '瞭望台登记入口尚未接入审批流'
}

function openHandover(row: EntryRow) {
  selectedId.value = Number(row.id)
  handover.value = listLookoutHandover(selectedId.value)
}

function formatTime(iso: string) {
  const time = new Date(iso)
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleString('zh-CN', { hour12: false })
}

async function runAction(action: string, row: EntryRow) {
  if (pendingAction.value) {
    return
  }
  pendingAction.value = `${String(row.id)}:${action}`
  errorMessage.value = ''
  notice.value = ''
  try {
    const result = await applyLookoutTransition({
      id: Number(row.id),
      action,
      expectedRevision: Number(row.revision ?? 0),
      operator: store.operator,
    })
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    notice.value = result.message
    reload()
    if (selectedId.value !== null) {
      handover.value = listLookoutHandover(selectedId.value)
    }
  } finally {
    pendingAction.value = ''
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '瞭望台管理列表读取失败'
  }
}

onMounted(reload)
</script>

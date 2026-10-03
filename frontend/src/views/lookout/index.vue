<template>
  <section class="page" data-module="lookout">
    <header class="page-head">
      <div>
        <h2>瞭望台管理管理</h2>
        <p class="page-desc">围绕瞭望台编号、所在山头、海拔高度、视野覆盖面积做登记、筛选与状态流转。值班、故障、维修、恢复统一走运行状态机，历史交接全程留痕。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记瞭望台</button>
        <button class="btn" type="button" @click="exportRows">导出瞭望台管理清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
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
          <th>待归还装备</th>
          <th>可执行动作</th>
          <th>交接记录</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}<span class="muted">（v{{ versionOf(row) }}）</span></td>
          <td>{{ returnMap.get(String(row['瞭望台编号'])) ?? 0 }} 件</td>
          <td class="row-actions">
            <button
              v-for="action in legalActionsOf(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!legalActionsOf(row).length" class="muted">无</span>
          </td>
          <td>
            <button class="link" type="button" @click="openHistory(row)">
              查看（{{ eventCount(row) }}）
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无瞭望台管理数据，可先登记瞭望台</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条瞭望台管理记录，状态机版本 v{{ stateVersion }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="historyRow" class="modal-mask" @click.self="closeHistory">
      <div class="modal-panel">
        <header class="modal-head">
          <h3>{{ historyRow['瞭望台编号'] }} · {{ historyRow['所在山头'] }} 交接记录</h3>
          <button class="btn ghost" type="button" @click="closeHistory">关闭</button>
        </header>
        <ol class="timeline">
          <li v-for="event in eventsOf(historyRow)" :key="event.seq" class="timeline-item">
            <div class="timeline-line">
              <span class="timeline-badge" :data-kind="event.kind">{{ kindLabel(event.kind) }}</span>
              <div>
                <p class="timeline-title">{{ event.action }}：{{ event.from }} → {{ event.to }}</p>
                <p class="muted">{{ event.at }}<span v-if="event.note"> · {{ event.note }}</span></p>
              </div>
            </div>
          </li>
        </ol>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listEquipmentReturns,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  legalActions,
  LOOKOUT_STATUSES,
  STATE_VERSION,
  summarizeLookouts,
} from '@/domain/lookout/state-machine'
import { openReturnsByLookout } from '@/domain/lookout/equipment-returns'
import type { LookoutEvent } from '@/domain/lookout/types'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('lookout')
const columns = ["瞭望台编号", "所在山头", "海拔高度", "视野覆盖面积", "瞭望员", "通讯方式", "设备配置", "运行状态"]
const stateVersion = STATE_VERSION

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const historyRow = ref<EntryRow | null>(null)

const statusSummary = computed(() =>
  (LOOKOUT_STATUSES as readonly string[]).map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 待归还台账由瞭望台状态机联动维护，这里按瞭望台编号聚合展示。
const returnMap = computed(() => openReturnsByLookout(listEquipmentReturns()))

// 统计走统一状态机口径，恢复数来自交接历史，不会再漏掉恢复条件。
const statCards = computed(() => {
  const stats = summarizeLookouts(
    rows.value.map((row) => ({
      status: String(row.status),
      events: eventsOf(row),
      pendingReturn: (returnMap.value.get(String(row['瞭望台编号'])) ?? 0) > 0,
    })),
  )
  return [
    { label: '瞭望台总数', value: stats.total },
    { label: '正常值守数', value: stats.onDuty },
    { label: '故障台数', value: stats.fault },
    { label: '临时关闭数', value: stats.closed },
    { label: '累计恢复台数', value: stats.recovered },
    { label: '待归还装备台数', value: stats.pendingReturns },
  ]
})

function versionOf(row: EntryRow): number {
  return typeof row.rowVersion === 'number' ? row.rowVersion : 1
}

function eventsOf(row: EntryRow): LookoutEvent[] {
  return Array.isArray(row.events) ? (row.events as LookoutEvent[]) : []
}

function eventCount(row: EntryRow): number {
  return eventsOf(row).length
}

function legalActionsOf(row: EntryRow): string[] {
  return legalActions(String(row.status))
}

function kindLabel(kind: LookoutEvent['kind']): string {
  const labels: Record<LookoutEvent['kind'], string> = {
    duty: '值守',
    fault: '故障',
    repair: '维修',
    recovery: '恢复',
    reopen: '重启',
    close: '关闭',
    migration: '迁移',
  }
  return labels[kind]
}

function openHistory(row: EntryRow) {
  historyRow.value = row
}

function closeHistory() {
  historyRow.value = null
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

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  // 把页面看到的 rowVersion 作为乐观锁版本传入，并发的第二个动作会被 CAS 拒绝。
  const result = applyAction(meta.key, Number(row.id), action, {
    expectedVersion: versionOf(row),
  })
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    if (historyRow.value) {
      const latest = payload.items.find((row) => row.id === historyRow.value?.id)
      historyRow.value = latest ?? null
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '瞭望台管理列表读取失败'
  }
}

// 跨标签页并发：其他页签提交后本页缓存作废，立刻按最新状态渲染，避免基于旧版本继续操作。
function onStorageChange(event: StorageEvent) {
  if (event.key && event.key.includes('entries')) {
    reload()
  }
}

onMounted(() => {
  reload()
  window.addEventListener('storage', onStorageChange)
})
onUnmounted(() => {
  window.removeEventListener('storage', onStorageChange)
})
</script>

<style scoped>
.muted { color: var(--muted); font-size: 12px; font-weight: normal; }
.modal-mask {
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45);
  display: flex; justify-content: flex-end; z-index: 50;
}
.modal-panel {
  width: 420px; max-width: 90vw; height: 100%; background: #fff;
  padding: 16px 18px; overflow-y: auto; box-shadow: -8px 0 24px rgba(15, 23, 42, 0.2);
}
.modal-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.modal-head h3 { font-size: 15px; margin: 0; }
.timeline { list-style: none; margin: 12px 0 0; padding: 0; }
.timeline-line { display: flex; gap: 10px; align-items: flex-start; }
.timeline-badge {
  display: inline-block; min-width: 34px; text-align: center;
  border-radius: 999px; padding: 2px 8px; font-size: 12px;
  background: #eef2f7; color: #334155;
}
.timeline-badge[data-kind='fault'] { background: #fee4e2; color: #b42318; }
.timeline-badge[data-kind='repair'] { background: #fef3c7; color: #92400e; }
.timeline-badge[data-kind='recovery'],
.timeline-badge[data-kind='reopen'] { background: #dcfce7; color: #166534; }
.timeline-badge[data-kind='migration'] { background: #e0e7ff; color: #3730a3; }
.timeline-title { margin: 0 0 2px; font-size: 13px; }
</style>

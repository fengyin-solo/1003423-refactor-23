<template>
  <section class="page" data-module="equipment">
    <header class="page-head">
      <div>
        <h2>消防装备管理</h2>
        <p class="page-desc">维护消防装备，围绕装备编号、装备名称、装备类型、规格型号做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记消防装备</button>
        <button class="btn" type="button" @click="exportRows">导出消防装备清单</button>
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

    <h3 class="ledger-title">装备待归还台账（随瞭望台运行状态联动）</h3>
    <table class="data-table ledger-table">
      <thead>
        <tr>
          <th>装备编号</th>
          <th>所属瞭望台</th>
          <th>所在山头</th>
          <th>登记原因</th>
          <th>登记时间</th>
          <th>台账状态</th>
          <th>核销时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in returnLedger" :key="item.id">
          <td>{{ item.装备编号 }}</td>
          <td>{{ item.瞭望台编号 }}</td>
          <td>{{ item.所在山头 }}</td>
          <td>{{ item.登记原因 }}</td>
          <td>{{ item.登记时间 }}</td>
          <td :class="item.status === '待归还' ? 'return-open' : 'return-done'">{{ item.status }}</td>
          <td>{{ item.核销时间 ?? '—' }}</td>
        </tr>
        <tr v-if="!returnLedger.length">
          <td colspan="7" class="empty-state">暂无待归还记录：瞭望台故障、维修或临时关闭时会自动挂账，恢复值守后自动销账</td>
        </tr>
      </tbody>
    </table>

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
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无消防装备数据，可先登记消防装备</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条消防装备记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listEquipmentReturns,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EquipmentReturnEntry } from '@/domain/lookout/types'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('equipment')
const columns = ["装备编号", "装备名称", "装备类型", "规格型号", "保管林场", "购入日期", "最近检修日", "装备状态"]
const actions = ["领用装备", "送检登记", "报废装备"]
const statuses = ["可用", "已领用", "待检修", "已报废"]
const staticStats = [{"label": "装备总数", "value": 0}, {"label": "可用装备", "value": 0}, {"label": "待检修数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const returnLedger = ref<EquipmentReturnEntry[]>([])
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 待归还数来自瞭望台联动台账，装备页第一时间能看到要追回哪些装备。
const stats = computed(() => [
  ...staticStats.map((card) => ({
    ...card,
    value: card.label === '装备总数'
      ? rows.value.length
      : card.label === '可用装备'
        ? rows.value.filter((row) => String(row.status) === '可用').length
        : rows.value.filter((row) => String(row.status) === '待检修').length,
  })),
  { label: '待归还装备', value: returnLedger.value.filter((item) => item.status === '待归还').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '消防装备登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    returnLedger.value = listEquipmentReturns()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '消防装备列表读取失败'
  }
}

onMounted(() => {
  reload()
  window.addEventListener('storage', reload)
})
</script>

<style scoped>
.ledger-title { font-size: 14px; margin: 4px 0 8px; }
.ledger-table { margin-bottom: 16px; }
.return-open { color: #b42318; font-weight: 600; }
.return-done { color: #166534; }
</style>

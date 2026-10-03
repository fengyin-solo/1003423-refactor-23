/** 瞭望台运行状态的公共类型：状态机、交接记录、待归还台账共用。 */

// 一次状态流转事件，按时间顺序追加，只增不改——历史交接记录就靠它留痕。
export type LookoutEvent = {
  seq: number
  at: string
  action: string
  from: string
  to: string
  kind: 'duty' | 'fault' | 'repair' | 'recovery' | 'reopen' | 'close' | 'migration'
  note?: string
}

// 装备待归还台账：瞭望台故障/关闭时挂账，恢复值守时销账。
export type EquipmentReturnEntry = {
  id: number
  装备编号: string
  瞭望台编号: string
  所在山头: string
  登记原因: string
  登记时间: string
  status: '待归还' | '已归还'
  核销时间?: string
  核销原因?: string
}

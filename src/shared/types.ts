// 主进程与渲染进程共用的基础类型

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

// 桌宠模式：normal 为日常形态，focus 为「敲键盘」形态
export type PetMode = 'normal' | 'focus'

// 状态机状态（对应技术方案 3.4 迁移表）
export type PetState =
  | 'Idle'
  | 'Action'
  | 'Interact'
  | 'Grabbed'
  | 'Dragging'
  | 'Dropped'
  | 'Land'

// 状态机事件
export type PetEvent =
  | { t: 'CLICK' }
  | { t: 'DRAG_START'; pt: Point }
  | { t: 'DRAG_END'; pt: Point }
  | { t: 'ANIM_END'; clipId: string }
  | { t: 'IDLE_TIMEOUT' }
  | { t: 'MODE_CHANGED'; mode: PetMode }

/** 主进程 → 渲染层 的输入事件子集 */
export type PetInputEvent = Extract<PetEvent, { t: 'CLICK' | 'DRAG_START' | 'DRAG_END' }>

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 渲染层上报的命中掩码。
 * cells 是 res×res 的 0/1 网格，覆盖 bbox 所标示的角色包围盒（窗口内 DIP 坐标），
 * 主进程据此判断光标是否落在角色的不透明像素上。
 */
export interface HitMask {
  res: number
  cells: Uint8Array
  bbox: Rect
}

export const IPC_CHANNELS = {
  /** 渲染层 → 主进程：上报新的命中掩码 */
  MASK: 'pet:mask',
  /** 主进程 → 渲染层：点击 / 拖拽输入事件 */
  INPUT: 'pet:input'
} as const


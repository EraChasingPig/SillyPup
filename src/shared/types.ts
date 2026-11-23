// 主进程与渲染进程共用的基础类型

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

/** 桌宠基准窗口尺寸（缩放比例为 1 时） */
export const PET_BASE_SIZE = 300
/** 桌宠缩放范围：0.6 ~ 1.6 倍 */
export const PET_SCALE_MIN = 0.6
export const PET_SCALE_MAX = 1.6

/**
 * 拎起时鼠标「捏住」的位置，取悬挂姿态头顶后颈处（300×300 画布坐标）。
 * 拖拽期间窗口按这个点跟手，缩放时按比例换算。
 */
export const PET_GRAB_ANCHOR: Point = { x: 150, y: 66 }

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
  | 'Sleepy'
  | 'Sleeping'
  | 'Wake'
  | 'HomeworkEnter'
  | 'Homework'
  | 'Doze'
  | 'HomeworkDone'
  | 'Roam'

// 状态机事件
export type PetEvent =
  | { t: 'CLICK' }
  | { t: 'DRAG_START'; pt: Point }
  | { t: 'DRAG_END'; pt: Point }
  | { t: 'ANIM_END'; clipId: string }
  | { t: 'IDLE_TIMEOUT' }
  | { t: 'SLEEP' }
  | { t: 'WAKE' }
  | { t: 'POMO_START' }
  | { t: 'POMO_END' }
  | { t: 'DOZE' }
  | { t: 'WALK_START' }
  | { t: 'WALK_END' }
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
  INPUT: 'pet:input',
  /** 主进程 → 渲染层：番茄钟每秒心跳 */
  POMODORO_TICK: 'pomodoro:tick',
  /** 主进程 → 渲染层：番茄钟结束 */
  POMODORO_DONE: 'pomodoro:done',
  /** 自定义时长输入窗口：确认 */
  PROMPT_SUBMIT: 'prompt:submit',
  /** 自定义时长输入窗口：取消 */
  PROMPT_CANCEL: 'prompt:cancel',
  /** 主进程 → 渲染层：Focus 模式与按键气泡开关状态 */
  FOCUS_STATE: 'pet:focus-state',
  /** 主进程 → 渲染层：全局按键（用于气泡显示） */
  KEY_EVENT: 'pet:key',
  /** 主进程 → 渲染层：全局光标位置（用于鼠标垫映射） */
  CURSOR: 'pet:cursor',
  /** 主进程 → 渲染层：桌宠缩放比例 */
  SCALE: 'pet:scale',
  /** 主进程 → 渲染层：托盘发起的移动指令 */
  LOCOMOTION: 'pet:locomotion',
  /** 渲染层 → 主进程：开始 / 停止窗口水平位移 */
  MOVE: 'pet:move'
} as const

/** 移动指令入口（目前只有托盘临时菜单） */
export type LocomotionCmd = 'walk-left' | 'walk-right' | 'stop'

/** 窗口水平位移方向，null 表示停在原地 */
export type MoveDirection = 'left' | 'right' | null

export interface PomodoroTick {
  remainMs: number
  running: boolean
}

/** 自定义时长的合法范围（分钟） */
export const POMODORO_MIN_MINUTES = 1
export const POMODORO_MAX_MINUTES = 999

/** Focus 模式的开关集合，由主进程在启动与菜单切换时下发 */
export interface FocusState {
  focusMode: boolean
  keyBubble: boolean
}

/** 一次轮询里检测到的新按键（已去重、已限流） */
export interface KeyEventPayload {
  label: string
}

/** 全局光标位置与所在显示器的可用区域（均为 DIP） */
export interface CursorPayload {
  x: number
  y: number
  workArea: Rect
}


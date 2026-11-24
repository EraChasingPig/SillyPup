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

/**
 * 角色站立时画面可见内容的上沿（300×300 画布坐标，实测 alpha 上边界）。
 * 苹果到达判定与可达带都以「小狗可见上沿」为基准，而不是窗口上边。
 */
export const PET_VISIBLE_TOP = 81

/** 苹果图标在缩放 1 时的尺寸（由 sit_eat_happy 素材抠出） */
export const APPLE_ICON_SIZE: Size = { width: 52, height: 57 }
/** 苹果中心相对光标的纵向偏移（缩放 1 时的 DIP） */
export const APPLE_FOLLOW_OFFSET_Y = 18
/** 到点后苹果底边相对小狗窗口顶部的 y（坐姿反推，缩放 1 时报 30） */
export const APPLE_PIN_BOTTOM_Y = 30
/** 到点后苹果底部中心相对小狗窗口左侧的 x：朝左 / 朝右（镜像） */
export const APPLE_PIN_CX_LEFT = 137
export const APPLE_PIN_CX_RIGHT = 163
/** 到点判定容差（DIP）：水平看窗口中心，垂直看苹果底边与小狗可见上沿 */
export const APPLE_ARRIVE_DX = 55
export const APPLE_ARRIVE_DY = 75
/** 苹果轮次超时时间：超过则自动放弃 */
export const APPLE_ROUND_TIMEOUT_MS = 120000

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
  | 'SitEnter'
  | 'SitIdle'
  | 'SitEat'
  | 'SitAngry'
  | 'PointPeek'
  | 'PointShow'
  | 'JumpPrepare'
  | 'JumpLoop'
  | 'JumpLand'
  | 'AppleSeek'

/** 跳跃方向；inPlace 表示原地跳一轮，不移动窗口 */
export type JumpDirection = 'up' | 'down' | 'inPlace'

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
  /** returnTo：走完后回到哪个状态；缺省回 Idle（托盘散步、日常行走） */
  | { t: 'WALK_START'; returnTo?: PetState }
  | { t: 'WALK_END' }
  | { t: 'SIT_TRIGGER' }
  | { t: 'SIT_TIMEOUT' }
  | { t: 'POINT_TRIGGER' }
  /** stepDip：每跳的窗口位移（已按缩放换算，DIP）；returnTo 缺省回 Idle */
  | { t: 'JUMP_START'; dir: JumpDirection; stepDip?: number; returnTo?: PetState }
  | { t: 'JUMP_LAND' }
  | { t: 'APPLE_SUMMON' }
  | { t: 'APPLE_ARRIVED' }
  | { t: 'APPLE_CANCEL' }
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
  MOVE: 'pet:move',
  /** 渲染层 → 主进程：下发一轮跳跃的窗口垂直位移时间表 */
  JUMP_MOVE: 'pet:jump-move',
  /** 渲染层 → 主进程：取消跳跃位移（被打断或已落地） */
  JUMP_CANCEL: 'pet:jump-cancel',
  /** 渲染层 → 主进程：drop_land 已开播，开始松手后的悬停与下落 */
  DROP_START: 'pet:drop-start',
  /** 主进程 → 渲染层：右键菜单召唤苹果，开始一轮寻找 */
  APPLE_SUMMON: 'apple:summon',
  /** 主进程 → 渲染层：苹果当前位置（屏幕 DIP，中心 x + 底边 y） */
  APPLE_POS: 'apple:pos',
  /** 主进程 → 渲染层：苹果轮次超时，已自动收起 */
  APPLE_EXPIRED: 'apple:expired',
  /** 渲染层 → 主进程：到点后把苹果钉在指定位置（屏幕 DIP） */
  APPLE_PIN: 'apple:pin',
  /** 渲染层 → 主进程：sit_enter 末尾让苹果淡出 */
  APPLE_FADE_OUT: 'apple:fade-out',
  /** 渲染层 → 主进程：本轮结束 / 中断，立刻收起苹果 */
  APPLE_END: 'apple:end'
} as const

/** 苹果位置：底部中心坐标（屏幕 DIP） */
export interface ApplePos {
  cx: number
  bottom: number
}

/** 跳跃时间表中的一次腾空区间，单位毫秒，相对 jump_loop 开始播放 */
export interface JumpHop {
  startMs: number
  endMs: number
}

/** 一轮跳跃的窗口垂直位移计划，由渲染层按素材实测节奏下发 */
export interface JumpMovePlan {
  dir: 'up' | 'down'
  /** 每跳的窗口位移（DIP，已按当前缩放换算） */
  stepDip: number
  hops: JumpHop[]
}

/** 移动指令入口（托盘临时菜单：走路与上下跳） */
export type LocomotionCmd =
  | 'walk-left'
  | 'walk-right'
  | 'jump-up'
  | 'jump-down'
  | 'stop'

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
  /** 左上角状态标注是否显示 */
  showState: boolean
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


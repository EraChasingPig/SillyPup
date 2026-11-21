// 主进程与渲染进程共用的基础类型（M0 最小集）
export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

// 桌宠状态（M0 仅占位，后续由 FSM 完整接管）
export type PetMode = 'normal' | 'focus'

import type { PetEvent, PetMode, PetState } from '../../../shared/types'

/** 各状态对应的动画 clip（与 clips.json 的 key 一一对应） */
export const STATE_CLIP: Record<PetState, string> = {
  Idle: 'idle_breath',
  Action: 'action_float',
  Interact: 'interact_hop',
  Grabbed: 'grab_startle',
  Dragging: 'drag_kick',
  Dropped: 'dropped_fall',
  Land: 'land_bounce'
}

/** 交互结束后进入冷却，冷却期的 CLICK 直接丢弃（不重放、不重置） */
const INTERACT_COOLDOWN_MS = 800

/**
 * 桌宠状态机。迁移规则对应技术方案 3.4：
 * - 所有状态都可被 DRAG_START 打断进入 Grabbed（拖拽优先级高于点击）
 * - Interact 期间屏蔽重复 CLICK，但不屏蔽拖拽
 * - mode（normal / focus）与状态机正交，MODE_CHANGED 不产生状态迁移
 */
export class PetFSM {
  private state: PetState = 'Idle'
  private mode: PetMode = 'normal'
  private cooldownUntil = 0

  constructor(
    private readonly onTransition: (from: PetState, to: PetState, e: PetEvent) => void
  ) {}

  get current(): PetState {
    return this.state
  }

  get currentMode(): PetMode {
    return this.mode
  }

  get currentClipId(): string {
    return STATE_CLIP[this.state]
  }

  send(e: PetEvent): void {
    const now = performance.now()
    const next = this.resolve(this.state, e, now)
    if (!next || next === this.state) return

    const from = this.state
    this.state = next

    if (from === 'Interact' && next === 'Idle') {
      this.cooldownUntil = now + INTERACT_COOLDOWN_MS
    }

    this.onTransition(from, next, e)
  }

  private resolve(state: PetState, e: PetEvent, now: number): PetState | null {
    switch (e.t) {
      case 'DRAG_START':
        return state === 'Grabbed' || state === 'Dragging' ? null : 'Grabbed'

      case 'CLICK': {
        if (now < this.cooldownUntil) return null
        const busy: PetState[] = ['Interact', 'Grabbed', 'Dragging', 'Dropped', 'Land']
        return busy.includes(state) ? null : 'Interact'
      }

      case 'DRAG_END':
        return state === 'Grabbed' || state === 'Dragging' ? 'Dropped' : null

      case 'ANIM_END':
        switch (state) {
          case 'Grabbed':
            return 'Dragging'
          case 'Dropped':
            return 'Land'
          case 'Land':
          case 'Interact':
            return 'Idle'
          default:
            return null
        }

      case 'IDLE_TIMEOUT':
        // Action 也接受超时回落，用于无交互时的往返演示
        return state === 'Idle' ? 'Action' : state === 'Action' ? 'Idle' : null

      case 'MODE_CHANGED':
        this.mode = e.mode
        return null
    }
  }
}

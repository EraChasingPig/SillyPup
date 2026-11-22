import type { PetEvent, PetMode, PetState } from '../../../shared/types'

/** 各状态对应的动画 clip（与 clips.json 的 key 一一对应） */
export const STATE_CLIP: Record<PetState, string> = {
  Idle: 'idle_breath',
  // Action / Interact 实际从日常动作池随机取，这里只作为兜底
  Action: 'action_wag',
  Interact: 'action_wag',
  Grabbed: 'grab_startle',
  Dragging: 'grab_hold',
  // 落地、眩晕、爬起、待机都包含在同一段素材里，播完直接回 Idle
  Dropped: 'drop_land',
  Sleepy: 'sleep_enter',
  Sleeping: 'sleep_loop',
  Wake: 'sleep_wake',
  HomeworkEnter: 'homework_enter',
  Homework: 'homework_loop',
  Doze: 'homework_doze',
  HomeworkDone: 'homework_done'
}

/** 写作业相关状态（专注期间这些状态由素材自己画书桌，不再叠加 Focus 场景） */
export function isHomeworkState(state: PetState): boolean {
  return (
    state === 'HomeworkEnter' ||
    state === 'Homework' ||
    state === 'Doze' ||
    state === 'HomeworkDone'
  )
}

/** 日常动作池：待机超时与点击共用，随机挑一个播放 */
export const DAILY_ACTION_CLIPS = ['action_wag', 'action_stretch', 'action_look', 'action_yawn']

/** 随机挑一个日常动作，尽量不与上一个重复 */
export function pickDailyAction(prev: string | null): string {
  const pool = DAILY_ACTION_CLIPS.filter((id) => id !== prev)
  const list = pool.length > 0 ? pool : DAILY_ACTION_CLIPS
  return list[Math.floor(Math.random() * list.length)] ?? 'action_wag'
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
        // 睡觉时点击是叫醒，不触发日常动作
        if (state === 'Sleepy' || state === 'Sleeping') return 'Wake'
        // 日常动作播放中忽略点击，避免 4 秒动作被半途打断后重新起播
        const busy: PetState[] = [
          'Action',
          'Interact',
          'Grabbed',
          'Dragging',
          'Dropped',
          'Wake',
          'HomeworkEnter',
          'Homework',
          'Doze',
          'HomeworkDone'
        ]
        return busy.includes(state) ? null : 'Interact'
      }

      case 'SLEEP':
        return state === 'Idle' || state === 'Action' ? 'Sleepy' : null

      case 'WAKE':
        return state === 'Sleepy' || state === 'Sleeping' ? 'Wake' : null

      case 'POMO_START':
        return state === 'Idle' ? 'HomeworkEnter' : null

      case 'POMO_END':
        return state === 'HomeworkEnter' || state === 'Homework' || state === 'Doze'
          ? 'HomeworkDone'
          : null

      case 'DOZE':
        return state === 'Homework' ? 'Doze' : null

      case 'DRAG_END':
        return state === 'Grabbed' || state === 'Dragging' ? 'Dropped' : null

      case 'ANIM_END':
        switch (state) {
          case 'Grabbed':
            return 'Dragging'
          case 'Dropped':
            return 'Idle'
          case 'Sleepy':
            return 'Sleeping'
          case 'HomeworkEnter':
          case 'Doze':
            return 'Homework'
          case 'HomeworkDone':
            return 'Idle'
          case 'Wake':
          case 'Interact':
          case 'Action':
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

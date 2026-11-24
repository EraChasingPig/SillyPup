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
  HomeworkDone: 'homework_done',
  // Roam 的动画由 Locomotion 编排，这里只作为兜底
  Roam: 'walk_loop',
  // 坐姿讨食：正面素材，按当前朝向镜像，与待机/走路的朝向保持一致
  SitEnter: 'sit_enter',
  SitIdle: 'sit_idle',
  SitEat: 'sit_eat_happy',
  SitAngry: 'sit_angry',
  // 指屏幕：背对/回头素材，同样按当前朝向镜像
  PointPeek: 'point_peek',
  PointShow: 'point_show',
  // 原地跳跃：起跳前 → 三次循环跳 → 落地回待机
  JumpPrepare: 'jump_prepare',
  JumpLoop: 'jump_loop',
  JumpLand: 'jump_land',
  // 找苹果：站立思考，由规划器逐段发起走 / 跳
  AppleSeek: 'idle_breath'
}

/** 坐姿讨食系列状态（正面朝观众，且都算「有互动」） */
export function isSitState(state: PetState): boolean {
  return (
    state === 'SitEnter' || state === 'SitIdle' || state === 'SitEat' || state === 'SitAngry'
  )
}

/** 指屏幕系列状态（播放期间算「有互动」，点击忽略、拖拽可打断） */
export function isPointState(state: PetState): boolean {
  return state === 'PointPeek' || state === 'PointShow'
}

/** 跳跃系列状态（整轮播放期间算「有互动」） */
export function isJumpState(state: PetState): boolean {
  return state === 'JumpPrepare' || state === 'JumpLoop' || state === 'JumpLand'
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
export const DAILY_ACTION_CLIPS = [
  'action_wag',
  'action_stretch',
  'action_look',
  'action_yawn',
  'action_taunt'
]

/** 日常互动池：整轮跳跃作为一个条目，不单独设概率 */
export const DAILY_ITEMS = [...DAILY_ACTION_CLIPS, 'jump']

/**
 * 随机挑一个日常互动，尽量不与上一个重复。
 * allowJump=false 时（大动作冷却期内）暂时把跳跃从池子里剔除。
 */
export function pickDailyItem(prev: string | null, allowJump: boolean): string {
  const allowed = DAILY_ITEMS.filter((id) => allowJump || id !== 'jump')
  const pool = allowed.filter((id) => id !== prev)
  const list = pool.length > 0 ? pool : allowed
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
  /** 行走结束后回到哪个状态；找苹果期间为 AppleSeek */
  private walkReturn: PetState = 'Idle'
  /** 跳跃结束后回到哪个状态；找苹果期间为 AppleSeek */
  private jumpReturn: PetState = 'Idle'
  /** 本轮坐姿是因为苹果到达触发的，SitEnter 播完要接着吃苹果 */
  private appleEatPending = false

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
        // 坐姿等待时点击 = 喂苹果
        if (state === 'SitIdle') return 'SitEat'
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
          'HomeworkDone',
          'Roam',
          'SitEnter',
          'SitEat',
          'SitAngry',
          'PointPeek',
          'PointShow',
          'JumpPrepare',
          'JumpLoop',
          'JumpLand',
          'AppleSeek'
        ]
        return busy.includes(state) ? null : 'Interact'
      }

      case 'WALK_START':
        // 找苹果时也会发起行走，走完要回到 AppleSeek 继续规划
        if (state !== 'Idle' && state !== 'AppleSeek') return null
        this.walkReturn = e.returnTo ?? 'Idle'
        return 'Roam'

      case 'WALK_END': {
        if (state !== 'Roam') return null
        const to = this.walkReturn
        this.walkReturn = 'Idle'
        return to
      }

      case 'SLEEP':
        // 只在真正的待机循环里入睡；正在播日常动作等一次性动画时等它播完，
        // 回到 Idle 后静置计时仍超时，下一帧会再次触发
        return state === 'Idle' ? 'Sleepy' : null

      case 'WAKE':
        return state === 'Sleepy' || state === 'Sleeping' ? 'Wake' : null

      case 'POMO_START':
        // 坐着讨食、看屏幕指东西时开番茄钟，也要能进入作业链
        return state === 'Idle' || isSitState(state) || isPointState(state)
          ? 'HomeworkEnter'
          : null

      case 'POMO_END':
        return state === 'HomeworkEnter' || state === 'Homework' || state === 'Doze'
          ? 'HomeworkDone'
          : null

      case 'DOZE':
        return state === 'Homework' ? 'Doze' : null

      case 'SIT_TRIGGER':
        // 与 CLICK 共用交互冷却，避免刚做完动作就立刻坐下
        if (now < this.cooldownUntil) return null
        return state === 'Idle' ? 'SitEnter' : null

      case 'SIT_TIMEOUT':
        // 坐太久没等到苹果，生气撒泼再起身
        return state === 'SitIdle' ? 'SitAngry' : null

      case 'POINT_TRIGGER':
        // 与 CLICK / SIT_TRIGGER 共用交互冷却
        if (now < this.cooldownUntil) return null
        return state === 'Idle' ? 'PointPeek' : null

      case 'JUMP_START':
        // 只在待机或找苹果的思考间隙起跳；托盘指令与日常池共用这条入口
        if (state !== 'Idle' && state !== 'AppleSeek') return null
        this.jumpReturn = e.returnTo ?? 'Idle'
        return 'JumpPrepare'

      case 'APPLE_SUMMON':
        // 苹果召唤打断日常行为（含散步、坐着等苹果），但拎起/作业/跳跃途中忽略
        if (
          state === 'AppleSeek' ||
          state === 'Grabbed' ||
          state === 'Dragging' ||
          state === 'Dropped' ||
          isHomeworkState(state) ||
          isJumpState(state)
        ) {
          return null
        }
        return 'AppleSeek'

      case 'APPLE_ARRIVED':
        if (state !== 'AppleSeek') return null
        this.appleEatPending = true
        return 'SitEnter'

      case 'APPLE_CANCEL':
        // 中断找苹果：无论当前在思考、走、跳还是坐下，都直接回待机
        if (state === 'AppleSeek') return 'Idle'
        if (state === 'Roam' && this.walkReturn === 'AppleSeek') {
          this.walkReturn = 'Idle'
          return 'Idle'
        }
        if (isJumpState(state) && this.jumpReturn === 'AppleSeek') {
          this.jumpReturn = 'Idle'
          this.appleEatPending = false
          return 'Idle'
        }
        if (state === 'SitEnter' && this.appleEatPending) {
          this.appleEatPending = false
          return 'Idle'
        }
        return null

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
          case 'SitEnter':
            // 找苹果到点坐下的，播完直接开吃；普通讨食继续发呆
            if (this.appleEatPending) {
              this.appleEatPending = false
              return 'SitEat'
            }
            return 'SitIdle'
          case 'SitEat':
          case 'SitAngry':
            return 'Idle'
          case 'PointPeek':
            return 'PointShow'
          case 'PointShow':
            return 'Idle'
          case 'JumpPrepare':
            return 'JumpLoop'
          case 'JumpLand': {
            const to = this.jumpReturn
            this.jumpReturn = 'Idle'
            return to
          }
          case 'Wake':
          case 'Interact':
          case 'Action':
            return 'Idle'
          default:
            return null
        }

      case 'JUMP_LAND':
        // jump_loop 循环播放，由编排器决定落地的时机
        return state === 'JumpLoop' ? 'JumpLand' : null

      case 'IDLE_TIMEOUT':
        // Action 也接受超时回落，用于无交互时的往返演示
        return state === 'Idle' ? 'Action' : state === 'Action' ? 'Idle' : null

      case 'MODE_CHANGED':
        this.mode = e.mode
        return null
    }
  }
}

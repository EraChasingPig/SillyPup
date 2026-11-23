import type { MoveDirection } from '../../../shared/types'

/** 桌宠朝向：素材只做朝左，朝右时绘制镜像 */
export type Facing = 'left' | 'right'

/** 行走四段：起步 / 匀速循环 / 原地掉头 / 急停 */
export type LocoPhase = 'start' | 'loop' | 'turn' | 'stop'

/**
 * 起步素材前 1.5 秒只是变表情、压低身体做准备，脚还在原地，
 * 之后才真正迈出步子；位移要等这一刻再启动，否则看起来像在平移。
 */
const START_MOVE_DELAY_MS = 1500

export interface LocoHooks {
  /** 播放某个 clip（会重置播放进度），resolve 表示该片段已切到前台 */
  play: (clipId: string) => Promise<void>
  /** 通知主进程开始 / 停止窗口水平位移 */
  move: (dir: MoveDirection) => void
  /** 整段行走结束，状态机可以回 Idle */
  finish: () => void
}

/**
 * 行走编排器：把四个原子动作串成连续的移动。
 *
 * 硬约束：walk_turn 与 walk_stop 的首帧都对齐走路循环的起始帧，
 * 所以掉头与刹车只能在**循环边界**切换，且至少要播满一个完整循环（0.6 秒）。
 */
export class Locomotion {
  private facing: Facing = 'left'
  private phase: LocoPhase | null = null
  /** 期望朝向；与 facing 不同时，在下一个循环边界掉头 */
  private desired: Facing | null = null
  private stopping = false
  /** 当前 loop 阶段已经播完的完整循环数 */
  private cycles = 0
  /**
   * 掉头段开始时的朝向。掉头片段自带「从该朝向转到反向」的全过程，
   * 结束时 facing 会翻面，但这一段的画面必须仍按开始时的朝向决定是否镜像，
   * 否则翻转后的那一帧会把末帧镜像成反方向。
   */
  private turnFacing: Facing = 'left'
  private moveTimer: number | null = null

  constructor(private readonly hooks: LocoHooks) {}

  get active(): boolean {
    return this.phase !== null
  }

  get phaseName(): LocoPhase | null {
    return this.phase
  }

  get currentFacing(): Facing {
    return this.facing
  }

  get isLooping(): boolean {
    return this.phase === 'loop'
  }

  /** 掉头片段是否需要镜像（固定取掉头开始时的朝向） */
  get turnMirrored(): boolean {
    return this.turnFacing === 'right'
  }

  /** 请求朝某个方向走；行走中调用即改变目标方向 */
  request(dir: Facing): void {
    this.desired = dir
    this.stopping = false
    if (this.phase) return
    this.beginStart()
  }

  /** 请求停下：会先走完当前循环再刹车 */
  halt(): void {
    this.stopping = true
    this.desired = null
    // 只在循环边界切刹车，这里不做任何即时切换
  }

  /** 立刻中断（拖拽、番茄钟、入睡），不做收尾动画 */
  abort(): void {
    this.clearTimer()
    this.hooks.move(null)
    this.phase = null
    this.desired = null
    this.stopping = false
    this.cycles = 0
  }

  /** once 片段播完（朝向翻转在 turn 结束时发生） */
  onClipEnd(): void {
    switch (this.phase) {
      case 'start':
        this.beginLoop()
        break
      case 'turn':
        this.facing = this.facing === 'left' ? 'right' : 'left'
        this.beginLoop()
        break
      case 'stop':
        if (this.desired) {
          // 刹车期间又要求走路，直接接着起步，状态机继续停在 Roam
          this.beginStart()
        } else {
          this.phase = null
          this.hooks.finish()
        }
        break
      default:
        break
    }
  }

  /** loop 每播完一个完整循环时调用 */
  onLoopCycle(): void {
    if (this.phase !== 'loop') return
    this.cycles += 1
    this.checkExitLoop()
  }

  dispose(): void {
    this.clearTimer()
  }

  private checkExitLoop(): void {
    if (this.phase !== 'loop' || this.cycles < 1) return
    if (this.stopping) {
      this.beginStop()
      return
    }
    if (this.desired && this.desired !== this.facing) this.beginTurn()
  }

  private beginStart(): void {
    this.phase = 'start'
    this.cycles = 0
    this.hooks.move(null)
    this.clearTimer()
    // 延迟从片段真正开始播放算起：首次加载要解码几十帧，
    // 若从调用 play 的时刻算，真正走起来时前段准备动作已经被吃掉一截
    void this.hooks.play('walk_start').then(() => {
      if (this.phase !== 'start') return
      this.moveTimer = window.setTimeout(() => {
        this.moveTimer = null
        if (this.phase === 'start') this.hooks.move(this.facing)
      }, START_MOVE_DELAY_MS)
    })
  }

  private beginLoop(): void {
    this.phase = 'loop'
    this.cycles = 0
    void this.hooks.play('walk_loop')
    this.hooks.move(this.facing)
  }

  private beginTurn(): void {
    this.phase = 'turn'
    this.turnFacing = this.facing
    void this.hooks.play('walk_turn')
    this.hooks.move(null)
  }

  private beginStop(): void {
    this.phase = 'stop'
    void this.hooks.play('walk_stop')
    this.hooks.move(null)
  }

  private clearTimer(): void {
    if (this.moveTimer !== null) {
      clearTimeout(this.moveTimer)
      this.moveTimer = null
    }
  }
}

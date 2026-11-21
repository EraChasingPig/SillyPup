import { powerMonitor } from 'electron'

export interface PomodoroCallbacks {
  onTick: (remainMs: number, running: boolean) => void
  onDone: () => void
}

/**
 * 番茄钟服务（技术方案 3.5 ⑤）。
 *
 * 计时只认绝对时间戳 `deadline`，每秒用 `deadline - Date.now()` 重算剩余。
 * 不用「每秒减一」的累加计数——系统睡眠期间定时器不走，累加必然偏差。
 * `powerMonitor.resume` 后立刻重算一次，睡眠中跨过 deadline 会立即判定完成。
 */
export class PomodoroService {
  private deadline = 0
  private timer: NodeJS.Timeout | null = null
  private readonly onResume = (): void => this.recheck()

  constructor(private readonly cb: PomodoroCallbacks) {
    powerMonitor.on('resume', this.onResume)
  }

  get running(): boolean {
    return this.deadline > 0
  }

  get remainMs(): number {
    return this.deadline > 0 ? Math.max(0, this.deadline - Date.now()) : 0
  }

  start(minutes: number): void {
    this.clearTimer()
    const ms = Math.max(1, minutes) * 60_000
    this.deadline = Date.now() + ms
    this.cb.onTick(ms, true)
    this.timer = setInterval(() => this.recheck(), 1000)
  }

  stop(): void {
    this.clearTimer()
    this.deadline = 0
    this.cb.onTick(0, false)
  }

  dispose(): void {
    powerMonitor.removeListener('resume', this.onResume)
    this.clearTimer()
  }

  private recheck(): void {
    if (this.deadline === 0) return

    const remain = this.deadline - Date.now()
    if (remain <= 0) {
      this.clearTimer()
      this.deadline = 0
      this.cb.onTick(0, false)
      this.cb.onDone()
      return
    }

    this.cb.onTick(remain, true)
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}

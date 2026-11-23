/**
 * 拎起时的悬挂摆动：把小笨狗的身体当成受迫阻尼摆。
 * 手（后颈抓取点）横向加速时身体向反方向甩开，停手后回摆几次再静止。
 * 只输出一个绕抓取点的旋转角，不依赖任何素材。
 */

/** 自然频率（Hz）：决定「晃得多快」 */
const FREQ_HZ = 1.4
/** 阻尼比：越小回摆次数越多 */
const DAMPING = 0.26
/** 最大倾角（弧度，约 9°）：整体只是轻微晃动，柔软感交给切片弯曲 */
const MAX_TILT = 0.16
/** 下半身滞后跟随整体角度的时间常数（秒），差值产生弯曲 */
const BEND_TAU = 0.055
/** 滞后角换算成「脚底横向偏移」的等效摆长（像素） */
const BEND_LEVER = 380
/** 脚底处的弯曲偏移上限（像素） */
const MAX_BEND = 40
/** 加速度换算倾角的增益（弧度 / (DIP/s²)）：1500 DIP/s² 约到满幅 */
const ACC_GAIN = 0.00015
/** 速度增益（弧度 / (DIP/s)）：让身体略微拖在手的后面 */
const VEL_GAIN = 0.00009
/** 加速度死区，压住窗口坐标取整带来的噪声 */
const ACC_DEADZONE = 120
/** 速度 / 加速度低通时间常数（秒） */
const VEL_TAU = 0.03
const ACC_TAU = 0.04

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export class Sway {
  /** 当前倾角（弧度，正值为身体向左倒、脚甩到左边） */
  private angle = 0
  private omega = 0
  /** 下半身滞后的等效角度，与 angle 的差就是弯曲量 */
  private lagAngle = 0
  private bendPx = 0
  private vx = 0
  private prevVx = 0
  private ax = 0
  private lastX: number | null = null
  private lastAt = 0
  private ignoreUntil = 0

  get tilt(): number {
    return this.angle
  }

  /** 脚底处的弯曲偏移（像素，正值为向右偏移）。0 表示不变形，按原画面整张绘制 */
  get bend(): number {
    return this.bendPx
  }

  /**
   * 开始一次新的悬挂。
   * ignoreMs：先忽略这段时间的采样——拎起瞬间窗口有个「把光标对齐到后颈」的缓动，
   * 会伪造出一个很大的横向速度。
   */
  begin(now: number, ignoreMs = 0): void {
    this.angle = 0
    this.omega = 0
    this.lagAngle = 0
    this.bendPx = 0
    this.vx = 0
    this.prevVx = 0
    this.ax = 0
    this.lastX = null
    this.ignoreUntil = now + ignoreMs
  }

  /** 每帧更新；windowX 传 window.screenX */
  update(now: number, dtMs: number, windowX: number): void {
    if (this.lastX === null || now < this.ignoreUntil) {
      // 忽略期内只记录位置，不产生速度
      this.lastX = windowX
      this.lastAt = now
      return
    }

    const winDt = Math.max((now - this.lastAt) / 1000, 0.004)
    const vRaw = (windowX - this.lastX) / winDt
    this.lastX = windowX
    this.lastAt = now

    // 窗口坐标是整数，直接差分噪声很大，先做一阶低通
    this.vx += (vRaw - this.vx) * (1 - Math.exp(-winDt / VEL_TAU))
    const aRaw = (this.vx - this.prevVx) / winDt
    this.prevVx = this.vx
    this.ax += (aRaw - this.ax) * (1 - Math.exp(-winDt / ACC_TAU))
    if (Math.abs(this.ax) < ACC_DEADZONE) this.ax = 0

    // 手向右加速 → 身体因为惯性留在左边；速度项让身体略微拖后
    const target = clamp(this.ax * ACC_GAIN + this.vx * VEL_GAIN, -MAX_TILT, MAX_TILT)

    // 欠阻尼弹簧；分步积分，dt 被挂起拉到 50ms 也不会发散
    const dt = Math.min(dtMs, 50) / 1000
    const w0 = Math.PI * 2 * FREQ_HZ
    const steps = 3
    const h = dt / steps
    for (let i = 0; i < steps; i++) {
      const acc = w0 * w0 * (target - this.angle) - 2 * DAMPING * w0 * this.omega
      this.omega += acc * h
      this.angle += this.omega * h
    }

    // 触顶时把角速度清零，避免在边界上来回弹
    if (this.angle > MAX_TILT) {
      this.angle = MAX_TILT
      if (this.omega > 0) this.omega = 0
    } else if (this.angle < -MAX_TILT) {
      this.angle = -MAX_TILT
      if (this.omega < 0) this.omega = 0
    }

    // 下半身滞后于整体旋转：脚底相对刚体位置还差多少，就横移多少。
    // 手停住时整体角度已经在回摆，下半身还停在原来的弯度上，于是多甩一截再跟上
    this.lagAngle += (this.angle - this.lagAngle) * (1 - Math.exp(-dt / BEND_TAU))
    this.bendPx = clamp((this.angle - this.lagAngle) * BEND_LEVER, -MAX_BEND, MAX_BEND)
  }
}

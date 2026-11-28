import { BrowserWindow, screen } from 'electron'
import type { MoveDirection } from '../shared/types'
import { sizeForScale } from './window'

/** 行走速度（DIP/s）：按 walk_loop 每循环步幅标定，实机再微调 */
const WALK_SPEED = 110
/** 离显示器工作区左右边缘保留的最小间距 */
const EDGE_MARGIN = 15
/** 位移积分间隔，约 60Hz */
const TICK_MS = 16

export interface Mover {
  /** 设置位移方向；null 表示立刻停住 */
  setDirection: (dir: MoveDirection) => void
  dispose: () => void
}

/**
 * 桌宠水平位移执行者：窗口位置只由主进程修改。
 * 走到工作区边缘时只做位置钳制，不打断动画（顶墙继续走）。
 */
export function createMover(win: BrowserWindow, getScale: () => number): Mover {
  let dir: -1 | 0 | 1 = 0
  let last = performance.now()

  const step = (): void => {
    const now = performance.now()
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    if (dir === 0 || win.isDestroyed()) return

    const [x, y] = win.getPosition()
    const b = win.getBounds()
    // 非整数缩放下一律用带尺寸的 setBounds 移动，setPosition 会把窗口越撑越大
    const size = sizeForScale(getScale())
    const wa = screen.getDisplayNearestPoint({ x: x + b.width / 2, y: y + b.height / 2 }).workArea
    const minX = wa.x + EDGE_MARGIN
    const maxX = wa.x + wa.width - b.width - EDGE_MARGIN
    const next = Math.round(x + dir * WALK_SPEED * getScale() * dt)
    const clamped = Math.min(Math.max(next, minX), maxX)
    if (clamped !== x) win.setBounds({ x: clamped, y, width: size, height: size })
  }

  const timer = setInterval(step, TICK_MS)

  return {
    setDirection: (d) => {
      dir = d === 'left' ? -1 : d === 'right' ? 1 : 0
      last = performance.now()
    },
    dispose: () => clearInterval(timer)
  }
}

import { BrowserWindow, screen } from 'electron'
import type { JumpMovePlan } from '../shared/types'
import { sizeForScale } from './window'

/** 离显示器工作区上下边缘保留的最小间距，与水平行走一致 */
const EDGE_MARGIN = 15
/** 位移积分间隔，约 60Hz */
const TICK_MS = 16

export interface JumpMover {
  /** 按渲染层下发的时间表开始一轮垂直位移 */
  start: (plan: JumpMovePlan) => void
  /** 立刻停止，不再改动窗口位置 */
  cancel: () => void
  dispose: () => void
}

/** 平滑起落：起飞和落地都不突兀，中间段速度最快 */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

/**
 * 跳跃垂直位移执行者。
 * 渲染层按素材实测的腾空区间下发时间表，这里只负责把窗口 y 往对应方向搬，
 * 并在显示器工作区边缘钳制；动画本身不受影响（到顶继续原地跳）。
 */
export function createJumpMover(win: BrowserWindow, getScale: () => number): JumpMover {
  let timer: ReturnType<typeof setInterval> | null = null
  let plan: JumpMovePlan | null = null
  let startAt = 0
  let anchorX = 0
  let anchorY = 0
  let minY = 0
  let maxY = 0
  /** 移动时显式带上的窗口边长：非整数缩放下 setPosition 会把窗口撑大 */
  let size = 0

  const stop = (): void => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  const tick = (): void => {
    if (!plan || win.isDestroyed()) {
      stop()
      return
    }

    const t = performance.now() - startAt
    let offset = 0
    for (const hop of plan.hops) {
      const span = Math.max(1, hop.endMs - hop.startMs)
      const p = Math.min(1, Math.max(0, (t - hop.startMs) / span))
      offset += plan.stepDip * smoothstep(p)
    }

    const sign = plan.dir === 'up' ? -1 : 1
    const rawY = Math.round(anchorY + sign * offset)
    // 只钳制运动方向，不强行纠正起点：
    // 小狗贴在工作区底边外（例如贴着任务栏）时，起点 anchorY 会大于 maxY，
    // 若这里无条件夹到 maxY，jump_loop 第一帧就会把窗口瞬间上移，表现为
    // jump_prepare → jump_loop 之间瞬移。顶部向下跳同理。
    const y =
      sign < 0
        ? Math.max(rawY, Math.min(minY, anchorY))
        : Math.min(rawY, Math.max(maxY, anchorY))
    win.setBounds({ x: anchorX, y, width: size, height: size })

    const lastEnd = plan.hops[plan.hops.length - 1]?.endMs ?? 0
    if (t >= lastEnd + TICK_MS) {
      plan = null
      stop()
    }
  }

  return {
    start: (next) => {
      stop()
      if (win.isDestroyed()) return

      const b = win.getBounds()
      const wa = screen.getDisplayNearestPoint({
        x: b.x + b.width / 2,
        y: b.y + b.height / 2
      }).workArea
      plan = next
      anchorX = b.x
      anchorY = b.y
      size = sizeForScale(getScale())
      minY = wa.y + EDGE_MARGIN
      maxY = wa.y + wa.height - b.height - EDGE_MARGIN
      startAt = performance.now()
      timer = setInterval(tick, TICK_MS)
      tick()
    },
    cancel: () => {
      plan = null
      stop()
    },
    dispose: () => {
      plan = null
      stop()
    }
  }
}

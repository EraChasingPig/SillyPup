import { BrowserWindow, screen } from 'electron'
import type { JumpMovePlan } from '../shared/types'

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
export function createJumpMover(win: BrowserWindow): JumpMover {
  let timer: ReturnType<typeof setInterval> | null = null
  let plan: JumpMovePlan | null = null
  let startAt = 0
  let anchorX = 0
  let anchorY = 0
  let minY = 0
  let maxY = 0

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
    const y = Math.min(maxY, Math.max(minY, Math.round(anchorY + sign * offset)))
    win.setPosition(anchorX, y)

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

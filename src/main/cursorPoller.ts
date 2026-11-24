import { screen } from 'electron'
import type { CursorPayload } from '../shared/types'

export interface CursorPollerHandle {
  stop: () => void
  setEnabled: (on: boolean) => void
}

/**
 * 全局光标轮询。
 * 窗口常驻穿透时渲染层收不到窗口外的 mousemove，鼠标垫映射只能由主进程取光标。
 * 仅在 Focus 模式下启用；禁用时连定时器都不保留，避免空转。
 */
export function startCursorPoller(onCursor: (p: CursorPayload) => void): CursorPollerHandle {
  let timer: NodeJS.Timeout | null = null

  const tick = (): void => {
    const cursor = screen.getCursorScreenPoint()
    const wa = screen.getDisplayNearestPoint(cursor).workArea
    onCursor({
      x: cursor.x,
      y: cursor.y,
      workArea: { x: wa.x, y: wa.y, w: wa.width, h: wa.height }
    })
  }

  const stopTimer = (): void => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return {
    stop: stopTimer,
    setEnabled: (on: boolean) => {
      if (on) {
        if (!timer) timer = setInterval(tick, 16) // ~60Hz
        return
      }
      stopTimer()
    }
  }
}

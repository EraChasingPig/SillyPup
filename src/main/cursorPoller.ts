import { screen } from 'electron'
import type { CursorPayload } from '../shared/types'

export interface CursorPollerHandle {
  stop: () => void
  setEnabled: (on: boolean) => void
}

/**
 * 全局光标轮询。
 * 窗口常驻穿透时渲染层收不到窗口外的 mousemove，鼠标垫映射只能由主进程取光标。
 * 仅在 Focus 模式下启用，避免无谓的 IPC 开销。
 */
export function startCursorPoller(onCursor: (p: CursorPayload) => void): CursorPollerHandle {
  let enabled = false

  const timer = setInterval(() => {
    if (!enabled) return
    const cursor = screen.getCursorScreenPoint()
    const wa = screen.getDisplayNearestPoint(cursor).workArea
    onCursor({
      x: cursor.x,
      y: cursor.y,
      workArea: { x: wa.x, y: wa.y, w: wa.width, h: wa.height }
    })
  }, 16) // ~60Hz

  return {
    stop: () => clearInterval(timer),
    setEnabled: (on: boolean) => {
      enabled = on
    }
  }
}

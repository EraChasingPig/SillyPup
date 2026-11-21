import { BrowserWindow, screen } from 'electron'
import koffi from 'koffi'
import type { Point, Size } from '../shared/types'

const VK_LBUTTON = 0x01

// 通过 user32.GetAsyncKeyState 检测鼠标左键（轮询方案，不装钩子）
const user32 = koffi.load('user32.dll')
const GetAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)')

function isLeftButtonDown(): boolean {
  return (GetAsyncKeyState(VK_LBUTTON) & 0x8000) !== 0
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/**
 * 将窗口位置限制在最近显示器的 workArea 内（已排除任务栏）。
 * 全程使用 DIP 坐标，避免 125%/150% 缩放下拖拽漂移（技术方案 1.3）。
 */
function clampToWorkArea(p: Point, size: Size): Point {
  const display = screen.getDisplayNearestPoint(p)
  const wa = display.workArea
  return {
    x: clamp(p.x, wa.x, wa.x + wa.width - size.width),
    y: clamp(p.y, wa.y, wa.y + wa.height - size.height)
  }
}

/**
 * 拖拽控制器：主进程轮询光标 + 左键状态驱动窗口移动。
 * 不用 -webkit-app-region: drag（会被系统吞掉 mousedown/mousemove，5px 阈值失效）。
 * M0 用窗口矩形判定「光标是否在角色上」，M2 替换为 alpha 掩码判定。
 */
export function startDragController(win: BrowserWindow): () => void {
  let dragging = false
  let offset: Point = { x: 0, y: 0 }

  const tick = (): void => {
    const down = isLeftButtonDown()
    const cursor = screen.getCursorScreenPoint()
    const [wx, wy] = win.getPosition()
    const bounds = win.getBounds()

    if (down && !dragging) {
      const inside =
        cursor.x >= wx &&
        cursor.x <= wx + bounds.width &&
        cursor.y >= wy &&
        cursor.y <= wy + bounds.height
      if (inside) {
        dragging = true
        offset = { x: cursor.x - wx, y: cursor.y - wy }
      }
    } else if (down && dragging) {
      const next = clampToWorkArea(
        { x: cursor.x - offset.x, y: cursor.y - offset.y },
        bounds
      )
      win.setPosition(next.x, next.y)
    } else if (!down && dragging) {
      dragging = false
      // 松手后再 clamp 一次，防止停在屏幕外（技术方案 B4）
      const [px, py] = win.getPosition()
      const clamped = clampToWorkArea({ x: px, y: py }, bounds)
      win.setPosition(clamped.x, clamped.y)
    }
  }

  const timer = setInterval(tick, 16) // ~60Hz
  return () => clearInterval(timer)
}

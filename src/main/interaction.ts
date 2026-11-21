import { BrowserWindow, screen } from 'electron'
import koffi from 'koffi'
import { PET_BASE_SIZE } from '../shared/types'
import type { PetInputEvent, Point, Size } from '../shared/types'
import type { HitMaskStore } from './hitMask'

const VK_LBUTTON = 0x01
const VK_RBUTTON = 0x02
/** 5px 阈值区分短按点击与长按拖拽（技术方案 B4） */
const DRAG_THRESHOLD = 5
/** 右键沿左上-右下对角线移动超过该距离才进入缩放，避免误触 */
const SCALE_THRESHOLD = 6

/** 缩放控制：主进程负责改窗口大小，并把结果同步给渲染层 */
export interface ScaleController {
  get: () => number
  begin: () => void
  set: (scale: number) => void
  commit: () => void
}

// 通过 user32.GetAsyncKeyState 检测鼠标按键（轮询方案，不装钩子）
const user32 = koffi.load('user32.dll')
const GetAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)')

function isLeftButtonDown(): boolean {
  return (GetAsyncKeyState(VK_LBUTTON) & 0x8000) !== 0
}

function isRightButtonDown(): boolean {
  return (GetAsyncKeyState(VK_RBUTTON) & 0x8000) !== 0
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
 * 交互控制器：统一负责鼠标穿透切换、点击判定与拖拽。
 *
 * 为什么全放在主进程：
 * - 窗口以 `setIgnoreMouseEvents(true, { forward: true })` 常驻穿透，
 *   透明区域不遮挡下层程序；
 * - 用 60Hz 轮询光标 + alpha 掩码判断命中，命中瞬间才把窗口切回可交互，
 *   避免渲染层事件与主进程拖拽两套逻辑互相打架；
 * - 这样「点空白穿透」与「点角色响应」共用同一个判定源，不会丢点击。
 */
export function startInteraction(
  win: BrowserWindow,
  maskStore: HitMaskStore,
  onInput: (e: PetInputEvent) => void,
  onContextMenu: (local: Point) => void,
  scale: ScaleController
): () => void {
  let pressed = false
  let dragStarted = false
  let pressPoint: Point = { x: 0, y: 0 }
  let grabOffset: Point = { x: 0, y: 0 }
  let prevDown = false
  let prevRightDown = false
  let ignoring = true

  // 右键缩放状态
  let rightPressed = false
  let scaling = false
  let rightPressPoint: Point = { x: 0, y: 0 }
  let scaleStart = 1

  // 启动即穿透，等渲染层上报掩码后再按命中情况切换
  win.setIgnoreMouseEvents(true, { forward: true })

  const tick = (): void => {
    const down = isLeftButtonDown()
    const cursor = screen.getCursorScreenPoint()
    const [wx, wy] = win.getPosition()
    const bounds = win.getBounds()
    const local = { x: cursor.x - wx, y: cursor.y - wy }
    const hit = maskStore.hit(local.x, local.y)

    // 拖拽/缩放期间必须保持可交互，否则窗口中途变穿透会丢 mouseup
    const shouldIgnore = dragStarted || scaling ? false : !hit
    if (shouldIgnore !== ignoring) {
      ignoring = shouldIgnore
      win.setIgnoreMouseEvents(ignoring, { forward: true })
    }

    const pressEdge = down && !prevDown
    const releaseEdge = !down && prevDown

    const rightDown = isRightButtonDown()

    // 右键：按下时先记录起点，拖动沿对角线缩放，松开时若没缩放才弹菜单
    if (rightDown && !prevRightDown && hit) {
      rightPressed = true
      scaling = false
      rightPressPoint = cursor
      scaleStart = scale.get()
    }

    if (rightDown && rightPressed) {
      const dx = cursor.x - rightPressPoint.x
      const dy = cursor.y - rightPressPoint.y
      // 只取沿 (1,1) 对角线的投影：左上为负（缩小），右下为正（放大）
      const diagonal = (dx + dy) / 2

      if (!scaling && Math.abs(diagonal) >= SCALE_THRESHOLD) {
        scaling = true
        scale.begin()
      }
      if (scaling) {
        scale.set(scaleStart + diagonal / PET_BASE_SIZE)
      }
    }

    if (!rightDown && prevRightDown && rightPressed) {
      if (scaling) {
        scale.commit()
      } else {
        onContextMenu(local)
      }
      rightPressed = false
      scaling = false
    }
    prevRightDown = rightDown

    if (pressEdge && hit) {
      pressed = true
      dragStarted = false
      pressPoint = cursor
      grabOffset = { x: cursor.x - wx, y: cursor.y - wy }
    }

    if (down && pressed) {
      if (!dragStarted) {
        const dx = cursor.x - pressPoint.x
        const dy = cursor.y - pressPoint.y
        if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
          dragStarted = true
          onInput({ t: 'DRAG_START', pt: cursor })
        }
      }

      if (dragStarted) {
        const next = clampToWorkArea(
          { x: cursor.x - grabOffset.x, y: cursor.y - grabOffset.y },
          bounds
        )
        win.setPosition(next.x, next.y)
      }
    }

    if (releaseEdge && pressed) {
      if (dragStarted) {
        onInput({ t: 'DRAG_END', pt: cursor })
        // 松手后再 clamp 一次，防止停在屏幕外（技术方案 B4）
        const [px, py] = win.getPosition()
        const clamped = clampToWorkArea({ x: px, y: py }, bounds)
        win.setPosition(clamped.x, clamped.y)
      } else {
        onInput({ t: 'CLICK' })
      }
      pressed = false
      dragStarted = false
    }

    prevDown = down
  }

  const timer = setInterval(tick, 16) // ~60Hz
  return () => clearInterval(timer)
}

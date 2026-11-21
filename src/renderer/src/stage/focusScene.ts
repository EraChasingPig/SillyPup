import type { CursorPayload, Point } from '../../../shared/types'

/**
 * Focus 模式的程序化场景：小笨狗坐在书桌前敲键盘，右手在鼠标垫上跟随光标。
 * 真实素材接入后（M6）这里会被「拆件分层 + 变换驱动」的图层合成替换，
 * 但鼠标垫映射与平滑算法保持不变。
 */

/** 鼠标垫在 300×300 画布中的位置 */
export const MOUSEPAD = { x: 178, y: 226, w: 80, h: 34 }
/** 手/鼠标相对垫子的内缩量，保证边缘限位（手不越出垫子） */
const HAND_HALF = { w: 12, h: 9 }

const CANVAS_W = 300
const FOOT_Y = 272

function clamp01(v: number): number {
  return Math.min(Math.max(v, 0), 1)
}

/** 屏幕坐标 → 鼠标垫坐标（技术方案 3.5 ①），全程 DIP */
export function mapToPad(cursor: CursorPayload): Point {
  const nx = clamp01((cursor.x - cursor.workArea.x) / Math.max(1, cursor.workArea.w))
  const ny = clamp01((cursor.y - cursor.workArea.y) / Math.max(1, cursor.workArea.h))

  const innerX = MOUSEPAD.x + HAND_HALF.w
  const innerY = MOUSEPAD.y + HAND_HALF.h
  const innerW = Math.max(1, MOUSEPAD.w - HAND_HALF.w * 2)
  const innerH = Math.max(1, MOUSEPAD.h - HAND_HALF.h * 2)

  return { x: innerX + nx * innerW, y: innerY + ny * innerH }
}

export function padCenter(): Point {
  return { x: MOUSEPAD.x + MOUSEPAD.w / 2, y: MOUSEPAD.y + MOUSEPAD.h / 2 }
}

/**
 * 帧率无关的指数平滑：1 - exp(-dt/τ)。
 * 固定 alpha 在 165Hz 下会比 60Hz 快 2.7 倍，必须用时间常数。
 */
export function smoothHand(cur: Point, target: Point, dtMs: number): Point {
  const k = 1 - Math.exp(-dtMs / 90)
  return { x: cur.x + (target.x - cur.x) * k, y: cur.y + (target.y - cur.y) * k }
}

export interface FocusSceneOptions {
  /** 当前时间（performance.now） */
  time: number
  /** 平滑后的手部位置（画布坐标） */
  hand: Point
  /** 最近一次按键的时间戳，用于敲键盘动作 */
  typingUntil: number
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawBody(ctx: CanvasRenderingContext2D, bob: number): void {
  const cx = 150
  const bodyCY = 184 + bob * 0.4

  // 身体（坐姿，略扁）
  const body = ctx.createLinearGradient(0, bodyCY - 50, 0, bodyCY + 50)
  body.addColorStop(0, '#ffc078')
  body.addColorStop(1, '#ff9f43')
  ctx.beginPath()
  ctx.ellipse(cx, bodyCY, 47, 45, 0, 0, Math.PI * 2)
  ctx.fillStyle = body
  ctx.fill()
  ctx.strokeStyle = 'rgba(120, 70, 20, 0.35)'
  ctx.lineWidth = 2
  ctx.stroke()

  const headCY = 128 + bob * 0.6

  // 耳朵
  for (const sign of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(cx + sign * 32, headCY - 28)
    ctx.lineTo(cx + sign * 14, headCY - 33)
    ctx.lineTo(cx + sign * 24, headCY - 72)
    ctx.closePath()
    ctx.fillStyle = '#f6b26b'
    ctx.fill()
  }

  // 头
  const head = ctx.createLinearGradient(0, headCY - 40, 0, headCY + 40)
  head.addColorStop(0, '#ffcf96')
  head.addColorStop(1, '#ffb15e')
  ctx.beginPath()
  ctx.ellipse(cx, headCY, 40, 38, 0, 0, Math.PI * 2)
  ctx.fillStyle = head
  ctx.fill()
  ctx.strokeStyle = 'rgba(120, 70, 20, 0.35)'
  ctx.stroke()

  // 腮红
  ctx.fillStyle = 'rgba(255, 130, 130, 0.5)'
  ctx.beginPath()
  ctx.ellipse(cx - 26, headCY + 14, 9, 5.5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(cx + 26, headCY + 14, 9, 5.5, 0, 0, Math.PI * 2)
  ctx.fill()

  // 眼睛：视线略向下，盯着键盘
  ctx.fillStyle = '#4a3320'
  ctx.beginPath()
  ctx.arc(cx - 15, headCY + 2, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx + 15, headCY + 2, 5, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(cx - 13.5, headCY + 0.5, 1.7, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx + 16.5, headCY + 0.5, 1.7, 0, Math.PI * 2)
  ctx.fill()

  // 嘴（专注的抿嘴）
  ctx.strokeStyle = '#4a3320'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, headCY + 16, 6, 0.2 * Math.PI, 0.8 * Math.PI)
  ctx.stroke()
}

function drawDesk(ctx: CanvasRenderingContext2D): void {
  // 桌面
  const top = ctx.createLinearGradient(0, 212, 0, 246)
  top.addColorStop(0, '#e0b07a')
  top.addColorStop(1, '#c98f52')
  roundRectPath(ctx, 34, 212, 232, 34, 8)
  ctx.fillStyle = top
  ctx.fill()
  ctx.strokeStyle = 'rgba(110, 72, 36, 0.55)'
  ctx.lineWidth = 2
  ctx.stroke()

  // 前侧板
  roundRectPath(ctx, 44, 244, 212, 26, 6)
  ctx.fillStyle = '#a86a33'
  ctx.fill()
  ctx.strokeStyle = 'rgba(90, 55, 25, 0.5)'
  ctx.stroke()
}

function drawKeyboard(ctx: CanvasRenderingContext2D, bob: number): void {
  const x = 74
  const y = 221 + bob
  const w = 88
  const h = 22

  roundRectPath(ctx, x, y, w, h, 5)
  ctx.fillStyle = '#f4f4f4'
  ctx.fill()
  ctx.strokeStyle = '#b9b9b9'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // 键帽
  ctx.fillStyle = '#c9c9c9'
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 9; c++) {
      roundRectPath(ctx, x + 6 + c * 8.6, y + 4 + r * 5.6, 6, 3.8, 1)
      ctx.fill()
    }
  }
}

function drawMousepad(ctx: CanvasRenderingContext2D): void {
  roundRectPath(ctx, MOUSEPAD.x, MOUSEPAD.y, MOUSEPAD.w, MOUSEPAD.h, 7)
  ctx.fillStyle = '#ffd9e6'
  ctx.fill()
  ctx.strokeStyle = '#ff9fc0'
  ctx.lineWidth = 1.5
  ctx.setLineDash([4, 3])
  ctx.stroke()
  ctx.setLineDash([])
}

function drawArms(ctx: CanvasRenderingContext2D, hand: Point, bob: number): void {
  ctx.save()
  ctx.strokeStyle = '#ffb166'
  ctx.lineWidth = 13
  ctx.lineCap = 'round'

  // 左臂：搭在键盘左侧
  ctx.beginPath()
  ctx.moveTo(116, 196)
  ctx.quadraticCurveTo(108, 212 + bob, 112, 230 + bob)
  ctx.stroke()

  // 右臂：伸向鼠标
  ctx.beginPath()
  ctx.moveTo(184, 196)
  ctx.quadraticCurveTo(hand.x + 12, hand.y - 12, hand.x + 2, hand.y)
  ctx.stroke()

  ctx.restore()
}

function drawHand(ctx: CanvasRenderingContext2D, hand: Point): void {
  // 鼠标（被手压住，露出一点）
  ctx.beginPath()
  ctx.ellipse(hand.x + 1, hand.y + 4, 7.5, 9.5, -0.12, 0, Math.PI * 2)
  ctx.fillStyle = '#ececec'
  ctx.fill()
  ctx.strokeStyle = '#a9a9a9'
  ctx.lineWidth = 1.2
  ctx.stroke()

  // 爪垫
  const paw = ctx.createRadialGradient(hand.x - 3, hand.y - 4, 2, hand.x, hand.y, 13)
  paw.addColorStop(0, '#ffd7a6')
  paw.addColorStop(1, '#ff9f43')
  ctx.beginPath()
  ctx.arc(hand.x, hand.y, 11.5, 0, Math.PI * 2)
  ctx.fillStyle = paw
  ctx.fill()
  ctx.strokeStyle = 'rgba(120, 70, 20, 0.45)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // 指缝
  ctx.strokeStyle = 'rgba(150, 90, 30, 0.4)'
  ctx.lineWidth = 1
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath()
    ctx.moveTo(hand.x + i * 4, hand.y - 8)
    ctx.lineTo(hand.x + i * 4, hand.y - 3)
    ctx.stroke()
  }
}

/** 绘制完整的 Focus 场景（画布已在外部清空） */
export function drawFocusScene(ctx: CanvasRenderingContext2D, opts: FocusSceneOptions): void {
  const typing = opts.time < opts.typingUntil
  const bob = typing ? Math.abs(Math.sin(opts.time * 0.03)) * 2.5 : 0

  // 地面阴影
  ctx.save()
  ctx.globalAlpha = 0.16
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.ellipse(CANVAS_W / 2, FOOT_Y, 108, 12, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  drawBody(ctx, bob)
  drawDesk(ctx)
  drawKeyboard(ctx, bob)
  drawMousepad(ctx)
  drawArms(ctx, opts.hand, bob)
  drawHand(ctx, opts.hand)
}

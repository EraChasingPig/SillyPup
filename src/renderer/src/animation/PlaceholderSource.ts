import type { AnimationClip, AnimationSource, FrameRef } from './types'
import clipsConfig from './clips.json'

const W = 300
const H = 300
/** 脚底中心锚点，与技术方案「画布锚点统一」约定一致 */
const ANCHOR_X = 150
const ANCHOR_Y = 270

interface ClipConfig {
  fps: number
  loop: 'once' | 'loop'
  frameCount: number
  interruptible: boolean
  anchor: { x: number; y: number }
}

const configs = clipsConfig as unknown as Record<string, ClipConfig>

interface Transform {
  sx: number
  sy: number
  dx: number
  dy: number
  rot: number
}

/** 程序化占位动作：真实素材接入后本函数连同整个 Source 一起被替换 */
function transformFor(clipId: string, p: number): Transform {
  const base: Transform = { sx: 1, sy: 1, dx: 0, dy: 0, rot: 0 }
  const tau = Math.PI * 2

  switch (clipId) {
    case 'idle_breath': {
      const s = Math.sin(p * tau)
      return { ...base, sx: 1 - s * 0.02, sy: 1 + s * 0.03 }
    }
    case 'action_float': {
      const s = Math.sin(p * tau)
      return { ...base, dy: -s * 8, sy: 1 + s * 0.015 }
    }
    case 'interact_hop': {
      const hop = Math.sin(p * Math.PI)
      return { ...base, dy: -hop * 40, sx: 1 + hop * 0.06, sy: 1 + hop * 0.06 }
    }
    case 'grab_startle': {
      const s = Math.sin(p * tau * 1.5)
      return { ...base, rot: s * 0.12, dy: -10 }
    }
    case 'drag_kick': {
      const s = Math.sin(p * tau)
      return { ...base, rot: s * 0.08, dy: -18 + s * 4 }
    }
    case 'dropped_fall':
      return { ...base, dy: -60 * (1 - p) }
    case 'land_bounce': {
      const squash = Math.sin(p * Math.PI) * Math.exp(-p * 2.2)
      return { ...base, sx: 1 + squash * 0.18, sy: 1 - squash * 0.22 }
    }
    default:
      return base
  }
}

function drawPup(ctx: OffscreenCanvasRenderingContext2D, t: Transform): void {
  ctx.clearRect(0, 0, W, H)

  // 地面阴影不参与形变，单独画
  ctx.save()
  ctx.globalAlpha = 0.16
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.ellipse(ANCHOR_X, ANCHOR_Y + 4, 46 * t.sx, 9, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.save()
  // 变换以脚底中心为原点
  ctx.translate(ANCHOR_X + t.dx, ANCHOR_Y + t.dy)
  ctx.rotate(t.rot)
  ctx.scale(t.sx, t.sy)

  const bodyR = 58
  const cy = -bodyR - 2

  // 耳朵
  for (const sign of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(sign * 34, cy - 44)
    ctx.lineTo(sign * 16, cy - 46)
    ctx.lineTo(sign * 26, cy - 86)
    ctx.closePath()
    ctx.fillStyle = '#f6b26b'
    ctx.fill()
  }

  // 身体
  const body = ctx.createLinearGradient(0, cy - bodyR, 0, cy + bodyR)
  body.addColorStop(0, '#ffc078')
  body.addColorStop(1, '#ff9f43')
  ctx.beginPath()
  ctx.ellipse(0, cy, bodyR, bodyR * 1.02, 0, 0, Math.PI * 2)
  ctx.fillStyle = body
  ctx.fill()
  ctx.strokeStyle = 'rgba(120, 70, 20, 0.35)'
  ctx.lineWidth = 2
  ctx.stroke()

  // 腮红
  ctx.fillStyle = 'rgba(255, 130, 130, 0.55)'
  ctx.beginPath()
  ctx.ellipse(-34, cy + 16, 10, 6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(34, cy + 16, 10, 6, 0, 0, Math.PI * 2)
  ctx.fill()

  // 眼睛
  ctx.fillStyle = '#4a3320'
  ctx.beginPath()
  ctx.arc(-20, cy - 4, 5.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(20, cy - 4, 5.5, 0, Math.PI * 2)
  ctx.fill()

  // 眼睛高光
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(-18.2, cy - 6, 1.8, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(21.8, cy - 6, 1.8, 0, Math.PI * 2)
  ctx.fill()

  // 嘴
  ctx.strokeStyle = '#4a3320'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(0, cy + 12, 7, 0.15 * Math.PI, 0.85 * Math.PI)
  ctx.stroke()

  ctx.restore()
}

const clipCache = new Map<string, AnimationClip>()
const frameCache = new Map<string, ImageBitmap[]>()

/** 程序化占位帧源：不依赖任何图片文件，用于在 M1 阶段验证状态机与播放器 */
class PlaceholderSource implements AnimationSource {
  readonly kind = 'procedural' as const

  async load(clipId: string): Promise<AnimationClip> {
    const cached = clipCache.get(clipId)
    if (cached) return cached

    const cfg = configs[clipId]
    if (!cfg) throw new Error(`未定义的动画 clip: ${clipId}`)

    const frameCount = cfg.frameCount
    const bitmaps: ImageBitmap[] = []
    const frames: FrameRef[] = []

    for (let i = 0; i < frameCount; i++) {
      // 循环动画取 [0,1)，一次性动画取 [0,1]，保证首尾帧落在端点
      const p = cfg.loop === 'loop'
        ? i / frameCount
        : frameCount <= 1
          ? 0
          : i / (frameCount - 1)

      const canvas = new OffscreenCanvas(W, H)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('OffscreenCanvas 2D 上下文创建失败')

      drawPup(ctx, transformFor(clipId, p))
      bitmaps.push(await createImageBitmap(canvas))
      frames.push({ tex: `${clipId}#${i}`, x: 0, y: 0, w: W, h: H })
    }

    const clip: AnimationClip = {
      id: clipId,
      fps: cfg.fps,
      loop: cfg.loop,
      frames,
      anchor: cfg.anchor,
      interruptible: cfg.interruptible
    }

    clipCache.set(clipId, clip)
    frameCache.set(clipId, bitmaps)
    return clip
  }

  getFrame(clipId: string, frameIndex: number): CanvasImageSource | null {
    return frameCache.get(clipId)?.[frameIndex] ?? null
  }

  dispose(): void {
    for (const list of frameCache.values()) {
      for (const bmp of list) bmp.close()
    }
    frameCache.clear()
    clipCache.clear()
  }
}

export const placeholderSource = new PlaceholderSource()

export const CANVAS_SIZE = { width: W, height: H }

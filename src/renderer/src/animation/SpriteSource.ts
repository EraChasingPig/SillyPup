import clipsConfig from './clips.json'
import idleUrl from '../assets/base/idle_base.png'
import type { AnimationClip, AnimationSource, FrameRef } from './types'

/** 画布尺寸与锚点，和技术方案「画布锚点统一」的约定一致 */
export const CANVAS_SIZE = { width: 300, height: 300 }

const W = CANVAS_SIZE.width
const H = CANVAS_SIZE.height
const ANCHOR_X = 150
const ANCHOR_Y = 270

/** 立绘为 600×600 @2x，脚底锚点在 (300, 540) */
const ART_SIZE = 600
const ART_ANCHOR_X = ART_SIZE / 2
const ART_ANCHOR_Y = 540
const ART_SCALE = W / ART_SIZE

interface ClipConfig {
  fps: number
  loop: 'once' | 'loop'
  frameCount: number
  interruptible: boolean
  anchor: { x: number; y: number }
}

const configs = clipsConfig as unknown as Record<string, ClipConfig>

/**
 * 已经生成好的逐帧素材（如 AI 视频抽帧）优先使用；
 * 没有对应目录的 clip 回落到「单张立绘 + 程序化形变」。
 */
const frameModules = import.meta.glob('../assets/frames/**/*.png', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

const framesByClip = new Map<string, string[]>()
for (const [path, url] of Object.entries(frameModules)) {
  const dir = path.split('/frames/')[1]?.split('/')[0]
  if (!dir) continue
  const list = framesByClip.get(dir)
  if (list) list.push(url)
  else framesByClip.set(dir, [url])
}
// 文件名补零后按字典序即帧序
for (const list of framesByClip.values()) list.sort()

interface Transform {
  sx: number
  sy: number
  dx: number
  dy: number
  rot: number
}

/**
 * 程序化动作曲线：只对同一张立绘做以脚底为原点的形变。
 * 因此 clips.json 里的 12 帧并不需要 12 张不同的画。
 */
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
    default:
      return base
  }
}

function drawSprite(
  ctx: OffscreenCanvasRenderingContext2D,
  art: HTMLImageElement,
  t: Transform
): void {
  ctx.clearRect(0, 0, W, H)

  ctx.save()
  // 变换以脚底中心为原点，缩放时不会陷进地面
  ctx.translate(ANCHOR_X + t.dx, ANCHOR_Y + t.dy)
  ctx.rotate(t.rot)
  ctx.scale(t.sx, t.sy)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    art,
    -ART_ANCHOR_X * ART_SCALE,
    -ART_ANCHOR_Y * ART_SCALE,
    ART_SIZE * ART_SCALE,
    ART_SIZE * ART_SCALE
  )
  ctx.restore()
}

const imageCache = new Map<string, Promise<HTMLImageElement>>()

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src)
  if (cached) return cached

  const task = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`图片加载失败：${src}`))
    img.src = src
  })
  imageCache.set(src, task)
  return task
}

function loadArt(): Promise<HTMLImageElement> {
  return loadImage(idleUrl)
}

/** 素材帧源：有逐帧素材时直接用，没有时用单张立绘做程序化形变 */
class SpriteSource implements AnimationSource {
  readonly kind = 'spritesheet' as const

  private readonly clips = new Map<string, AnimationClip>()
  private readonly frames = new Map<string, ImageBitmap[]>()
  private readonly pending = new Map<string, Promise<AnimationClip>>()

  load(clipId: string): Promise<AnimationClip> {
    const cached = this.clips.get(clipId)
    if (cached) return Promise.resolve(cached)

    const running = this.pending.get(clipId)
    if (running) return running

    const task = this.build(clipId).finally(() => this.pending.delete(clipId))
    this.pending.set(clipId, task)
    return task
  }

  private async build(clipId: string): Promise<AnimationClip> {
    const cfg = configs[clipId]
    if (!cfg) throw new Error(`未定义的动画 clip: ${clipId}`)

    const bitmaps: ImageBitmap[] = []
    const frames: FrameRef[] = []
    const urls = framesByClip.get(clipId)

    if (urls && urls.length > 0) {
      // 逐帧素材：帧内已经包含动作和原视频的地面阴影，不再叠加程序化形变/投影
      // 并行预加载，避免上百帧的片段逐张等待导致拖拽/点击响应变慢
      const imgs = await Promise.all(urls.map((url) => loadImage(url)))
      for (const img of imgs) {
        const canvas = new OffscreenCanvas(W, H)
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('OffscreenCanvas 2D 上下文创建失败')

        ctx.drawImage(img, 0, 0, W, H)
        bitmaps.push(await createImageBitmap(canvas))
        frames.push({ tex: `${clipId}#${frames.length}`, x: 0, y: 0, w: W, h: H })
      }
    } else {
      // 回落：同一张立绘按动作曲线预渲染
      const art = await loadArt()
      const frameCount = cfg.frameCount

      for (let i = 0; i < frameCount; i++) {
        // 循环动画取 [0,1)，一次性动画取 [0,1]，保证首尾帧落在端点
        const p =
          cfg.loop === 'loop'
            ? i / frameCount
            : frameCount <= 1
              ? 0
              : i / (frameCount - 1)

        const canvas = new OffscreenCanvas(W, H)
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('OffscreenCanvas 2D 上下文创建失败')

        drawSprite(ctx, art, transformFor(clipId, p))
        bitmaps.push(await createImageBitmap(canvas))
        frames.push({ tex: `${clipId}#${i}`, x: 0, y: 0, w: W, h: H })
      }
    }

    const clip: AnimationClip = {
      id: clipId,
      fps: cfg.fps,
      loop: cfg.loop,
      frames,
      anchor: cfg.anchor,
      interruptible: cfg.interruptible
    }

    this.clips.set(clipId, clip)
    this.frames.set(clipId, bitmaps)
    return clip
  }

  getFrame(clipId: string, frameIndex: number): CanvasImageSource | null {
    return this.frames.get(clipId)?.[frameIndex] ?? null
  }

  dispose(): void {
    for (const list of this.frames.values()) {
      for (const bmp of list) bmp.close()
    }
    this.frames.clear()
    this.clips.clear()
  }
}

export const spriteSource = new SpriteSource()

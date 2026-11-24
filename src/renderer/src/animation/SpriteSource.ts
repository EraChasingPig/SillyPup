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

/** 帧缓存预算：约 32 MB，超出后按最近使用时间回收旧片段（正在播放的片段不受限） */
const FRAME_BUDGET_BYTES = 32 * 1024 * 1024
/** 同时解码的帧数上限，避免一次并发上百个文件把内存顶上去 */
const MAX_CONCURRENT_LOADS = 6
/** 刚解码的片段在这段时间内优先保留，避免预加载完立刻被别的片段挤掉 */
const FRESH_MS = 4000

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

/**
 * 帧素材统一走 fetch + blob 解码：解码结果只保留一份 ImageBitmap，
 * 不会像 <img> 那样把解码数据留在 Chromium 的图片缓存里。
 * 打包后页面是 file://，主进程已打开 allow-file-access-from-files；
 * 极端情况下 fetch 不可用时回落到 <img> 解码，并在转换后立刻清空 src。
 */
function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`图片加载失败：${src}`))
    img.src = src
  })
}

/** 并发闸门：逐帧把加载量控制在 MAX_CONCURRENT_LOADS 以内 */
let activeLoads = 0
const loadWaiters: Array<() => void> = []

async function withLoadSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeLoads >= MAX_CONCURRENT_LOADS) {
    await new Promise<void>((resolve) => loadWaiters.push(resolve))
  }
  activeLoads += 1
  try {
    return await task()
  } finally {
    activeLoads -= 1
    loadWaiters.shift()?.()
  }
}

/**
 * 解码一帧为 ImageBitmap：只保留这一份解码结果，
 * 不再像 <img> 那样把解码数据留在 Chromium 的图片缓存里。
 */
function loadFrameImage(url: string, fw: number, fh: number): Promise<ImageBitmap> {
  const resize =
    fw === W && fh === H
      ? undefined
      : { resizeWidth: fw, resizeHeight: fh, resizeQuality: 'high' as const }

  return withLoadSlot(async () => {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`图片加载失败：${url} (${res.status})`)
      return await createImageBitmap(await res.blob(), resize)
    } catch {
      const img = await loadImageElement(url)
      try {
        return await createImageBitmap(img, resize)
      } finally {
        img.src = ''
      }
    }
  })
}

/** 程序化回落的立绘只有一张，单独缓存，不参与逐帧缓存 */
let artPromise: Promise<HTMLImageElement> | null = null

function loadArt(): Promise<HTMLImageElement> {
  if (!artPromise) {
    artPromise = loadImageElement(idleUrl).catch((err: unknown) => {
      artPromise = null
      throw err
    })
  }
  return artPromise
}

interface CacheEntry {
  clip: AnimationClip
  bitmaps: ImageBitmap[]
  bytes: number
  /** 最近一次被读取的时间，用于 LRU 淘汰 */
  lastUsed: number
  /** 解码完成的时间，用于给刚加载的片段一个保护窗口 */
  loadedAt: number
}

/** 素材帧源：有逐帧素材时直接用，没有时用单张立绘做程序化形变 */
class SpriteSource implements AnimationSource {
  readonly kind = 'spritesheet' as const

  private readonly entries = new Map<string, CacheEntry>()
  private readonly pending = new Map<string, Promise<AnimationClip>>()
  /** 当前正在播放的片段，任何情况下都不回收 */
  private pinnedClip: string | null = null
  /** 常驻片段（拖拽三段）：体积大又是高频交互，预热后不参与淘汰 */
  private readonly retained = new Set<string>()
  private bytes = 0
  /** 解码尺寸跟随窗口缩放：显示尺寸越小，单帧显存占用越小 */
  private renderScale = 1

  /**
   * 设置解码尺寸比例（0~1]。
   * 已解码的片段保持原尺寸照常绘制，只有之后加载的片段按新尺寸解码；
   * 缩放后常驻片段的解码尺寸过期，解除常驻交给 LRU，由调用方在缩放结束后重新预热。
   */
  setRenderScale(scale: number): void {
    const next = Math.min(1, Math.max(0.25, scale))
    if (Math.abs(next - this.renderScale) < 0.001) return
    this.renderScale = next
    this.retained.clear()
  }

  load(clipId: string): Promise<AnimationClip> {
    const cached = this.entries.get(clipId)
    if (cached) {
      cached.lastUsed = performance.now()
      return Promise.resolve(cached.clip)
    }

    const running = this.pending.get(clipId)
    if (running) return running

    const task = this.build(clipId)
      .then((entry) => {
        this.entries.set(entry.clip.id, entry)
        this.bytes += entry.bytes
        this.evict(entry.clip.id)
        return entry.clip
      })
      .finally(() => this.pending.delete(clipId))
    this.pending.set(clipId, task)
    return task
  }

  /**
   * 标记当前正在播放的片段，旧片段随之解除保护、可被回收。
   * 片段的解码与释放都由本类负责，播放器每次切换动画时通知一次即可。
   */
  pin(clipId: string): void {
    this.pinnedClip = clipId
    const entry = this.entries.get(clipId)
    if (entry) entry.lastUsed = performance.now()
    this.evict(clipId)
  }

  /**
   * 预热并常驻指定片段。拖拽三段合计远超普通片段，若不常驻会被 LRU 反复挤掉，
   * 每次拖拽都要重新解码，表现为动作整体延迟。
   */
  async retain(clipIds: readonly string[]): Promise<void> {
    for (const id of clipIds) this.retained.add(id)
    await Promise.allSettled(clipIds.map((id) => this.load(id)))
  }

  private async build(clipId: string): Promise<CacheEntry> {
    const cfg = configs[clipId]
    if (!cfg) throw new Error(`未定义的动画 clip: ${clipId}`)

    // 按当前窗口缩放解码，避免把 300×300 的原图整帧塞进显存后再缩小绘制
    const fw = Math.max(1, Math.round(W * this.renderScale))
    const fh = Math.max(1, Math.round(H * this.renderScale))
    const resize =
      fw === W && fh === H
        ? undefined
        : { resizeWidth: fw, resizeHeight: fh, resizeQuality: 'high' as const }

    const urls = framesByClip.get(clipId)
    const bitmaps: ImageBitmap[] = []

    if (urls && urls.length > 0) {
      // 逐帧素材：帧内已经包含动作和原视频的地面阴影，不再叠加程序化形变/投影。
      // 按需解码成 ImageBitmap，解码完成后 PNG 与 HTMLImageElement 都不再保留。
      bitmaps.push(...(await Promise.all(urls.map((url) => loadFrameImage(url, fw, fh)))))
    } else {
      // 回落：同一张立绘按动作曲线预渲染（目前只有 drag_kick 走这条路径）
      const art = await loadArt()
      const canvas = new OffscreenCanvas(W, H)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('OffscreenCanvas 2D 上下文创建失败')

      const frameCount = cfg.frameCount
      for (let i = 0; i < frameCount; i++) {
        // 循环动画取 [0,1)，一次性动画取 [0,1]，保证首尾帧落在端点
        const p =
          cfg.loop === 'loop'
            ? i / frameCount
            : frameCount <= 1
              ? 0
              : i / (frameCount - 1)

        drawSprite(ctx, art, transformFor(clipId, p))
        bitmaps.push(await createImageBitmap(canvas, resize))
      }
    }

    const frames: FrameRef[] = bitmaps.map((_, i) => ({
      tex: `${clipId}#${i}`,
      x: 0,
      y: 0,
      w: fw,
      h: fh
    }))

    const now = performance.now()
    return {
      clip: {
        id: clipId,
        fps: cfg.fps,
        loop: cfg.loop,
        frames,
        anchor: cfg.anchor,
        interruptible: cfg.interruptible
      },
      bitmaps,
      bytes: bitmaps.length * fw * fh * 4,
      lastUsed: now,
      loadedAt: now
    }
  }

  getFrame(clipId: string, frameIndex: number): CanvasImageSource | null {
    const entry = this.entries.get(clipId)
    if (!entry) return null
    entry.lastUsed = performance.now()
    return entry.bitmaps[frameIndex] ?? null
  }

  dispose(): void {
    this.pinnedClip = null
    this.retained.clear()
    this.bytes = 0
    for (const entry of this.entries.values()) {
      for (const bmp of entry.bitmaps) bmp.close()
    }
    this.entries.clear()
  }

  /** 调试用：当前帧缓存占用，验证回收是否生效 */
  stats(): { clips: number; frames: number; bytes: number; pinned: string | null } {
    let frames = 0
    for (const entry of this.entries.values()) frames += entry.bitmaps.length
    return { clips: this.entries.size, frames, bytes: this.bytes, pinned: this.pinnedClip }
  }

  /** 超出预算时按最近使用时间回收；钉住的片段、常驻片段与本次刚加载的片段不参与 */
  private evict(keepId: string | null): void {
    if (this.budgetUsed() <= FRAME_BUDGET_BYTES) return

    const now = performance.now()
    const pinned = this.pinnedClip
    const candidates = [...this.entries.values()]
      .filter(
        (e) => e.clip.id !== pinned && e.clip.id !== keepId && !this.retained.has(e.clip.id)
      )
      .sort((a, b) => a.lastUsed - b.lastUsed)

    // 先淘汰明显过期的片段；仍然超预算时再动刚解码的，避免缓存无上限
    for (const onlyStale of [true, false]) {
      for (const entry of candidates) {
        if (this.budgetUsed() <= FRAME_BUDGET_BYTES) return
        if (onlyStale && now - entry.loadedAt < FRESH_MS) continue
        this.drop(entry.clip.id)
      }
    }
  }

  /** 计入预算的字节数：常驻片段单独算，不挤占按需片段的空间 */
  private budgetUsed(): number {
    let retainedBytes = 0
    for (const id of this.retained) {
      const entry = this.entries.get(id)
      if (entry) retainedBytes += entry.bytes
    }
    return this.bytes - retainedBytes
  }

  private drop(clipId: string): void {
    const entry = this.entries.get(clipId)
    if (!entry) return
    for (const bmp of entry.bitmaps) bmp.close()
    this.entries.delete(clipId)
    this.bytes -= entry.bytes
  }
}

export const spriteSource = new SpriteSource()

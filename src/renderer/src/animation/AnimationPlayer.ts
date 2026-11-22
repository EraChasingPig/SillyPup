import type { AnimationClip, AnimationSource } from './types'

/**
 * 帧播放器：按 clip 的 fps 推进帧，不依赖 requestAnimationFrame 的固定步长，
 * 因此高刷屏（144/165Hz）与 60Hz 的播放速度一致。
 */
export class AnimationPlayer {
  private clip: AnimationClip | null = null
  private elapsed = 0
  private finished = false
  /** 防止连续 play 时异步加载错序覆盖当前动画 */
  private requestId = 0

  constructor(
    private readonly source: AnimationSource,
    private readonly onEnd?: (clipId: string) => void
  ) {}

  async play(clipId: string): Promise<void> {
    const rid = ++this.requestId
    const clip = await this.source.load(clipId)
    if (rid !== this.requestId) return

    this.clip = clip
    this.elapsed = 0
    this.finished = false
  }

  update(dtMs: number): void {
    if (!this.clip || this.finished) return

    this.elapsed += dtMs
    const duration = (this.clip.frames.length / this.clip.fps) * 1000

    if (this.clip.loop === 'once' && this.elapsed >= duration) {
      this.elapsed = duration
      this.finished = true
      this.onEnd?.(this.clip.id)
    }
  }

  get clipId(): string | null {
    return this.clip?.id ?? null
  }

  /** 当前片段已播放时长（循环片段会持续累加，用于判断是否播满一轮） */
  get elapsedMs(): number {
    return this.elapsed
  }

  /** 当前片段单轮时长，无片段时为 0 */
  get durationMs(): number {
    return this.clip ? (this.clip.frames.length / this.clip.fps) * 1000 : 0
  }

  /** 当前应绘制的帧；无动画时返回 null */
  get currentFrame(): CanvasImageSource | null {
    if (!this.clip) return null

    const total = this.clip.frames.length
    const raw = Math.floor((this.elapsed / 1000) * this.clip.fps)
    const index = this.clip.loop === 'loop' ? raw % total : Math.min(raw, total - 1)

    return this.source.getFrame(this.clip.id, index)
  }

  get anchor(): { x: number; y: number } {
    return this.clip?.anchor ?? { x: 150, y: 270 }
  }
}

/**
 * 动画资源的公共契约。
 * 渲染层只依赖本接口，不关心资源是 PNG 序列帧、图集还是程序化生成，
 * 因此后续接入真实素材或 Spine 时只需新增一个 AnimationSource 实现。
 */

export interface FrameRef {
  /** 帧归属的纹理标识（图集文件名 / 程序化帧 id） */
  tex: string
  /** 在图集中的裁剪矩形；程序化帧填满整张画布 */
  x: number
  y: number
  w: number
  h: number
}

export interface AnimationClip {
  id: string
  fps: number
  loop: 'once' | 'loop'
  frames: FrameRef[]
  /** 锚点（脚底中心），保证不同动画切换时角色不跳动 */
  anchor: { x: number; y: number }
  /** 是否允许被点击打断 */
  interruptible: boolean
  /** 帧事件，用于音效或气泡时机 */
  events?: { atFrame: number; name: string }[]
}

export interface AnimationSource {
  readonly kind: 'spritesheet' | 'procedural'
  load(clipId: string): Promise<AnimationClip>
  /** 取某一帧可绘制对象（ImageBitmap / HTMLImageElement 等） */
  getFrame(clipId: string, frameIndex: number): CanvasImageSource | null
  dispose(): void
}

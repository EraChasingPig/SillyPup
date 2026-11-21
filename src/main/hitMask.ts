import type { HitMask } from '../shared/types'

/**
 * 命中掩码仓库。
 * 渲染层每约 120ms 上报一次降采样后的 alpha 掩码，
 * 主进程在 60Hz 的光标轮询中用它判断「光标是否真的压在角色身上」。
 */
export class HitMaskStore {
  private mask: HitMask | null = null

  set(mask: HitMask): void {
    // IPC 传输后 cells 可能退化为普通数组，统一转回 Uint8Array
    this.mask = {
      res: mask.res,
      bbox: mask.bbox,
      cells: mask.cells instanceof Uint8Array ? mask.cells : new Uint8Array(mask.cells)
    }
  }

  get ready(): boolean {
    return this.mask !== null
  }

  /**
   * @param localX 光标相对窗口左上角的 DIP 坐标
   * @param localY 同上
   */
  hit(localX: number, localY: number): boolean {
    const mask = this.mask
    // 掩码尚未就绪时退化为整窗命中，避免启动瞬间角色完全点不到
    if (!mask) return true

    const { bbox, res, cells } = mask
    if (bbox.w <= 0 || bbox.h <= 0) return false
    if (localX < bbox.x || localX >= bbox.x + bbox.w) return false
    if (localY < bbox.y || localY >= bbox.y + bbox.h) return false

    const cx = Math.min(res - 1, Math.floor(((localX - bbox.x) / bbox.w) * res))
    const cy = Math.min(res - 1, Math.floor(((localY - bbox.y) / bbox.h) * res))

    return cells[cy * res + cx] === 1
  }
}

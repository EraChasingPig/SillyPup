import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { PET_BASE_SIZE, PET_SCALE_MAX, PET_SCALE_MIN } from '../shared/types'

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/** 按缩放比例算出窗口边长（DIP），并夹在允许范围内 */
function sizeForScale(scale: number): number {
  return Math.round(PET_BASE_SIZE * clamp(scale, PET_SCALE_MIN, PET_SCALE_MAX))
}

/**
 * 调整桌宠缩放：保持角色脚底（窗口底部中心）位置不动，向右下生长 / 向左上收缩。
 * 缩放过程中传入固定锚点，避免每次取整误差累积导致桌宠整体漂移。
 * 返回实际生效的比例（受像素取整和屏幕边界影响）。
 */
export function applyPetScale(
  win: BrowserWindow,
  scale: number,
  anchor?: { x: number; y: number }
): number {
  const size = sizeForScale(scale)
  const b = win.getBounds()
  if (b.width === size && b.height === size) return size / PET_BASE_SIZE

  const anchorX = anchor ? anchor.x : b.x + b.width / 2
  const anchorY = anchor ? anchor.y : b.y + b.height
  const wa = screen.getDisplayNearestPoint({ x: anchorX, y: anchorY }).workArea
  const x = clamp(Math.round(anchorX - size / 2), wa.x, wa.x + wa.width - size)
  const y = clamp(Math.round(anchorY - size), wa.y, wa.y + wa.height - size)

  win.setBounds({ x, y, width: size, height: size })
  return size / PET_BASE_SIZE
}

/**
 * 创建透明、无边框、始终置顶、不可聚焦的桌宠窗口。
 * 关键参数（对应技术方案 1.3 已知坑）：
 * - hasShadow: false 避免透明窗口出现灰黑阴影边
 * - focusable: false 避免点桌宠抢走当前程序焦点
 * - backgroundThrottling: false 避免窗口失焦后 rAF 降频导致动画卡死
 */
export function createPetWindow(scale = 1): BrowserWindow {
  const size = sizeForScale(scale)
  const win = new BrowserWindow({
    width: size,
    height: size,
    x: 120,
    y: 120,
    transparent: true,
    frame: false,
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    movable: true,
    focusable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  win.once('ready-to-show', () => win.show())

  // 外部链接交给系统浏览器（M0 暂无链接，预留）
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  return win
}

/** 置顶自愈间隔：足够短，用户几乎察觉不到空白；又足够长，避免频繁改动系统 z 序 */
const TOPMOST_HEAL_MS = 1200

/**
 * 置顶自愈。
 *
 * Windows 上某些应用的窗口（实测为系统「照片」）关闭后，会让透明置顶窗口的 DWM 呈现失效：
 * 窗口依然可见、置顶标志也在、位置尺寸不变，但整窗不再绘制，看起来就是桌宠凭空消失；
 * 手动重新点一次「始终置顶」就会恢复。这里用同样的方式定期强制重设一次置顶，
 * 让失效的呈现被重新合成，把「用户手动点两次」变成自动兜底。
 *
 * 用户从托盘取消「始终置顶」后 isAlwaysOnTop() 为 false，此时不干预。
 */
export function startTopmostWatchdog(win: BrowserWindow): () => void {
  const timer = setInterval(() => {
    if (win.isDestroyed() || !win.isAlwaysOnTop()) return
    win.setAlwaysOnTop(false)
    win.setAlwaysOnTop(true, 'screen-saver')
  }, TOPMOST_HEAL_MS)
  return () => clearInterval(timer)
}

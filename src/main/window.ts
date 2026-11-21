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

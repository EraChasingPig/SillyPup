import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { PET_BASE_SIZE, PET_SCALE_MAX, PET_SCALE_MIN } from '../shared/types'

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/** 按缩放比例算出窗口边长（DIP），并夹在允许范围内 */
export function sizeForScale(scale: number): number {
  return Math.round(PET_BASE_SIZE * clamp(scale, PET_SCALE_MIN, PET_SCALE_MAX))
}

/**
 * 移动窗口（保持尺寸不变）。
 *
 * Windows 在非整数显示缩放（125% / 150%）下存在缺陷：对窗口调用 setPosition 时，
 * 系统会按错误的 DPI 换算悄悄把窗口撑大——实测 125% 下每移动一次宽度 +1px，
 * 拖拽、行走、苹果跟随鼠标时表现为角色/苹果被持续拉长变大。
 * 用带显式宽高的 setBounds 移动则尺寸稳定，因此所有高频位移统一走这里。
 */
export function moveWindowTo(
  win: BrowserWindow,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  if (win.isDestroyed()) return
  win.setBounds({ x: Math.round(x), y: Math.round(y), width, height })
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

/**
 * 显示器变化后把窗口拉回最近的显示器工作区。
 * 拔掉副屏、改分辨率或改缩放后调用，避免窗口停在已不存在的屏幕上。
 */
export function keepPetOnScreen(win: BrowserWindow, scale: number): void {
  if (win.isDestroyed()) return
  const b = win.getBounds()
  const size = sizeForScale(scale)
  const wa = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).workArea
  const x = clamp(Math.round(b.x), wa.x, wa.x + wa.width - size)
  const y = clamp(Math.round(b.y), wa.y, wa.y + wa.height - size)
  if (x !== b.x || y !== b.y || b.width !== size || b.height !== size) {
    moveWindowTo(win, x, y, size, size)
  }
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

import { BrowserWindow, shell } from 'electron'
import { join } from 'path'

/**
 * 创建透明、无边框、始终置顶、不可聚焦的桌宠窗口。
 * 关键参数（对应技术方案 1.3 已知坑）：
 * - hasShadow: false 避免透明窗口出现灰黑阴影边
 * - focusable: false 避免点桌宠抢走当前程序焦点
 * - backgroundThrottling: false 避免窗口失焦后 rAF 降频导致动画卡死
 */
export function createPetWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 300,
    height: 300,
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

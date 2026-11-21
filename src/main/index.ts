import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { createPetWindow } from './window'
import { createTray } from './tray'
import { startDragController } from './dragController'

// 单实例：用户双击两次只会聚焦已有实例（技术方案 2.5）
const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  let win: BrowserWindow | null = null
  let tray: Electron.Tray | null = null
  let stopDrag: (() => void) | null = null

  app.on('second-instance', () => {
    if (win && !win.isVisible()) win.show()
  })

  app.whenReady().then(() => {
    win = createPetWindow()
    tray = createTray(win)
    stopDrag = startDragController(win)

    if (process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'))
    }
  })

  // 桌宠常驻：不因窗口关闭而退出，退出统一走托盘
  app.on('window-all-closed', () => {
    /* 保持常驻，不退出 */
  })

  app.on('before-quit', () => {
    stopDrag?.()
  })
}

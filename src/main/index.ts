import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { createPetWindow } from './window'
import { createTray } from './tray'
import { startInteraction } from './interaction'
import { HitMaskStore } from './hitMask'
import { IPC_CHANNELS } from '../shared/types'
import type { HitMask, PetInputEvent } from '../shared/types'

// 单实例：用户双击两次只会聚焦已有实例（技术方案 2.5）
const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  let win: BrowserWindow | null = null
  let tray: Electron.Tray | null = null
  let stopInteraction: (() => void) | null = null

  const maskStore = new HitMaskStore()

  app.on('second-instance', () => {
    if (win && !win.isVisible()) win.show()
  })

  app.whenReady().then(() => {
    win = createPetWindow()
    tray = createTray(win)

    const petWindow = win
    stopInteraction = startInteraction(petWindow, maskStore, (e: PetInputEvent) => {
      petWindow.webContents.send(IPC_CHANNELS.INPUT, e)
    })

    ipcMain.on(IPC_CHANNELS.MASK, (_event, mask: HitMask) => {
      maskStore.set(mask)
    })

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
    stopInteraction?.()
  })
}

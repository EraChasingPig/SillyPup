import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { createPetWindow } from './window'
import { createTray } from './tray'
import { startInteraction } from './interaction'
import { HitMaskStore } from './hitMask'
import { PomodoroService } from './pomodoro'
import { BubbleWindow } from './bubble'
import { popupContextMenu } from './contextMenu'
import { promptMinutes } from './prompt'
import { loadConfig, saveConfig } from './config'
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
  let pomodoro: PomodoroService | null = null

  const maskStore = new HitMaskStore()
  const bubble = new BubbleWindow()
  const config = loadConfig()

  app.on('second-instance', () => {
    if (win && !win.isVisible()) win.show()
  })

  app.whenReady().then(() => {
    const petWindow = createPetWindow()
    win = petWindow
    tray = createTray(petWindow)

    const service = new PomodoroService({
      onTick: (remainMs, running) => {
        petWindow.webContents.send(IPC_CHANNELS.POMODORO_TICK, { remainMs, running })
      },
      onDone: () => {
        petWindow.webContents.send(IPC_CHANNELS.POMODORO_DONE)
        bubble.show(petWindow, '时间到咯，休息两分钟吧')
      }
    })
    pomodoro = service

    stopInteraction = startInteraction(
      petWindow,
      maskStore,
      (e: PetInputEvent) => petWindow.webContents.send(IPC_CHANNELS.INPUT, e),
      (local) => {
        popupContextMenu(petWindow, local, {
          defaultMinutes: config.pomodoroMinutes,
          isRunning: () => service.running,
          start: (minutes) => service.start(minutes),
          stop: () => service.stop(),
          promptCustom: () => {
            void promptMinutes(petWindow, config.pomodoroMinutes).then((minutes) => {
              if (minutes === null) return
              config.pomodoroMinutes = minutes
              saveConfig(config)
              service.start(minutes)
            })
          }
        })
      }
    )

    ipcMain.on(IPC_CHANNELS.MASK, (_event, mask: HitMask) => {
      maskStore.set(mask)
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
      petWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      petWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  })

  // 桌宠常驻：不因窗口关闭而退出，退出统一走托盘
  app.on('window-all-closed', () => {
    /* 保持常驻，不退出 */
  })

  app.on('before-quit', () => {
    stopInteraction?.()
    pomodoro?.dispose()
    bubble.dispose()
  })
}

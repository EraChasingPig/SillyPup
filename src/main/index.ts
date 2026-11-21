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
import { startKeyPoller } from './keyPoller'
import { startCursorPoller } from './cursorPoller'
import { loadConfig, saveConfig } from './config'
import { IPC_CHANNELS } from '../shared/types'
import type { FocusState, HitMask, PetInputEvent } from '../shared/types'

// 单实例：用户双击两次只会聚焦已有实例（技术方案 2.5）
const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  let win: BrowserWindow | null = null
  let tray: Electron.Tray | null = null
  let stopInteraction: (() => void) | null = null
  let stopKeyPoller: (() => void) | null = null
  let stopCursorPoller: (() => void) | null = null
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

    const focusState: FocusState = {
      focusMode: config.focusMode,
      keyBubble: config.keyBubble
    }
    const broadcastFocusState = (): void => {
      petWindow.webContents.send(IPC_CHANNELS.FOCUS_STATE, focusState)
    }

    const keyPoller = startKeyPoller((label) => {
      if (!focusState.keyBubble) return
      petWindow.webContents.send(IPC_CHANNELS.KEY_EVENT, { label })
    })
    const cursorPoller = startCursorPoller((p) => {
      petWindow.webContents.send(IPC_CHANNELS.CURSOR, p)
    })
    cursorPoller.setEnabled(focusState.focusMode)
    stopKeyPoller = keyPoller.stop
    stopCursorPoller = cursorPoller.stop

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
            // 输入时长期间暂停按键轮询，避免把自己敲的数字弹成气泡
            keyPoller.setEnabled(false)
            void promptMinutes(petWindow, config.pomodoroMinutes).then((minutes) => {
              keyPoller.setEnabled(true)
              if (minutes === null) return
              config.pomodoroMinutes = minutes
              saveConfig(config)
              service.start(minutes)
            })
          },
          focusMode: focusState.focusMode,
          keyBubble: focusState.keyBubble,
          setFocusMode: (on) => {
            focusState.focusMode = on
            config.focusMode = on
            saveConfig(config)
            cursorPoller.setEnabled(on)
            broadcastFocusState()
          },
          setKeyBubble: (on) => {
            focusState.keyBubble = on
            config.keyBubble = on
            saveConfig(config)
            broadcastFocusState()
          }
        })
      }
    )

    // 渲染层每次加载完成后同步一次开关状态，保证刷新/重载后不错位
    petWindow.webContents.on('did-finish-load', broadcastFocusState)

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
    stopKeyPoller?.()
    stopCursorPoller?.()
    pomodoro?.dispose()
    bubble.dispose()
  })
}

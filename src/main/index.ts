import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { createPetWindow, applyPetScale, startTopmostWatchdog } from './window'
import { createTray } from './tray'
import { startInteraction } from './interaction'
import { HitMaskStore } from './hitMask'
import { PomodoroService } from './pomodoro'
import { BubbleWindow } from './bubble'
import { popupContextMenu } from './contextMenu'
import { promptMinutes } from './prompt'
import { startKeyPoller } from './keyPoller'
import { startCursorPoller } from './cursorPoller'
import { createMover } from './mover'
import type { Mover } from './mover'
import { loadConfig, saveConfig } from './config'
import { setupLogger, logInfo } from './logger'
import { applyAutoLaunch } from './autoLaunch'
import { IPC_CHANNELS } from '../shared/types'
import type { FocusState, HitMask, MoveDirection, PetInputEvent } from '../shared/types'

// Windows 下 Chromium 的窗口遮挡检测会把被其他窗口盖住的窗口判为“被遮挡”并停止合成。
// 桌宠是透明置顶小窗，遮挡它的窗口关闭后合成不会自动恢复，表现为整只狗从屏幕上消失，
// 只有重新设置一次置顶才会重绘。桌宠体积小且必须常驻可见，直接关闭遮挡检测与遮挡后降级。
const disabledFeatures = app.commandLine.getSwitchValue('disable-features')
app.commandLine.appendSwitch(
  'disable-features',
  disabledFeatures ? `${disabledFeatures},CalculateNativeWinOcclusion` : 'CalculateNativeWinOcclusion'
)
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

// 日志最早就绪，后续启动失败也能留下线索
setupLogger()

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
  let stopTopmostWatchdog: (() => void) | null = null
  let pomodoro: PomodoroService | null = null
  let mover: Mover | null = null
  let scaleAnchor: { x: number; y: number } | null = null

  const maskStore = new HitMaskStore()
  const bubble = new BubbleWindow()
  const config = loadConfig()

  // 任务栏 / 通知归属需要固定的 AppUserModelID，与 electron-builder 的 appId 保持一致
  app.setAppUserModelId('com.sillypup.desktop')

  app.on('second-instance', () => {
    if (win && !win.isVisible()) win.show()
  })

  app.whenReady().then(() => {
    // 每次启动按配置同步一次登录项，防止用户手动删掉注册表后状态不一致
    applyAutoLaunch(config.autoLaunch)
    logInfo(`app ready, userData=${app.getPath('userData')}`)

    const petWindow = createPetWindow(config.scale)
    win = petWindow
    stopTopmostWatchdog = startTopmostWatchdog(petWindow)
    const walkMover = createMover(petWindow, () => config.scale)
    mover = walkMover
    tray = createTray(petWindow, config, (cmd) => {
      petWindow.webContents.send(IPC_CHANNELS.LOCOMOTION, cmd)
    })

    const service = new PomodoroService({
      onTick: (remainMs, running) => {
        petWindow.webContents.send(IPC_CHANNELS.POMODORO_TICK, { remainMs, running })
      },
      onDone: () => {
        logInfo('pomodoro done')
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
    const broadcastScale = (): void => {
      petWindow.webContents.send(IPC_CHANNELS.SCALE, config.scale)
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
      },
      {
        get: () => config.scale,
        begin: () => {
          const b = petWindow.getBounds()
          scaleAnchor = { x: b.x + b.width / 2, y: b.y + b.height }
        },
        set: (s) => {
          const applied = applyPetScale(petWindow, s, scaleAnchor ?? undefined)
          if (applied === config.scale) return
          config.scale = applied
          broadcastScale()
        },
        commit: () => {
          saveConfig(config)
          scaleAnchor = null
        }
      }
    )

    // 渲染层每次加载完成后同步一次状态，保证刷新/重载后不错位
    petWindow.webContents.on('did-finish-load', () => {
      broadcastFocusState()
      broadcastScale()
    })

    ipcMain.on(IPC_CHANNELS.MASK, (_event, mask: HitMask) => {
      maskStore.set(mask)
    })

    // 渲染层决定行走节奏，主进程只负责按方向平移窗口
    ipcMain.on(IPC_CHANNELS.MOVE, (_event, dir: MoveDirection) => {
      walkMover.setDirection(dir)
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
    logInfo('before-quit')
    stopInteraction?.()
    stopKeyPoller?.()
    stopCursorPoller?.()
    stopTopmostWatchdog?.()
    mover?.dispose()
    pomodoro?.dispose()
    bubble.dispose()
  })
}

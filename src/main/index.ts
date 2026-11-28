import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import {
  createPetWindow,
  applyPetScale,
  keepPetOnScreen,
  startTopmostWatchdog
} from './window'
import { createTray } from './tray'
import { startInteraction } from './interaction'
import type { InteractionController } from './interaction'
import { HitMaskStore } from './hitMask'
import { PomodoroService } from './pomodoro'
import { BubbleWindow } from './bubble'
import { AppleWindow } from './appleWindow'
import { popupContextMenu } from './contextMenu'
import { promptMinutes } from './prompt'
import { startKeyPoller } from './keyPoller'
import { startCursorPoller } from './cursorPoller'
import { createMover } from './mover'
import type { Mover } from './mover'
import { createJumpMover } from './jumpMover'
import type { JumpMover } from './jumpMover'
import { loadConfig, saveConfig } from './config'
import { setupLogger, logInfo, logError, readLogTail } from './logger'
import { applyAutoLaunch } from './autoLaunch'
import { IPC_CHANNELS } from '../shared/types'
import type {
  ApplePos,
  FocusState,
  HitMask,
  JumpMovePlan,
  MoveDirection,
  PetInputEvent
} from '../shared/types'

// Windows 下 Chromium 的窗口遮挡检测会把被其他窗口盖住的窗口判为“被遮挡”并停止合成。
// 桌宠是透明置顶小窗，遮挡它的窗口关闭后合成不会自动恢复，表现为整只狗从屏幕上消失，
// 只有重新设置一次置顶才会重绘。桌宠体积小且必须常驻可见，直接关闭遮挡检测与遮挡后降级。
const disabledFeatures = app.commandLine.getSwitchValue('disable-features')
app.commandLine.appendSwitch(
  'disable-features',
  disabledFeatures ? `${disabledFeatures},CalculateNativeWinOcclusion` : 'CalculateNativeWinOcclusion'
)
// 硬件加速（GPU 合成）默认开启。
// 关掉 GPU 后透明窗口在软件合成 + 非 100% 显示缩放下会被系统错误拉伸：
// 拖拽时角色横向/纵向拉长、苹果窗持续变大（125% 横向、150% 纵向，实测必现）。
// 极老显卡 / 远程桌面若出现透明窗黑块，可在托盘打开「兼容渲染」关闭 GPU 合成。

app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

// 打包后渲染层页面走 file://，帧素材用 fetch 读取时会被同源策略拦下。
// 打开本地文件访问权限后即可 fetch 本地 PNG，解码结果只留一份 ImageBitmap，
// 避免为每帧创建 <img> 把解码数据滞留在 Chromium 的图片缓存里。
// 桌宠窗口只加载本地页面，且已禁止打开新窗口，放开该限制不影响外部内容。
app.commandLine.appendSwitch('allow-file-access-from-files')

// 日志最早就绪，后续启动失败也能留下线索
setupLogger()

// 单实例：用户双击两次只会聚焦已有实例（技术方案 2.5）
const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  let win: BrowserWindow | null = null
  let tray: Electron.Tray | null = null
  let interaction: InteractionController | null = null
  let stopKeyPoller: (() => void) | null = null
  let stopCursorPoller: (() => void) | null = null
  let stopTopmostWatchdog: (() => void) | null = null
  let pomodoro: PomodoroService | null = null
  let mover: Mover | null = null
  let jumpMover: JumpMover | null = null
  let appleWindow: AppleWindow | null = null
  let scaleAnchor: { x: number; y: number } | null = null

  const maskStore = new HitMaskStore()
  const bubble = new BubbleWindow()
  const config = loadConfig()
  // GPU 合成必须在应用就绪前决定；兼容模式给软件合成兜底
  if (config.compatRender) app.disableHardwareAcceleration()

  // 任务栏 / 通知归属需要固定的 AppUserModelID，与 electron-builder 的 appId 保持一致
  app.setAppUserModelId('com.sillypup.desktop')

  app.on('second-instance', () => {
    if (win && !win.isVisible()) win.show()
  })

  app.whenReady().then(() => {
    // 每次启动按配置同步一次登录项，防止用户手动删掉注册表后状态不一致
    applyAutoLaunch(config.autoLaunch)
    logInfo(`app ready, userData=${app.getPath('userData')}`)
    logInfo(
      'displays',
      JSON.stringify(
        screen.getAllDisplays().map((d) => ({
          id: d.id,
          bounds: d.bounds,
          workArea: d.workArea,
          scaleFactor: d.scaleFactor
        }))
      ),
      `compatRender=${config.compatRender}`
    )
    void app
      .getGPUInfo('basic')
      .then((info) => logInfo('gpu', JSON.stringify(info)))
      .catch((err) => logError('gpu info failed', err))

    const petWindow = createPetWindow(config.scale)
    win = petWindow
    stopTopmostWatchdog = startTopmostWatchdog(petWindow)
    const walkMover = createMover(petWindow, () => config.scale)
    mover = walkMover
    const verticalMover = createJumpMover(petWindow, () => config.scale)
    jumpMover = verticalMover
    const apple = new AppleWindow(petWindow, () => config.scale)
    appleWindow = apple

    // 诊断信息：托盘一键复制。用户反馈 bug 时即使开发者无法复现，
    // 也能从这段文本里看到系统、显示器、缩放、渲染模式与窗口位置
    const buildDiagnostics = (): string => {
      const displays = screen.getAllDisplays().map((d) => ({
        id: d.id,
        bounds: d.bounds,
        workArea: d.workArea,
        scaleFactor: d.scaleFactor
      }))
      return [
        `version: ${app.getVersion()} (packaged=${app.isPackaged})`,
        `platform: ${process.platform} ${process.getSystemVersion()}`,
        `render: ${config.compatRender ? 'software (compat)' : 'gpu'}`,
        `scale: ${config.scale}`,
        `primary: ${JSON.stringify(screen.getPrimaryDisplay().workArea)}`,
        `displays: ${JSON.stringify(displays)}`,
        `window: ${JSON.stringify(petWindow.getBounds())}`,
        '--- main.log (tail) ---',
        readLogTail()
      ].join('\n')
    }

    // 显示器增删/缩放变化：夹回有效屏、结束苹果轮次，并让渲染层按新 DPR 重建画布
    const handleDisplayChange = (reason: string): void => {
      logInfo(
        `display ${reason}`,
        JSON.stringify(
          screen.getAllDisplays().map((d) => ({
            id: d.id,
            bounds: d.bounds,
            scaleFactor: d.scaleFactor
          }))
        )
      )
      keepPetOnScreen(petWindow, config.scale)
      apple.end()
      petWindow.webContents.send(IPC_CHANNELS.DISPLAY_CHANGED)
    }
    screen.on('display-added', () => handleDisplayChange('added'))
    screen.on('display-removed', () => handleDisplayChange('removed'))
    screen.on('display-metrics-changed', () => handleDisplayChange('metrics-changed'))

    tray = createTray(
      petWindow,
      config,
      (cmd) => {
        petWindow.webContents.send(IPC_CHANNELS.LOCOMOTION, cmd)
      },
      buildDiagnostics
    )

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
      keyBubble: config.keyBubble,
      showState: config.showState
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

    interaction = startInteraction(
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
          keyBubble: focusState.keyBubble,
          showState: focusState.showState,
          setKeyBubble: (on) => {
            focusState.keyBubble = on
            config.keyBubble = on
            saveConfig(config)
            broadcastFocusState()
          },
          setShowState: (on) => {
            focusState.showState = on
            config.showState = on
            saveConfig(config)
            broadcastFocusState()
          },
          onSummonApple: () => apple.summon(),
          isAppleRoundActive: () => apple.isRoundActive
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

    // 跳跃位移由渲染层按素材腾空区间下发时间表，主进程只搬窗口并在边缘钳制
    ipcMain.on(IPC_CHANNELS.JUMP_MOVE, (_event, plan: JumpMovePlan) => {
      verticalMover.start(plan)
    })
    ipcMain.on(IPC_CHANNELS.JUMP_CANCEL, () => {
      verticalMover.cancel()
    })
    // drop_land 真正开播后再开始悬停+下落，保证窗口位移与动画对齐
    ipcMain.on(IPC_CHANNELS.DROP_START, () => {
      interaction?.beginDrop()
    })

    // 苹果：渲染层负责规划与到点判定，主进程只搬窗口
    ipcMain.on(IPC_CHANNELS.APPLE_PIN, (_event, pos: ApplePos) => {
      apple.pin(pos)
    })
    ipcMain.on(IPC_CHANNELS.APPLE_FADE_OUT, () => {
      apple.fadeOut()
    })
    ipcMain.on(IPC_CHANNELS.APPLE_END, () => {
      apple.end()
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
    interaction?.stop()
    stopKeyPoller?.()
    stopCursorPoller?.()
    stopTopmostWatchdog?.()
    mover?.dispose()
    jumpMover?.dispose()
    pomodoro?.dispose()
    bubble.dispose()
    appleWindow?.dispose()
  })
}

import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import {
  APPLE_ARRIVE_DX,
  APPLE_FOLLOW_OFFSET_Y,
  APPLE_ICON_SIZE,
  APPLE_ROUND_TIMEOUT_MS,
  IPC_CHANNELS,
  PET_BASE_SIZE,
  PET_VISIBLE_TOP
} from '../shared/types'
import type { ApplePos } from '../shared/types'

/** 跟随光标刷新间隔，约 60Hz */
const FOLLOW_TICK_MS = 16
/** 苹果位置上报间隔：渲染层规划不需要 60Hz，20Hz 足够且省 IPC */
const POS_REPORT_MS = 50
/** 召唤 / 钉住时的淡入淡出时长 */
const FADE_MS = 120
/** sit_enter 末尾淡出时长 */
const SIT_FADE_MS = 500
/** 与桌宠一致的显示器边缘留白 */
const EDGE_MARGIN = 15

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/**
 * 「小笨狗找苹果」的苹果窗口。
 *
 * 苹果必须画在独立透明窗口里：主窗口只有 300×300，苹果跟随鼠标时会超出被裁掉。
 * 这里负责跟随光标、限制在可达带内、到点后钉在指定位置，以及淡入淡出与超时。
 */
export class AppleWindow {
  private win: BrowserWindow | null = null
  private followTimer: NodeJS.Timeout | null = null
  private timeoutTimer: NodeJS.Timeout | null = null
  private fadeTimer: NodeJS.Timeout | null = null
  private roundActive = false
  /** 到点后停止跟随，固定在坐姿头顶 */
  private pinned = false
  private scale = 1
  private lastReportAt = Number.NEGATIVE_INFINITY

  constructor(
    private readonly petWindow: BrowserWindow,
    private readonly getScale: () => number
  ) {}

  get isRoundActive(): boolean {
    return this.roundActive
  }

  /** 启动后预先创建并加载页面，避免第一次召唤时空白一下 */
  preload(): void {
    const win = this.ensure()
    if (!win.isDestroyed()) win.setOpacity(0)
  }

  /** 开始一轮寻找：苹果出现在光标下方并持续跟随 */
  summon(): void {
    if (this.roundActive) return

    const win = this.ensure()
    this.roundActive = true
    this.pinned = false
    this.scale = this.getScale()
    this.lastReportAt = Number.NEGATIVE_INFINITY

    const { w, h } = this.pixelSize()
    if (win.getBounds().width !== w || win.getBounds().height !== h) {
      win.setSize(w, h)
    }
    win.setOpacity(0)
    win.showInactive()
    win.moveTop()
    this.fadeTo(1, FADE_MS)

    this.petWindow.webContents.send(IPC_CHANNELS.APPLE_SUMMON)
    this.applyFollow()

    this.followTimer = setInterval(() => this.applyFollow(), FOLLOW_TICK_MS)
    this.timeoutTimer = setTimeout(() => this.expire(), APPLE_ROUND_TIMEOUT_MS)
  }

  /** 到点后把苹果钉在坐姿头顶：先淡出，移动，再淡入 */
  pin(pos: ApplePos): void {
    if (!this.roundActive || this.pinned) return
    this.pinned = true
    this.clearTimer('follow')

    const win = this.win
    if (!win || win.isDestroyed()) return
    this.fadeTo(0, FADE_MS, () => {
      if (!this.roundActive || !win || win.isDestroyed()) return
      const { w, h } = this.pixelSize()
      win.setPosition(Math.round(pos.cx - w / 2), Math.round(pos.bottom - h))
      win.moveTop()
      this.fadeTo(1, FADE_MS)
    })
  }

  /** sit_enter 末尾让苹果淡出，随后由动画自带的苹果接上 */
  fadeOut(): void {
    if (!this.roundActive) return
    this.fadeTo(0, SIT_FADE_MS)
  }

  /** 本轮结束 / 被中断：立刻收起，菜单项恢复可用 */
  end(): void {
    this.roundActive = false
    this.pinned = false
    this.clearTimer('follow')
    this.clearTimer('timeout')
    this.clearTimer('fade')
    if (this.win && !this.win.isDestroyed()) this.win.hide()
  }

  dispose(): void {
    this.end()
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }

  /** 超时：收起苹果并通知渲染层放弃本轮 */
  private expire(): void {
    if (!this.roundActive) return
    this.end()
    this.petWindow.webContents.send(IPC_CHANNELS.APPLE_EXPIRED)
  }

  /**
   * 跟随光标：苹果中心固定在光标下方，纵向限制在「可达带」内。
   * 可达带下限保证小狗贴到工作区底边时，抬头仍能碰到苹果；
   * 也就是屏幕最下方一只狗的高度内，苹果不再继续往下跟。
   */
  private applyFollow(): void {
    if (!this.roundActive || this.pinned) return
    const win = this.win
    if (!win || win.isDestroyed()) return

    const cursor = screen.getCursorScreenPoint()
    const wa = screen.getDisplayNearestPoint(cursor).workArea
    const { w, h } = this.pixelSize()
    const s = this.scale

    const minBottom = wa.y + EDGE_MARGIN + h
    const maxBottom = Math.max(
      minBottom,
      wa.y + wa.height - EDGE_MARGIN - PET_BASE_SIZE * s + PET_VISIBLE_TOP * s
    )

    // 横向可达带：小狗窗口最窄也只能到工作区边缘 15px 处，
    // 因此苹果中心不能比「边缘 15px + 半个窗口」再往外走，否则小狗永远够不到。
    const halfPet = (PET_BASE_SIZE / 2) * s
    const cx = clamp(
      cursor.x,
      wa.x + EDGE_MARGIN + halfPet - APPLE_ARRIVE_DX,
      wa.x + wa.width - EDGE_MARGIN - halfPet + APPLE_ARRIVE_DX
    )
    const bottom = clamp(cursor.y + APPLE_FOLLOW_OFFSET_Y * s + h / 2, minBottom, maxBottom)

    win.setPosition(Math.round(cx - w / 2), Math.round(bottom - h))

    const now = performance.now()
    if (now - this.lastReportAt >= POS_REPORT_MS) {
      this.lastReportAt = now
      this.petWindow.webContents.send(IPC_CHANNELS.APPLE_POS, {
        cx,
        bottom
      } satisfies ApplePos)
    }
  }

  private pixelSize(): { w: number; h: number } {
    return {
      w: Math.max(1, Math.round(APPLE_ICON_SIZE.width * this.scale)),
      h: Math.max(1, Math.round(APPLE_ICON_SIZE.height * this.scale))
    }
  }

  private fadeTo(target: number, ms: number, done?: () => void): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    this.clearTimer('fade')

    const from = win.getOpacity()
    const startAt = performance.now()
    this.fadeTimer = setInterval(() => {
      if (!win || win.isDestroyed()) {
        this.clearTimer('fade')
        return
      }
      const t = Math.min(1, (performance.now() - startAt) / ms)
      win.setOpacity(from + (target - from) * t)
      if (t >= 1) {
        this.clearTimer('fade')
        done?.()
      }
    }, 16)
  }

  private clearTimer(which: 'follow' | 'timeout' | 'fade'): void {
    const key =
      which === 'follow' ? 'followTimer' : which === 'timeout' ? 'timeoutTimer' : 'fadeTimer'
    const timer = this[key]
    if (timer) {
      clearInterval(timer)
      this[key] = null
    }
  }

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win

    const { w, h } = this.pixelSize()
    const win = new BrowserWindow({
      width: w,
      height: h,
      transparent: true,
      frame: false,
      hasShadow: false,
      alwaysOnTop: true,
      resizable: false,
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
    // 苹果不能挡住下层程序的点击
    win.setIgnoreMouseEvents(true, { forward: true })
    win.on('closed', () => {
      this.win = null
    })

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      void win.loadURL(`${devUrl}/apple.html`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/apple.html'))
    }

    this.win = win
    return win
  }
}

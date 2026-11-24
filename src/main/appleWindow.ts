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
import { logError, logInfo } from './logger'

/** 跟随光标刷新间隔，约 60Hz */
const FOLLOW_TICK_MS = 16
/** 苹果位置上报间隔：渲染层规划不需要 60Hz，20Hz 足够且省 IPC */
const POS_REPORT_MS = 50
/** 一轮结束后窗口常驻多久再销毁；期间再次召唤可直接复用，省去重建 */
const IDLE_DESTROY_MS = 8000
/** 页面迟迟没就绪时的显示兜底：宁可露出空白也不能让苹果一直不出现 */
const REVEAL_FALLBACK_MS = 1200
/** 与桌宠一致的显示器边缘留白 */
const EDGE_MARGIN = 15

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/**
 * 「小笨狗找苹果」的苹果窗口。
 *
 * 苹果必须画在独立透明窗口里：主窗口只有 300×300，苹果跟随鼠标时会超出被裁掉。
 * 这里负责跟随光标、限制在可达带内、到点后钉在指定位置，以及超时。
 *
 * 注意：不要用 win.setOpacity() 做淡入淡出。关闭硬件加速后，透明窗口的逐像素 alpha
 * 再叠加 LWA_ALPHA 会让整窗空白（isVisible=true、页面也画了，但屏幕上看不见苹果）。
 */
export class AppleWindow {
  private win: BrowserWindow | null = null
  private followTimer: NodeJS.Timeout | null = null
  private timeoutTimer: NodeJS.Timeout | null = null
  private destroyTimer: NodeJS.Timeout | null = null
  private revealTimer: NodeJS.Timeout | null = null
  /** 当前窗口的页面是否已完成首次绘制，未就绪时不能显示，否则窗口会一直空白 */
  private pageReady = false
  /** 页面未就绪时挂起的显示动作，就绪后立即补上 */
  private pendingReveal: (() => void) | null = null
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

  /** 开始一轮寻找：苹果出现在光标下方并持续跟随。窗口按需创建，页面就绪后立即显示 */
  summon(): void {
    if (this.roundActive) return
    logInfo('apple window summon')

    this.clearDestroyTimer()
    const win = this.ensure()
    this.roundActive = true
    this.pinned = false
    this.scale = this.getScale()
    this.lastReportAt = Number.NEGATIVE_INFINITY

    const { w, h } = this.pixelSize()
    if (win.getBounds().width !== w || win.getBounds().height !== h) {
      win.setSize(w, h)
    }
    const reveal = (): void => {
      if (!this.roundActive || win.isDestroyed()) return
      // 注意：这里不要用 setOpacity 做淡入。透明窗口本身就是逐像素 alpha 的分层窗口，
      // 再叠加 LWA_ALPHA 的统一透明度会让窗口在软件合成下整窗空白（isVisible=true 却不出图）。
      win.showInactive()
      win.moveTop()
      logInfo(
        `apple window reveal bounds=${JSON.stringify(win.getBounds())} visible=${win.isVisible()}`
      )
    }
    // 懒创建出来的窗口必须先等页面首次绘制完成再显示：
    // Windows 上对尚未 paint 的透明窗口调 showInactive()，窗口会 isVisible=true 却整窗不出图，
    // 表现为「小狗在追鼠标、苹果却看不见」。已就绪（复用窗口）时立即显示，不做额外等待。
    if (this.pageReady) {
      reveal()
    } else {
      this.pendingReveal = reveal
      this.clearRevealTimer()
      this.revealTimer = setTimeout(() => {
        this.revealTimer = null
        logInfo('apple window reveal fallback, page not ready')
        this.flushReveal()
      }, REVEAL_FALLBACK_MS)
    }

    this.petWindow.webContents.send(IPC_CHANNELS.APPLE_SUMMON)
    this.applyFollow()

    this.followTimer = setInterval(() => this.applyFollow(), FOLLOW_TICK_MS)
    this.timeoutTimer = setTimeout(() => this.expire(), APPLE_ROUND_TIMEOUT_MS)
  }

  /** 到点后把苹果钉在坐姿头顶：先收起窗口，移动，再显示 */
  pin(pos: ApplePos): void {
    if (!this.roundActive || this.pinned) return
    this.pinned = true
    this.clearTimer('follow')

    const win = this.win
    if (!win || win.isDestroyed()) return
    win.hide()
    const { w, h } = this.pixelSize()
    win.setPosition(Math.round(pos.cx - w / 2), Math.round(pos.bottom - h))
    win.showInactive()
    win.moveTop()
  }

  /** sit_enter 末尾让苹果消失，随后由动画自带的苹果接上 */
  fadeOut(): void {
    if (!this.roundActive) return
    const win = this.win
    if (win && !win.isDestroyed()) win.hide()
  }

  /** 本轮结束 / 被中断：立刻收起，菜单项恢复可用，稍后销毁窗口释放内存 */
  end(): void {
    this.roundActive = false
    this.pinned = false
    this.clearTimer('follow')
    this.clearTimer('timeout')
    this.clearRevealTimer()
    this.pendingReveal = null
    if (this.win && !this.win.isDestroyed()) this.win.hide()
    this.scheduleDestroy()
  }

  dispose(): void {
    this.end()
    this.clearDestroyTimer()
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }

  /** 页面首次绘制完成：标记就绪，并把召唤时挂起的显示动作补上 */
  private markReady(win: BrowserWindow): void {
    if (this.win !== win) return
    this.pageReady = true
    this.flushReveal()
  }

  private flushReveal(): void {
    this.clearRevealTimer()
    const pending = this.pendingReveal
    this.pendingReveal = null
    pending?.()
  }

  private clearRevealTimer(): void {
    if (this.revealTimer) {
      clearTimeout(this.revealTimer)
      this.revealTimer = null
    }
  }

  /** 一轮结束后延迟销毁窗口；期间再次召唤直接复用，不用重新加载页面 */
  private scheduleDestroy(): void {
    this.clearDestroyTimer()
    this.destroyTimer = setTimeout(() => {
      this.destroyTimer = null
      if (this.roundActive) return
      if (this.win && !this.win.isDestroyed()) this.win.destroy()
      this.win = null
    }, IDLE_DESTROY_MS)
  }

  private clearDestroyTimer(): void {
    if (this.destroyTimer) {
      clearTimeout(this.destroyTimer)
      this.destroyTimer = null
    }
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

  private clearTimer(which: 'follow' | 'timeout'): void {
    const key = which === 'follow' ? 'followTimer' : 'timeoutTimer'
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

    // 新建窗口时页面还没画过，先标记未就绪，等 ready-to-show 再允许显示
    this.pageReady = false
    this.pendingReveal = null
    win.once('ready-to-show', () => {
      logInfo('apple window ready-to-show')
      this.markReady(win)
    })
    win.on('closed', () => {
      this.pageReady = false
      this.pendingReveal = null
      this.clearRevealTimer()
      this.win = null
    })

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    let retried = false
    const load = (): void => {
      if (devUrl) void win.loadURL(`${devUrl}/apple.html`)
      else void win.loadFile(join(__dirname, '../renderer/apple.html'))
    }
    // 页面加载失败自动重试一次，并把原因留在日志里，便于定位「苹果不显示」
    win.webContents.on('did-fail-load', (_event, code, desc, url, isMainFrame) => {
      if (!isMainFrame) return
      logError(`apple window load failed code=${code} desc=${desc} url=${url}`)
      if (retried) return
      retried = true
      load()
    })
    win.webContents.on('did-finish-load', () => logInfo('apple window ready'))
    load()
    logInfo('apple window created')

    this.win = win
    return win
  }
}

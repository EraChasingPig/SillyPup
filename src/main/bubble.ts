import { BrowserWindow, screen } from 'electron'
import { join } from 'path'

const BUBBLE_W = 320
const BUBBLE_H = 180

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/**
 * 番茄钟结束气泡：独立透明窗口，永远置顶、不抢焦点、不拦截鼠标。
 * 用独立窗口而不是在主窗口里画，是因为主窗口只有 300×300，气泡会超出被裁掉。
 */
export class BubbleWindow {
  private win: BrowserWindow | null = null
  private hideTimer: NodeJS.Timeout | null = null

  show(anchor: BrowserWindow, text: string, durationMs = 6000): void {
    const win = this.ensure()
    this.clearTimer()

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    const loaded = devUrl
      ? win.loadURL(`${devUrl}/bubble.html?text=${encodeURIComponent(text)}`)
      : win.loadFile(join(__dirname, '../renderer/bubble.html'), { query: { text } })

    void loaded.then(() => {
      if (win.isDestroyed()) return
      this.position(anchor, win)
      win.showInactive()
    })

    this.hideTimer = setTimeout(() => this.hide(), durationMs)
  }

  hide(): void {
    this.clearTimer()
    if (this.win && !this.win.isDestroyed()) this.win.hide()
  }

  dispose(): void {
    this.clearTimer()
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win

    const win = new BrowserWindow({
      width: BUBBLE_W,
      height: BUBBLE_H,
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
        sandbox: false
      }
    })

    win.setAlwaysOnTop(true, 'screen-saver')
    win.setIgnoreMouseEvents(true, { forward: true })
    win.on('closed', () => {
      this.win = null
    })

    this.win = win
    return win
  }

  /** 默认贴在桌宠正上方，上方空间不够时改到下方，整体限制在 workArea 内 */
  private position(anchor: BrowserWindow, win: BrowserWindow): void {
    const b = anchor.getBounds()
    const display = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y })
    const wa = display.workArea

    let x = Math.round(b.x + b.width / 2 - BUBBLE_W / 2)
    let y = b.y - BUBBLE_H - 6

    if (y < wa.y) {
      y = b.y + b.height + 6
    }

    x = clamp(x, wa.x, wa.x + wa.width - BUBBLE_W)
    y = clamp(y, wa.y, wa.y + wa.height - BUBBLE_H)

    win.setPosition(x, y)
  }

  private clearTimer(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
  }
}

import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { IPC_CHANNELS } from '../shared/types'

let current: BrowserWindow | null = null

/**
 * 自定义时长输入窗口。
 * 原生菜单只能做选项，输入需要独立窗口：可聚焦、无边框、圆角卡片样式。
 * 返回 null 表示用户取消（含直接关窗、按 Esc）。
 */
export function promptMinutes(anchor: BrowserWindow, initial: number): Promise<number | null> {
  // 同一时刻只允许一个输入窗口，避免重复点击叠出多个
  if (current && !current.isDestroyed()) {
    current.focus()
    return Promise.resolve(null)
  }

  return new Promise<number | null>((resolve) => {
    const anchorBounds = anchor.getBounds()
    const display = screen.getDisplayNearestPoint({
      x: anchorBounds.x + anchorBounds.width / 2,
      y: anchorBounds.y + anchorBounds.height / 2
    })
    const wa = display.workArea
    const width = 320
    const height = 186

    const win = new BrowserWindow({
      width,
      height,
      x: Math.round(wa.x + (wa.width - width) / 2),
      y: Math.round(wa.y + (wa.height - height) / 2),
      transparent: true,
      frame: false,
      hasShadow: false,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    current = win
    win.setAlwaysOnTop(true, 'screen-saver')

    let finished = false
    const finish = (value: number | null): void => {
      if (finished) return
      finished = true
      ipcMain.removeListener(IPC_CHANNELS.PROMPT_SUBMIT, onSubmit)
      ipcMain.removeListener(IPC_CHANNELS.PROMPT_CANCEL, onCancel)
      if (!win.isDestroyed()) win.close()
      current = null
      resolve(value)
    }

    const onSubmit = (_e: Electron.IpcMainEvent, minutes: number): void => finish(minutes)
    const onCancel = (): void => finish(null)

    ipcMain.on(IPC_CHANNELS.PROMPT_SUBMIT, onSubmit)
    ipcMain.on(IPC_CHANNELS.PROMPT_CANCEL, onCancel)

    win.on('closed', () => {
      if (!finished) {
        finished = true
        ipcMain.removeListener(IPC_CHANNELS.PROMPT_SUBMIT, onSubmit)
        ipcMain.removeListener(IPC_CHANNELS.PROMPT_CANCEL, onCancel)
        current = null
        resolve(null)
      }
    })

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    const loaded = devUrl
      ? win.loadURL(`${devUrl}/prompt.html?initial=${initial}`)
      : win.loadFile(join(__dirname, '../renderer/prompt.html'), { query: { initial: String(initial) } })

    void loaded.then(() => {
      if (win.isDestroyed()) return
      win.show()
      win.focus()
    })
  })
}

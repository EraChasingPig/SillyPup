import { Tray, Menu, app, nativeImage, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { saveConfig } from './config'
import type { AppConfig } from './config'
import { applyAutoLaunch } from './autoLaunch'
import { logInfo, logError } from './logger'

/**
 * 托盘图标路径：开发模式在项目根目录，打包后在 resources/resources。
 * 按候选列表逐个探测，避免某一种运行方式下路径判断偏差导致取到空图（托盘会显示黑块）。
 */
function resolveTrayIconPath(): string | null {
  const candidates = [
    join(app.getAppPath(), 'resources', 'icon.png'),
    join(process.resourcesPath ?? '', 'resources', 'icon.png'),
    join(__dirname, '../../resources/icon.png')
  ]
  return candidates.find((p) => p && existsSync(p)) ?? null
}

/**
 * 创建托盘。桌宠无边框且 skipTaskbar，用户只能靠托盘退出。
 */
export function createTray(win: BrowserWindow, config: AppConfig): Tray {
  const iconPath = resolveTrayIconPath()
  if (!iconPath) {
    logError('tray icon not found, candidates checked', app.getAppPath(), process.resourcesPath)
  }
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
  logInfo(`tray icon path=${iconPath} empty=${icon.isEmpty()} size=${JSON.stringify(icon.getSize())}`)

  const tray = new Tray(icon)
  tray.setToolTip('樱羽艾玛小笨狗')

  const menu = Menu.buildFromTemplate([
    {
      label: '显示 / 隐藏',
      click: () => (win.isVisible() ? win.hide() : win.show())
    },
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: true,
      click: (item) => win.setAlwaysOnTop(item.checked)
    },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: config.autoLaunch,
      click: (item) => {
        config.autoLaunch = item.checked
        saveConfig(config)
        applyAutoLaunch(item.checked)
      }
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])

  tray.setContextMenu(menu)
  tray.on('click', () => (win.isVisible() ? win.hide() : win.show()))

  return tray
}

import { Tray, Menu, app, nativeImage, BrowserWindow } from 'electron'
import { join } from 'path'
import { saveConfig } from './config'
import type { AppConfig } from './config'
import { applyAutoLaunch } from './autoLaunch'

/**
 * 托盘图标：开发模式从项目根目录读取，打包后从 resources/resources 读取
 * （对应 electron-builder.yml 的 extraResources）。
 */
function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', 'icon.png')
    : join(app.getAppPath(), 'resources', 'icon.png')
}

/**
 * 创建托盘。桌宠无边框且 skipTaskbar，用户只能靠托盘退出。
 */
export function createTray(win: BrowserWindow, config: AppConfig): Tray {
  const icon = nativeImage.createFromPath(trayIconPath())

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

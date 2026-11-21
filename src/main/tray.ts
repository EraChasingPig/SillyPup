import { Tray, Menu, app, nativeImage, BrowserWindow } from 'electron'
import { join } from 'path'

/**
 * 创建托盘。桌宠无边框且 skipTaskbar，用户只能靠托盘退出。
 * M0 用 resources/icon.png 作为占位图标。
 */
export function createTray(win: BrowserWindow): Tray {
  const iconPath = join(app.getAppPath(), 'resources', 'icon.png')
  const icon = nativeImage.createFromPath(iconPath)

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
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])

  tray.setContextMenu(menu)
  tray.on('click', () => (win.isVisible() ? win.hide() : win.show()))

  return tray
}

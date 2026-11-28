import { Tray, Menu, app, nativeImage, BrowserWindow, clipboard, dialog } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { saveConfig } from './config'
import type { AppConfig } from './config'
import type { LocomotionCmd } from '../shared/types'
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
export function createTray(
  win: BrowserWindow,
  config: AppConfig,
  onLocomotion: (cmd: LocomotionCmd) => void,
  buildDiagnostics: () => string
): Tray {
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
    // 散步与跳跃的临时入口，后续接入喂食模式与 WASD 主动控制后移除
    { label: '向左走', click: () => onLocomotion('walk-left') },
    { label: '向右走', click: () => onLocomotion('walk-right') },
    { label: '停下', click: () => onLocomotion('stop') },
    { type: 'separator' },
    { label: '向上跳一层', click: () => onLocomotion('jump-up') },
    { label: '向下跳一层', click: () => onLocomotion('jump-down') },
    { type: 'separator' },
    {
      label: '复制诊断信息',
      click: () => {
        clipboard.writeText(buildDiagnostics())
        void dialog.showMessageBox({
          type: 'info',
          title: '已复制',
          message: '诊断信息已复制到剪贴板',
          detail: '反馈问题时直接粘贴即可，其中包含系统、显示器、缩放、显卡与最近日志。'
        })
      }
    },
    {
      label: '兼容渲染（关闭 GPU 合成，重启生效）',
      type: 'checkbox',
      checked: config.compatRender,
      click: (item) => {
        config.compatRender = item.checked
        saveConfig(config)
        void dialog
          .showMessageBox({
            type: 'question',
            title: '需要重启',
            message: item.checked ? '已开启兼容渲染' : '已关闭兼容渲染',
            detail: '该设置需要重启小笨狗后才生效。',
            buttons: ['立即重启', '稍后'],
            defaultId: 0,
            cancelId: 1
          })
          .then(({ response }) => {
            if (response !== 0) return
            app.relaunch()
            app.quit()
          })
      }
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])

  tray.setContextMenu(menu)
  tray.on('click', () => (win.isVisible() ? win.hide() : win.show()))

  return tray
}

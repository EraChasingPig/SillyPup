import { app, BrowserWindow, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import type { Point } from '../shared/types'

export interface ContextMenuDeps {
  defaultMinutes: number
  isRunning: () => boolean
  start: (minutes: number) => void
  stop: () => void
  /** 打开键盘输入窗口，自定义 1~999 分钟的时长 */
  promptCustom: () => void
  /** 当前 Focus 模式开关状态 */
  focusMode: boolean
  /** 当前按键气泡开关状态 */
  keyBubble: boolean
  setFocusMode: (on: boolean) => void
  setKeyBubble: (on: boolean) => void
}

/**
 * 右键菜单（技术方案 3.5 ⑥）。
 * 窗口 focusable:false 且常驻穿透，渲染层拿不到 contextmenu 事件，
 * 因此必须由主进程在检测到「右键按下 + 光标命中角色」时弹原生菜单。
 *
 * 显式传入窗口内坐标，让菜单固定从按下点展开；
 * 不传时由系统自由定位，位置会随菜单高度浮动。
 */
export function popupContextMenu(
  win: BrowserWindow,
  at: Point,
  deps: ContextMenuDeps
): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: `开始专注 ${deps.defaultMinutes} 分钟`,
      click: () => deps.start(deps.defaultMinutes)
    },
    {
      label: '自定义时长…',
      click: () => deps.promptCustom()
    },
    {
      label: '停止专注',
      enabled: deps.isRunning(),
      click: () => deps.stop()
    },
    { type: 'separator' },
    {
      label: 'Focus 模式',
      type: 'checkbox',
      checked: deps.focusMode,
      click: (item: Electron.MenuItem) => deps.setFocusMode(item.checked)
    },
    {
      label: '按键气泡',
      type: 'checkbox',
      checked: deps.keyBubble,
      click: (item: Electron.MenuItem) => deps.setKeyBubble(item.checked)
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]

  Menu.buildFromTemplate(template).popup({ window: win, x: at.x, y: at.y })
}

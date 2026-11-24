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
  /** 当前按键气泡开关状态 */
  keyBubble: boolean
  /** 当前状态标注开关状态 */
  showState: boolean
  setKeyBubble: (on: boolean) => void
  setShowState: (on: boolean) => void
  /** 召唤一个跟随光标的苹果，开始一轮寻找 */
  onSummonApple: () => void
  /** 本轮找苹果是否还没结束（未结束则菜单项置灰） */
  isAppleRoundActive: () => boolean
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
      label: '获得苹果',
      enabled: !deps.isAppleRoundActive(),
      click: () => deps.onSummonApple()
    },
    { type: 'separator' },
    {
      label: '按键气泡',
      type: 'checkbox',
      checked: deps.keyBubble,
      click: (item: Electron.MenuItem) => deps.setKeyBubble(item.checked)
    },
    {
      label: '显示状态标注',
      type: 'checkbox',
      checked: deps.showState,
      click: (item: Electron.MenuItem) => deps.setShowState(item.checked)
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]

  Menu.buildFromTemplate(template).popup({ window: win, x: at.x, y: at.y })
}

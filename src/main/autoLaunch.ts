import { app } from 'electron'
import type { Settings } from 'electron'

/**
 * 开机自启。Windows 下写入 HKCU\Software\Microsoft\Windows\CurrentVersion\Run，
 * 属于当前用户范围，不需要管理员权限。
 *
 * 开发模式下注册的是 Electron 可执行文件本身，必须带上项目路径参数，
 * 否则开机只会启动一个空的 Electron；打包后注册 exe 即可。
 */
export function applyAutoLaunch(enabled: boolean): void {
  try {
    const settings: Settings = { openAtLogin: enabled }
    if (!app.isPackaged) {
      settings.path = process.execPath
      settings.args = [app.getAppPath()]
    }
    app.setLoginItemSettings(settings)
  } catch {
    // 系统策略可能禁止写注册表，失败时静默处理，不影响桌宠主功能
  }
}

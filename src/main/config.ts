import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { PET_SCALE_MAX, PET_SCALE_MIN } from '../shared/types'

export interface AppConfig {
  /** 番茄钟默认时长（分钟） */
  pomodoroMinutes: number
  /** Focus 模式：小笨狗坐书桌前敲键盘的形象 */
  focusMode: boolean
  /** 全局按键气泡开关 */
  keyBubble: boolean
  /** 左上角状态标注开关（默认隐藏） */
  showState: boolean
  /** 开机自启（写入 HKCU\...\Run） */
  autoLaunch: boolean
  /** 桌宠缩放比例（1 为基准尺寸） */
  scale: number
  /** 兼容渲染：关闭 GPU 合成，缓解老显卡 / 远程桌面下的透明窗黑块（需重启） */
  compatRender: boolean
}

const DEFAULTS: AppConfig = {
  pomodoroMinutes: 25,
  focusMode: false,
  keyBubble: true,
  showState: false,
  autoLaunch: false,
  scale: 1,
  compatRender: false
}

let cache: AppConfig | null = null

function clampScale(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULTS.scale
  return Math.min(Math.max(v, PET_SCALE_MIN), PET_SCALE_MAX)
}

/**
 * 用户配置放在 userData，与随 asar 打包的动画资源分开（技术方案 3.2）。
 * 配置损坏时重置为默认值并写回，不阻断启动。
 */
function configPath(): string {
  return join(app.getPath('userData'), 'app.config.json')
}

export function loadConfig(): AppConfig {
  if (cache) return cache

  try {
    if (existsSync(configPath())) {
      const raw = JSON.parse(readFileSync(configPath(), 'utf-8')) as Partial<AppConfig>
      cache = {
        pomodoroMinutes:
          typeof raw.pomodoroMinutes === 'number' && raw.pomodoroMinutes > 0
            ? raw.pomodoroMinutes
            : DEFAULTS.pomodoroMinutes,
        // 菜单入口已移除，旧配置若残留 true 会卡在 Focus 场景且无法关闭，启动时一律重置
        focusMode: false,
        keyBubble: typeof raw.keyBubble === 'boolean' ? raw.keyBubble : DEFAULTS.keyBubble,
        showState: typeof raw.showState === 'boolean' ? raw.showState : DEFAULTS.showState,
        autoLaunch: typeof raw.autoLaunch === 'boolean' ? raw.autoLaunch : DEFAULTS.autoLaunch,
        scale: clampScale(raw.scale),
        compatRender:
          typeof raw.compatRender === 'boolean' ? raw.compatRender : DEFAULTS.compatRender
      }
      return cache
    }
  } catch {
    // 落到下面的重置逻辑
  }

  cache = { ...DEFAULTS }
  saveConfig(cache)
  return cache
}

export function saveConfig(cfg: AppConfig): void {
  cache = { ...cfg }
  try {
    writeFileSync(configPath(), JSON.stringify(cache, null, 2), 'utf-8')
  } catch {
    // 写盘失败不影响运行，下次启动回落到默认值
  }
}

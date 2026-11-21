import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface AppConfig {
  /** 番茄钟默认时长（分钟） */
  pomodoroMinutes: number
}

const DEFAULTS: AppConfig = {
  pomodoroMinutes: 25
}

let cache: AppConfig | null = null

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
            : DEFAULTS.pomodoroMinutes
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

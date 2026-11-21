import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import type { HitMask, PetInputEvent, PomodoroTick } from '../shared/types'

const api = {
  platform: process.platform,

  /** 渲染层 → 主进程：上报命中掩码（决定鼠标穿透与否） */
  reportMask: (mask: HitMask): void => {
    ipcRenderer.send(IPC_CHANNELS.MASK, mask)
  },

  /** 主进程 → 渲染层：订阅点击 / 拖拽输入事件，返回取消订阅函数 */
  onPetInput: (cb: (e: PetInputEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: PetInputEvent): void => {
      cb(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.INPUT, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.INPUT, handler)
    }
  },

  /** 主进程 → 渲染层：番茄钟每秒心跳 */
  onPomodoroTick: (cb: (t: PomodoroTick) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: PomodoroTick): void => {
      cb(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.POMODORO_TICK, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.POMODORO_TICK, handler)
    }
  },

  /** 主进程 → 渲染层：番茄钟结束 */
  onPomodoroDone: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on(IPC_CHANNELS.POMODORO_DONE, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.POMODORO_DONE, handler)
    }
  },

  /** 自定义时长窗口：提交（分钟） */
  submitPrompt: (minutes: number): void => {
    ipcRenderer.send(IPC_CHANNELS.PROMPT_SUBMIT, minutes)
  },

  /** 自定义时长窗口：取消 */
  cancelPrompt: (): void => {
    ipcRenderer.send(IPC_CHANNELS.PROMPT_CANCEL)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type PreloadApi = typeof api

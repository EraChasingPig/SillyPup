import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import type {
  CursorPayload,
  FocusState,
  HitMask,
  KeyEventPayload,
  PetInputEvent,
  PomodoroTick
} from '../shared/types'

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
  },

  /** 主进程 → 渲染层：Focus 模式与按键气泡开关 */
  onFocusState: (cb: (s: FocusState) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: FocusState): void => cb(payload)
    ipcRenderer.on(IPC_CHANNELS.FOCUS_STATE, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.FOCUS_STATE, handler)
    }
  },

  /** 主进程 → 渲染层：全局按键 */
  onKeyEvent: (cb: (e: KeyEventPayload) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: KeyEventPayload): void => cb(payload)
    ipcRenderer.on(IPC_CHANNELS.KEY_EVENT, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.KEY_EVENT, handler)
    }
  },

  /** 主进程 → 渲染层：全局光标位置（Focus 模式鼠标垫映射） */
  onCursor: (cb: (p: CursorPayload) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: CursorPayload): void => cb(payload)
    ipcRenderer.on(IPC_CHANNELS.CURSOR, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.CURSOR, handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type PreloadApi = typeof api

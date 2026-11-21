import { contextBridge } from 'electron'

// M0 阶段拖拽由主进程轮询驱动，渲染层暂不需要 IPC 通道。
// 后续 M2/M3 通过 contextBridge 暴露白名单 API（见技术方案 3.3）。
const api = {
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)

export type PreloadApi = typeof api

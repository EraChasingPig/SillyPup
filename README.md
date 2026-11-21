# 樱羽艾玛小笨狗桌宠

一只常驻 Windows 桌面的二次元 Q 版萌宠。透明置顶、可拖拽、会撒娇，后续还会陪你敲键盘、盯番茄钟。

> 当前状态：**M0 骨架已完成**（窗口 / 托盘 / 拖拽跑通），互动、番茄钟、Focus Mode 尚未开始。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 运行时 | Electron 33 |
| 构建 | electron-vite（main / preload / renderer 三端独立构建） |
| 界面 | React 18 + TypeScript |
| 原生调用 | koffi（调用 user32 读取鼠标/按键状态，无需编译原生模块） |

## 环境要求

- Windows 10 1809+ 或 Windows 11（目前**仅支持 Windows**）
- Node.js 20 及以上（本项目实测于 Node 26.13.1）

## 快速开始

```powershell
# 1. 安装依赖（国内建议走镜像）
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm install --registry=https://registry.npmmirror.com

# 2. npm 11+ 默认拦截依赖的安装脚本，需显式放行
npm install-scripts approve electron koffi esbuild
npm rebuild electron koffi esbuild

# 3. 启动
npm run dev
```

启动后屏幕左上角会出现一个橙色圆形占位角色，可以拖拽（松手自动吸附在屏幕内），右下角托盘图标提供显示/隐藏、置顶开关和退出。

> **首次安装排错**：若 `node_modules/electron/dist/electron.exe` 不存在，说明 Electron 二进制没下载成功。可手动下载 `https://npmmirror.com/mirrors/electron/<版本>/electron-v<版本>-win32-x64.zip`，解压到 `node_modules/electron/dist/`，再在该目录下写入 `path.txt`（内容 `electron.exe`）。详见下文「常见问题」。

## 可用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发模式启动（热更新） |
| `npm run build` | 构建 main / preload / renderer 到 `out/` |
| `npm run preview` | 以生产构建产物启动 |
| `npm run typecheck` | 对 node 端与 web 端分别做 TypeScript 类型检查 |

## 目录结构

```
SillyPup/
├─ src/
│  ├─ main/                  # 主进程
│  │  ├─ index.ts            # 生命周期、单实例锁、加载渲染层
│  │  ├─ window.ts           # 透明 / 无边框 / 置顶 / 不可聚焦窗口
│  │  ├─ tray.ts             # 托盘菜单
│  │  └─ dragController.ts   # 光标轮询拖拽 + 屏幕边界限制
│  ├─ preload/               # contextBridge 白名单 API
│  ├─ renderer/              # 渲染层（React）
│  │  ├─ index.html
│  │  └─ src/{main.tsx, App.tsx, index.css}
│  └─ shared/                # 主进程与渲染层共用类型
├─ resources/icon.png        # 托盘占位图标
├─ electron.vite.config.ts
├─ tsconfig*.json
└─ package.json
```

## 关键设计取舍

- **透明窗口**：`transparent + frame:false + hasShadow:false`，同时 `focusable:false` 避免点桌宠抢走当前程序焦点，`backgroundThrottling:false` 避免窗口失焦后动画降频。
- **拖拽不用 `-webkit-app-region: drag`**：该系统能力会吞掉 `mousedown/mousemove`，导致「点击」与「拖拽」的位移阈值判定失效。改为主进程 60Hz 轮询 `screen.getCursorScreenPoint()` + `koffi` 读取左键状态，再用 `setPosition` 移动窗口。
- **坐标一律使用 DIP**：`screen.getCursorScreenPoint()` 与 `display.workArea` 返回的都是 DIP，混用物理像素会在 125%/150% 缩放下产生拖拽漂移。
- **边界限制用 `workArea` 而非 `bounds`**：`workArea` 已排除任务栏，不会把桌宠藏到任务栏下面导致找不回。
- **全局按键用轮询而非键盘钩子**：`WH_KEYBOARD_LL` 的行为特征与键盘记录器一致，容易触发杀软误报；按 30~60Hz 轮询 `GetAsyncKeyState` 足以满足「显示按键名」的需求，且不装钩子。

更完整的架构、状态机、素材管线与风险清单见 [技术方案](桌宠项目-技术方案.md)。

## 开发路线图

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| M0 | 透明置顶窗口、托盘、单实例、拖拽与边界限制 | 已完成 |
| M1 | 动画播放器 + 状态机（Idle/Action/Interact/Grabbed/Dragging/Dropped/Land） | 待开始 |
| M2 | alpha 掩码命中判定、点击穿透切换、点击互动与冷却 | 待开始 |
| M3 | 番茄钟、置顶气泡、睡眠唤醒计时校准 | 待开始 |
| M4 | Focus Mode、键盘气泡、鼠标垫映射跟随 | 待开始 |
| M5 | 打包（NSIS）、开机自启、图标、日志 | 待开始 |
| M6 | 正式素材替换、性能打磨 | 待开始 |

## 已知限制

- 仅支持 Windows，未做 macOS / Linux 适配。
- 角色目前是占位色块，尚未接入真实素材。
- 尚未实现点击穿透：当前窗口整体可点击，暂不支持「点空白处穿透到下层程序」。
- 无法捕获以管理员权限运行的前台程序的按键（Windows UIPI 限制，不打算通过提权规避）。

## 文档

- [需求与提问（修正版）](桌宠项目-需求与提问-修正版.md)
- [技术方案](桌宠项目-技术方案.md)

## 常见问题

**`npm install` 后启动报 `Electron failed to install correctly`**

多为二进制未下载完成。确认 `node_modules/electron/dist/electron.exe` 是否存在；若缺失，按「快速开始」中的排错步骤手动补齐 `dist/`、`path.txt` 与 `version` 三个部分（`version` 内容需与 `node_modules/electron/package.json` 的 `version` 一致，并带 `v` 前缀，如 `v33.4.11`）。

**拖拽时角色在屏幕上「漂移」**

检查是否误把物理像素与 DIP 混用；本项目所有窗口坐标与光标坐标必须保持在同一 DIP 坐标系内计算。

**托盘图标不显示**

确认 `resources/icon.png` 存在。开发模式下图标路径基于 `app.getAppPath()` 解析，打包后需同步调整 `electron-builder` 的 `extraResources` 配置。

## License

待定。

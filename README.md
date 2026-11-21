# 樱羽艾玛小笨狗桌宠

一只常驻 Windows 桌面的二次元 Q 版萌宠。透明置顶、可拖拽、会撒娇，后续还会陪你敲键盘、盯番茄钟。

> 当前状态：**M6 进行中**（Idle 已接入 AI 视频抽帧的逐帧动画，其余状态暂用单张立绘做程序化形变），M5 打包、自启与日志已完成。

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

启动后屏幕左上角会出现四足形态的小笨狗立绘，可以拖拽（松手自动吸附在屏幕内），**右键角色**可开启番茄钟（默认时长或键盘输入 1~999 分钟）、切换 Focus 模式与按键气泡；**按住右键沿左上↔右下对角线拖动**可等比缩放桌宠（0.6~1.6 倍）；右下角托盘图标提供显示/隐藏、置顶开关、开机自启和退出。

Focus 模式下角色会变成「坐在书桌前敲键盘」的样子，右手会跟随你的鼠标在鼠标垫上移动；敲键盘时右上角会短暂显示按键名。

> **首次安装排错**：若 `node_modules/electron/dist/electron.exe` 不存在，说明 Electron 二进制没下载成功。可手动下载 `https://npmmirror.com/mirrors/electron/<版本>/electron-v<版本>-win32-x64.zip`，解压到 `node_modules/electron/dist/`，再在该目录下写入 `path.txt`（内容 `electron.exe`）。详见下文「常见问题」。

## 可用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发模式启动（热更新） |
| `npm run build` | 构建 main / preload / renderer 到 `out/` |
| `npm run preview` | 以生产构建产物启动 |
| `npm run typecheck` | 对 node 端与 web 端分别做 TypeScript 类型检查 |
| `npm run dist` | 构建并打包 Windows x64 安装包到 `release/` |

打包首次运行需要下载 Electron 与 NSIS 工具链，国内建议先设置镜像：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist
```

产物为 `release/SillyPup-0.1.0-x64-setup.exe`：NSIS 安装包，**按用户安装**（默认装到 `%LOCALAPPDATA%\Programs`），不需要管理员权限，安装时可改目录。

## 目录结构

```
SillyPup/
├─ src/
│  ├─ main/                  # 主进程
│  │  ├─ index.ts            # 生命周期、单实例锁、IPC 注册
│  │  ├─ window.ts           # 透明 / 无边框 / 置顶 / 不可聚焦窗口
│  │  ├─ tray.ts             # 托盘菜单
│  │  ├─ interaction.ts      # 光标轮询：穿透切换、点击判定、拖拽、右键
│  │  ├─ hitMask.ts          # alpha 命中掩码存储与窗口内坐标查询
│  │  ├─ contextMenu.ts      # 右键菜单（原生 Menu.popup）
│  │  ├─ pomodoro.ts         # 番茄钟计时（绝对时间戳 + 唤醒校准）
│  │  ├─ bubble.ts           # 番茄钟结束气泡窗口
│  │  ├─ prompt.ts           # 自定义时长输入窗口（1~999 分钟）
│  │  ├─ keyPoller.ts        # 全局按键轮询（差集去重 + 限流）
│  │  ├─ cursorPoller.ts     # 全局光标轮询（Focus 模式鼠标垫映射用）
│  │  ├─ autoLaunch.ts       # 开机自启（HKCU Run 登录项）
│  │  ├─ logger.ts           # 主进程日志（userData/logs/main.log）
│  │  └─ config.ts           # userData 配置读写
│  ├─ preload/               # contextBridge 白名单 API
│  ├─ renderer/              # 渲染层（React）
│  │  ├─ index.html          # 桌宠主页面
│  │  ├─ bubble.html         # 气泡窗口页面
│  │  ├─ prompt.html         # 自定义时长输入窗口页面
│  │  └─ src/
│  │     ├─ animation/       # 动画契约、帧播放器、真素材帧源、clips.json
│  │     ├─ assets/          # 真实立绘与拆件（base/layers/frames）
│  │     ├─ fsm/             # 状态机与迁移表
│  │     ├─ stage/           # Canvas 渲染循环 + Focus 场景
│  │     ├─ bubble.tsx       # 气泡页面入口
│  │     ├─ prompt.tsx       # 自定义时长页面入口
│  │     └─ {main.tsx, App.tsx, index.css}
│  └─ shared/                # 主进程与渲染层共用类型
├─ build/                    # 打包资源：icon.png / icon.ico
├─ resources/icon.png        # 运行时托盘图标
├─ electron-builder.yml      # NSIS 打包配置
├─ electron.vite.config.ts
├─ tsconfig*.json
└─ package.json
```

## 关键设计取舍

- **透明窗口**：`transparent + frame:false + hasShadow:false`，同时 `focusable:false` 避免点桌宠抢走当前程序焦点，`backgroundThrottling:false` 避免窗口失焦后动画降频。
- **拖拽不用 `-webkit-app-region: drag`**：该系统能力会吞掉 `mousedown/mousemove`，导致「点击」与「拖拽」的位移阈值判定失效。改为主进程 60Hz 轮询 `screen.getCursorScreenPoint()` + `koffi` 读取左键状态，再用 `setPosition` 移动窗口。
- **坐标一律使用 DIP**：`screen.getCursorScreenPoint()` 与 `display.workArea` 返回的都是 DIP，混用物理像素会在 125%/150% 缩放下产生拖拽漂移。
- **边界限制用 `workArea` 而非 `bounds`**：`workArea` 已排除任务栏，不会把桌宠藏到任务栏下面导致找不回。
- **全局按键用轮询而非键盘钩子**：`WH_KEYBOARD_LL` 的行为特征与键盘记录器一致，容易触发杀软误报；按 50Hz 轮询 `GetAsyncKeyState` 足以满足「显示按键名」的需求，且不装钩子。用上一帧按下集合做差集，长按不会重复上报；两次气泡至少间隔 40ms，连打不刷屏；自定义时长窗口输入期间暂停轮询，避免把自己的输入弹成气泡。
- **鼠标垫映射**：全局光标先按所在显示器 `workArea` 归一化到 0~1，再映射到鼠标垫内缩后的矩形，天然实现「手不越出垫子」的边缘限位；手部位移用 `1 - exp(-dt/90)` 做帧率无关平滑，60Hz 与 165Hz 手感一致。
- **Focus 模式与状态机正交**：`mode` 只是渲染层的形象开关，切换不产生状态迁移，拖拽/点击等状态逻辑在两种形态下完全共用。
- **命中判定用 alpha 掩码**：窗口常驻 `setIgnoreMouseEvents(true, { forward: true })`，渲染层每 120ms 上报 64×64 降采样掩码与角色包围盒，主进程在 60Hz 轮询中用掩码判断光标是否真的压在角色身上，命中才切回可交互。点角色响应、点空白穿透到下层程序，两者共用同一判定源。
- **番茄钟只认绝对时间戳**：记录 `deadline = Date.now() + 时长`，每秒用 `deadline - Date.now()` 重算，而不是「每秒减一」。系统睡眠期间定时器不走，累加必然偏差；`powerMonitor.resume` 后立刻重算一次，睡眠中跨过 deadline 会直接判定完成。
- **自定义时长用独立输入窗口**：桌宠窗口是 `focusable:false`，原生菜单在该窗口下既不能承载文本输入也不支持键盘操作。因此菜单项「自定义时长…」只负责唤起一个可聚焦的无边框小窗口，用户在窗口内键盘输入 1~999 分钟，确认后写入配置并开始计时。
- **打包与原生模块**：electron-builder + NSIS，按用户安装（`perMachine:false`）避免提权；`koffi` 是原生模块，通过 `asarUnpack` 解包才能 `dlopen`，同时关闭 `npmRebuild`（koffi 自带各平台预编译二进制，不需要 node-gyp）。
- **开机自启按用户维度**：写 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`，不碰机器级注册表。开发模式下注册的是 `electron.exe` 并附带项目路径参数，打包后只注册自身 exe；每次启动按配置重新同步一次，用户手动删掉登录项后会自愈。
- **日志写在用户目录**：桌宠没有控制台窗口，`userData/logs/main.log` 记录启动、番茄钟完成与未捕获异常，超过 1MB 轮转为 `main.old.log`，避免无限增长。
- **一张立绘驱动整套动画**：没有逐帧素材时，`SpriteSource` 会把同一张立绘按各 clip 的形变曲线预渲染成帧——拖拽/落地共用同一张图，形变原点固定在脚底，缩放时不会陷进地面。
- **逐帧素材优先**：`assets/frames/<clipId>/` 下存在 PNG 序列时直接按文件顺序播放（Idle 为 43 帧 / 19.2fps，即原视频 0.8 倍速，含眨眼），不再叠加程序化形变，避免和视频里的呼吸动作重复；删掉目录即可回落到单张立绘方案。
- **右键拖拽缩放**：右键按下后不立即弹菜单，沿 (1,1) 对角线移动超过 6px 才进入缩放，向左上缩小、向右下放大；缩放时保持「脚底中心」不动，窗口边长直接取整后同步给渲染层，画布与命中掩码一起放大，避免出现点击区域和角色错位。

更完整的架构、状态机、素材管线与风险清单见 [技术方案](桌宠项目-技术方案.md)。

## 开发路线图

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| M0 | 透明置顶窗口、托盘、单实例、拖拽与边界限制 | 已完成 |
| M1 | 动画播放器 + 状态机（Idle/Action/Interact/Grabbed/Dragging/Dropped/Land） | 已完成 |
| M2 | alpha 掩码命中判定、点击穿透切换、点击互动与冷却 | 已完成 |
| M3 | 番茄钟、置顶气泡、睡眠唤醒计时校准 | 已完成 |
| M4 | Focus Mode、键盘气泡、鼠标垫映射跟随 | 已完成 |
| M5 | 打包（NSIS）、开机自启、图标、日志 | 已完成 |
| M6 | 正式素材替换、性能打磨 | 进行中 |

## 已知限制

- 仅支持 Windows，未做 macOS / Linux 适配。
- Idle 已使用从 AI 视频抽取的 43 帧逐帧素材（19.2fps，含眨眼，0.8 倍慢放），拖拽/落地等状态仍复用单张立绘做形变，Focus 模式是程序化占位场景，尚未替换素材。
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

确认 `resources/icon.png` 存在。开发模式下图标路径基于 `app.getAppPath()` 解析；打包后改用 `process.resourcesPath/resources/icon.png`，对应 `electron-builder.yml` 的 `extraResources`。

**安装包提示「Windows 已保护你的电脑」**

当前安装包未做代码签名，SmartScreen 会对未知发布者拦截。点「更多信息 → 仍要运行」即可；正式发布前需购买证书并配置 electron-builder 的签名。

**运行出了问题去哪里看日志**

`%APPDATA%\silly-pup\logs\main.log`（打包版与开发版共用同一个 userData）。旧日志在同目录的 `main.old.log`。

## License

待定。

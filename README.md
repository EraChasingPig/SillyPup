# 樱羽艾玛小笨狗桌宠

一只常驻 Windows 桌面的二次元 Q 版萌宠。透明置顶、可拖拽、会撒娇，会自己散步、跳台阶，也会追着你鼠标下的苹果跑。

> 当前状态：**0.2.0**。待机、日常动作、左右行走、上下跳跃、坐姿、写作业、睡眠与「找苹果」均已接入逐帧素材；Focus 模式已从菜单下线，相关代码保留但不再启用。

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

启动后屏幕左上角会出现四足形态的小笨狗立绘，可以拖拽（松手自动吸附在屏幕内）。**右键角色**可开始/停止番茄钟（支持自定义 1~999 分钟）、召唤苹果、切换按键气泡与状态标注（状态标注默认隐藏）；**按住右键沿左上↔右下对角线拖动**可等比缩放桌宠（0.6~1.6 倍）。

托盘菜单提供显示/隐藏、始终置顶、开机自启、向左/向右走、停下、向上/向下跳一层和退出。召唤苹果后，小苹果会跟随鼠标，小狗自动规划横走与竖跳靠近，到点后坐下吃掉；一轮未结束时「获得苹果」置灰，番茄钟开始或拖拽小狗会立即中断本轮。

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

产物为 `release/SillyPup-0.2.0-x64-setup.exe`：NSIS 安装包，**按用户安装**（默认装到 `%LOCALAPPDATA%\Programs`），不需要管理员权限，安装时可改目录。因内置约 3450 张逐帧 PNG，安装包体积约 300 MB。

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
│  │  ├─ cursorPoller.ts     # 全局光标轮询（Focus 模式遗留，当前未启用）
│  │  ├─ appleWindow.ts      # 苹果窗：跟随光标 / 到达钉住 / 淡入淡出
│  │  ├─ jumpMover.ts        # 跳跃垂直位移（按腾空区间搬窗口）
│  │  ├─ autoLaunch.ts       # 开机自启（HKCU Run 登录项）
│  │  ├─ logger.ts           # 主进程日志（userData/logs/main.log）
│  │  └─ config.ts           # userData 配置读写
│  ├─ preload/               # contextBridge 白名单 API
│  ├─ renderer/              # 渲染层（React）
│  │  ├─ index.html          # 桌宠主页面
│  │  ├─ bubble.html         # 气泡窗口页面
│  │  ├─ prompt.html         # 自定义时长输入窗口页面
│  │  ├─ apple.html          # 苹果窗页面
│  │  └─ src/
│  │     ├─ animation/       # 动画契约、帧播放器、真素材帧源、clips.json
│  │     ├─ assets/          # 真实立绘、拆件与道具（base/layers/frames/apple.png）
│  │     ├─ fsm/             # 状态机与迁移表
│  │     ├─ stage/           # Canvas 渲染循环、动作编排、Focus 场景（遗留）
│  │     ├─ bubble.tsx       # 气泡页面入口
│  │     ├─ prompt.tsx       # 自定义时长页面入口
│  │     ├─ apple.tsx        # 苹果窗入口
│  │     └─ {main.tsx, App.tsx, index.css, apple.css}
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
- **找苹果是演出式寻路**：苹果窗独立置顶跟随光标，小狗只做「横向走 + 纵向跳」两轴规划；苹果进入可达带后停止跟随，到点钉在头顶上方，配合坐姿与进食动画完成一轮。
- **`jump_loop` 可循环串联**：竖直距离远时连续播放循环段，只在首尾付 `jump_prepare` / `jump_land`，每圈约 4 秒前进 3 跳；日常跳与托盘跳仍只播一圈。
- **睡眠按真实操作计时**：只有点击、拖拽、托盘指令、番茄钟与召唤苹果会重置静置计时，自主动作不再续命；无操作 5 分钟入睡，睡满 5 分钟自动起床。
- **命中判定用 alpha 掩码**：窗口常驻 `setIgnoreMouseEvents(true, { forward: true })`，渲染层每 120ms 上报 64×64 降采样掩码与角色包围盒，主进程在 60Hz 轮询中用掩码判断光标是否真的压在角色身上，命中才切回可交互。点角色响应、点空白穿透到下层程序，两者共用同一判定源。
- **番茄钟只认绝对时间戳**：记录 `deadline = Date.now() + 时长`，每秒用 `deadline - Date.now()` 重算，而不是「每秒减一」。系统睡眠期间定时器不走，累加必然偏差；`powerMonitor.resume` 后立刻重算一次，睡眠中跨过 deadline 会直接判定完成。
- **自定义时长用独立输入窗口**：桌宠窗口是 `focusable:false`，原生菜单在该窗口下既不能承载文本输入也不支持键盘操作。因此菜单项「自定义时长…」只负责唤起一个可聚焦的无边框小窗口，用户在窗口内键盘输入 1~999 分钟，确认后写入配置并开始计时。
- **打包与原生模块**：electron-builder + NSIS，按用户安装（`perMachine:false`）避免提权；`koffi` 是原生模块，通过 `asarUnpack` 解包才能 `dlopen`，同时关闭 `npmRebuild`（koffi 自带各平台预编译二进制，不需要 node-gyp）。
- **开机自启按用户维度**：写 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`，不碰机器级注册表。开发模式下注册的是 `electron.exe` 并附带项目路径参数，打包后只注册自身 exe；每次启动按配置重新同步一次，用户手动删掉登录项后会自愈。
- **日志写在用户目录**：桌宠没有控制台窗口，`userData/logs/main.log` 记录启动、番茄钟完成与未捕获异常，超过 1MB 轮转为 `main.old.log`，避免无限增长。
- **一张立绘驱动整套动画**：没有逐帧素材时，`SpriteSource` 会把同一张立绘按各 clip 的形变曲线预渲染成帧——拖拽/落地共用同一张图，形变原点固定在脚底，缩放时不会陷进地面。
- **逐帧素材优先**：`assets/frames/<clipId>/` 下存在 PNG 序列时直接按文件顺序播放（Idle 为 43 帧 / 19.2fps，即原视频 0.8 倍速，含眨眼），不再叠加程序化形变，避免和视频里的呼吸动作重复；删掉目录即可回落到单张立绘方案。
- **日常动作随机池**：待机超时与左键点击共用同一套动作池（摇尾巴 / 伸懒腰 / 好奇歪头 / 打哈欠，各 97 帧 / 24fps、单次播放），随机挑选且不与上一次重复；动作播完由 `ANIM_END` 回到 Idle，播放期间忽略点击，避免 4 秒动作被半途打断重新起播。
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
| M6 | 正式素材替换（待机/日常/行走/跳跃/坐姿/作业/睡眠） | 已完成 |
| M7 | 自由移动：左右行走、上下跳跃、找苹果 | 已完成 |
| M8 | WASD 主动控制、斜向移动、多显示器 | 规划中 |

## 桌宠移动与找苹果（已接入）

移动由**原子动作**拼接：横向 `walk_start → walk_loop → walk_turn/stop`，纵向 `jump_prepare → jump_loop → jump_land`，不再为每一种「走多远」单独出素材。

### 已接入

- **左右行走**：托盘「向左走 / 向右走 / 停下」；主进程 60Hz 平移窗口，走到工作区边缘时位置被钳制，动画继续播放（顶墙走）。
- **上下跳跃**：托盘「向上跳一层 / 向下跳一层」；`jump_loop` 每圈 3 跳，向上每跳 60 DIP、向下 40 DIP，贴边时按方向钳制。
- **跳跃串联**：找苹果时竖直距离远会连续播放 `jump_loop`，只在首尾播放 `jump_prepare` / `jump_land`，避免每圈多花约 8 秒。
- **找苹果**：右键「获得苹果」→ 苹果跟随鼠标 → 小狗按「先横走对齐、再竖跳接近」规划 → 到点后苹果钉在头顶、播 `sit_enter` 与 `sit_eat_happy`；120 秒未达自动放弃，番茄钟开始或拖拽立即中断，本轮未结束时菜单置灰。

### 尚未实现

- WASD 主动控制（窗口 `focusable:false`，只能全局轮询；需配合模式开关，避免任何输入框打字都触发移动）。
- 真正的斜向/楼梯素材（当前只有横走与上下跳两轴）。
- 多显示器寻路与屏幕边缘折返策略。
- 障碍物/窗口碰撞：桌宠永远置顶，不存在真实可行路线，寻路本质是演出。

## 已知限制

- 仅支持 Windows，未做 macOS / Linux 适配。
- 动画共约 3450 张逐帧 PNG（待机、日常、行走、跳跃、坐姿、作业、睡眠等），因此安装包约 300 MB。
- 拖拽/落地等少数状态仍复用单张立绘做形变；Focus 模式相关代码保留，但入口已从菜单移除。
- 找苹果只做横走与竖跳两轴规划，没有斜向与障碍物概念。
- 无法捕获以管理员权限运行的前台程序的按键（Windows UIPI 限制，不打算通过提权规避）。

## 文档

- [需求与提问（修改版）](桌宠项目-需求与提问-修改版.md)
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

**右键菜单里为什么没有 Focus 模式了**

Focus 模式已下线，相关代码暂时保留但不再提供入口；旧配置里残留的 `focusMode` 会在启动时强制重置为 `false`。

**运行出了问题去哪里看日志**

`%APPDATA%\silly-pup\logs\main.log`（打包版与开发版共用同一个 userData）。旧日志在同目录的 `main.old.log`。

## License

待定。

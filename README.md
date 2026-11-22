# 星语猫娘 Neko · 分层微动版

A 53-layer split-sprite catgirl desktop pet for Google Antigravity. Unofficial fork.

基于开源项目 [Monokumakuki/Antigravity-Star-Suite](https://github.com/Monokumakuki/Antigravity-Star-Suite)（`star-suite-widget v0.2.14`）深度二次开发的 Windows Electron 桌宠改版：将原版静态单图立绘无损拆分为 **53 层准 Live2D 动态立绘**，新增 **像素级左右耳/呆毛独立按压**、**鼠标侧键双耳控制（零系统钩子）**、**5 种常态耳动波浪**、**AI 工作态星晶薄光边**、**4 套气泡主题**与**伴随 Antigravity 自动启停**。

> **开源与素材权利声明（请务必阅读）**
> - **软件代码**：继承上游 [LICENSE](app/LICENSE)（MIT License，Copyright (c) 2026 Monokumakuki），本仓库二次开发代码同样遵循 MIT。第三方依赖说明见 [NOTICE.md](app/NOTICE.md)。
> - **美术素材**：详见 [ASSETS.md](app/ASSETS.md)。软件 MIT 许可**不适用于角色立绘图片与第三方标识**；角色设计参考署名 **ZipZipPipe**。角色图层使用已获原作者 Monokumakuki 许可（2026-11-22），仅用于本项目非商用展示与运行，不授予独立再许可。**如任何权利人对图片展示或包含存在异议，请通过本仓库 Issues 联系，将立即下架或调整。**
> - **音效素材**：本公开版仅保留上游可记录许可的 4 套 CC0 / MIT 安全音色（已移除全部第三方游戏/未验证授权音频）；用户可在设置面板中自行导入本地 `.wav / .mp3 / .ogg / .m4a` 音频。

---

## 效果预览

| 左右耳 & 呆毛独立按压 / 侧键双耳齐压 | 53 层常态耳动波浪 & AI 工作态星晶光边 | 本体联动气泡 / 4 套主题 / 单轮 Token 播报 |
| :---: | :---: | :---: |
| ![左右耳与呆毛独立按压及侧键控耳](docs/media/01-ear-ahoge-side-buttons.gif) | ![53层常态耳动波浪与工作态星晶光边](docs/media/02-idle-ear-wave-star-glow.gif) | ![点击本体联动气泡与四套主题](docs/media/03-body-bubble-themes-tokens.gif) |

---

## 主要功能

### 1. 53 层无损动态立绘与状态特效
- **原画零改动**：`frames/` 原图完整保留，脸部与眼睛零修改，静止叠合像素误差为 `0`。
- **常态 5 种猫耳动作**：每 `7–14s` 随机触发——左耳、右耳、双耳同步，以及 **左耳先下 → 右耳紧跟** / **右耳先下 → 左耳紧跟**（先后间隔 `170–250ms`，单耳下压回弹 `460ms`）；左右耳下小发包（`bunL/bunR`）全程 Q 弹同步跟随。
- **呆毛、发梢与眨眼**：头顶呆毛每 `3.5–6.5s` 慢速轻晃；右下贴底长发丝每 `5–9s` 纯水平微风轻摆（底边贴紧不露平切口）；每 `3.2–7s` 自动眨眼 `150ms`。
- **脸颊微醺腮红**：按压本体、独立戳/长按耳与呆毛、摸摸头、触发彩蛋或对话完成时，浅蜜桃双斜杠腮红以 `1.8s → 2.0s → 2.4s` 慢速升温淡退。
- **AI 工作态星晶薄光边**：通过 CDP 每 `500ms` 监测宿主取消按钮状态，仅 AI 真正工作期间 `1.4s` 缓亮贴边薄光边与头/胸饰星辉并常亮，结束后 `1.6s` 缓灭。

### 2. 鼠标交互拆分（本体 / 耳朵与呆毛 / 侧键 / 气泡 / 滚轮）

| 区域 | 动作 | 效果 |
|---|---|---|
| **左右耳（左键）** | 单击 / 长按 | `137×115` 像素级命中图（扣除头部与小发包前景，兼容左右镜像）；仅对应单耳（带同侧小发包）压至 `step=8`、长按保持、松手回弹；**不压扁本体、不拖拽、不弹气泡** |
| **呆毛（左键）** | 单击 / 长按 | 仅呆毛独立压下（`-28° / dy +3.0% / scaleY 0.82`），长按保持、松手阻尼弹性回摆；**不触发本体与气泡** |
| **悬停猫娘（侧键）** | **前侧键 / 后侧键** | **前侧键（`button=4`）→ 视觉左耳、后侧键（`button=3`）→ 视觉右耳**（自动适配左右翻转），支持单按、长按与**双侧键齐按双耳同时下压**；仅走桌宠自身窗口事件，无任何全局系统钩子，切去游戏自动隐藏、不影响游戏 |
| **猫娘本体（不含耳/呆毛）** | 左键单击 | 气泡关闭时：压扁回弹 → **从小到大逐级弹出「Gemini 额度」气泡**并即时刷新；气泡开启时：**不切页**，猫娘与气泡同步压扁 Q 弹并重置自动收起计时 |
| **猫娘本体** | 拖拽 / 快速划过 | 窗口内自由拖动 + 贴边吸附 + 自动翻转朝向；非按压连续划过触发「摸摸头」动画与腮红 |
| **头顶气泡** | 悬停 / 左键单击 | 悬停暂停自动收起；单击在 **「Gemini 额度」→「喵言喵语」随机台词 → 从大到小逐级收起** 间流转 |
| **全局命中区** | 滚轮 / 右键 / 快捷键 | 滚轮切页或缩放（`140–360px`）；右键打开快捷菜单；`Ctrl+Alt+G` 唤回、`Ctrl+Alt+Shift+G` 关闭鼠标穿透并唤回 |

### 3. 额度读取、Token 播报与主题设置
- **实时 Gemini 额度**：经本机 CDP 拉取 5 小时与 1 周剩余百分比并持久化至 `~/.antigravity-cat-widget/quota-cache.json`，支持低额度预警与手动记录覆盖。
- **单轮 Token 播报与等待提醒**：监听 Antigravity 本地会话日志，单轮对话完成时庆祝跳并播报整轮总输入/输出/缓存 Token 与步数；检测到 `ask_question` 自动弹出「等待你的确认」提醒。
- **4 套气泡主题 & 设置面板**：星晶蓝紫（默认）/ 经典蓝白 / 樱粉浅暖 / 星空暗夜；支持自定义闲聊台词、独立提示音与本地音频导入、设置一键撤回。
- **无皮肤无托盘 + 伴随启停**：原生 Win32 追踪器 `ForegroundHost.cs` 消除切换闪烁；「贴边跟随」为硬依赖，缺少 `ForegroundHost.exe` 时会弹窗提示原因并直接退出（不会静默降级为普通桌面桌宠）。

---

## 安装与运行（Windows 10 / 11）

> 仓库内**不含任何预编译 `.exe`**，脚本会直接调用 Windows 自带的 `.NET Framework 4 csc.exe` 在本机 1 秒编译，无需额外安装 Visual Studio 或 .NET SDK。

### AI 一键安装（推荐）

本仓库根目录内置了给 AI Agent 使用的标准化安装规程 [AGENTS.md](AGENTS.md)（包含环境自检、硬依赖校验、国内镜像安装、禁止误覆盖原版与逐项验收步骤）。

把仓库下载到本地后，直接打开你的 AI 编程工具（如 Antigravity / Claude Code / Codex 等），发送一句：

> 请阅读仓库根目录的 `AGENTS.md`，严格按规程帮我安装并验收这个桌宠。

### 手动安装

在项目根目录打开 PowerShell：

```powershell
# 推荐：安装独立版（自动编译原生助手 + 自动配置国内 Electron 镜像，不碰原版）
powershell -ExecutionPolicy Bypass -File ".\一键安装并启动.ps1" -Standalone

# 如需替换本机已安装的原版 AntigravityStarSuite（必须显式传 -Force，覆盖前自动备份为 app.bak-<时间戳>）
powershell -ExecutionPolicy Bypass -File ".\一键安装并启动.ps1" -Force
```

> 说明：
> - 若本机已安装原版 `AntigravityStarSuite`，直接运行不带参数的 `一键安装并启动.ps1` 会拒绝覆盖并提示你在 `-Standalone` 与 `-Force` 之间二选一；
> - 独立模式需要 Node.js `>=18`，脚本会自动设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`（若你已自定义则保留你的值），失败后自动清缓存并切 `https://registry.npmmirror.com` 重试一次；
> - 也可分步手动执行：`powershell -ExecutionPolicy Bypass -File ".\编译原生助手.ps1"` → `cd app` → `npm install` → `npm start`。

### 启用实时 Gemini 额度 & AI 工作态星晶光边（重要）

实时额度与工作态薄光边依赖 Antigravity 的本机调试端口文件（`%APPDATA%\Antigravity\DevToolsActivePort`）：
- **方式 1（推荐，同时获得伴随启停）**：运行完上面脚本后，以后直接双击编译生成的 `LaunchAntigravityWithWidget.exe` 打开 Antigravity（会自动寻找本机 `Antigravity.exe`、附带 `--remote-debugging-port=0` 启动，并在关闭 Antigravity 后自动退出桌宠；如装在特殊路径，可设环境变量 `ANTIGRAVITY_EXE` 指定）。
- **方式 2（手动加启动参数）**：右键你的 `Antigravity` 快捷方式 → 属性 → 在「目标」末尾加空格和 `--remote-debugging-port=0`。
- 若不加该参数，贴边跟随、53 层动效、耳/呆毛/侧键交互与日志 Token 播报仍全部正常工作，仅 5 小时/1 周实时额度会显示 `—`（可在设置面板开启手动额度记录）。

> 注：本改版默认移除了系统托盘并固定 `hostWindowOnly: true`，贴边跟随依赖 `ForegroundHost.exe`（缺少时启动会弹出原生错误框并退出，不会降级为普通桌面桌宠）。本版固定为"跟随宿主窗口"模式，不提供关闭开关。

## English

An unofficial 53-layer split-sprite fork of
[Monokumakuki/Antigravity-Star-Suite](https://github.com/Monokumakuki/Antigravity-Star-Suite):
per-part hit testing for ears and ahoge, mouse side-button control, and host-window following.

- **Requirements**: Windows 10/11 x64, Node.js ≥ 18 (standalone mode), .NET Framework 4 (built into Windows).
- **Quick start**: `powershell -ExecutionPolicy Bypass -File ".\一键安装并启动.ps1" -Standalone`
- **License**: code is MIT; character art is **not** MIT and is used with the original author's permission, non-commercial only.

AI agents: read [`AGENTS.md`](AGENTS.md) and follow it step by step.

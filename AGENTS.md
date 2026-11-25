# AGENTS.md — 安装规程（给 AI agent 读）

> 你是替用户执行安装的 AI agent。**按本文逐步执行，每一步都贴真实命令输出**。
> 禁止只回「已完成 / 已修复 / 已优化」而不附输出——那等于没做。
> 用户的电脑可能没有 Node、没有 IDE、没有耐心。你的任务是让它在**不问你二十个问题**的前提下跑起来。

---

## 0. 先看清这件事的性质

- 这是一个 **Windows Electron 桌宠**，固定在 Antigravity 窗口旁边并**跟随宿主移动**。
- 它有两个硬依赖，缺一个就是安装失败：

| 依赖 | 用来做什么 | 缺了会怎样 |
|---|---|---|
| `csc.exe`（.NET Framework 4，Win10 2004+/Win11 自带） | 编译 `ForegroundHost.exe` | **没有贴边跟随 = 功能不成立** |
| Electron（`app\node_modules`） | 渲染界面 | 起不来 |

- **「贴边跟随」是硬需求。** 如果编译失败，**停下来报告并给出解法**，不要把它装成「普通桌面桌宠」糊弄用户。用户不接受降级。
- 宿主 Antigravity 应已在运行。额度显示需要 CDP 端口（见 §5），跟随不需要。

---

## 1. 环境自检（只读，不改任何东西）

一次性执行，把输出贴出来：

```powershell
"--- OS ---"
[Environment]::Is64BitOperatingSystem
(Get-CimInstance Win32_OperatingSystem).Caption

"--- PowerShell ---"
$PSVersionTable.PSVersion.ToString()

"--- Node ---"
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) { node -v; npm -v } else { "node: NOT FOUND" }

"--- csc (.NET Framework 4) ---"
$csc1 = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$csc2 = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
"Framework64: $(Test-Path -LiteralPath $csc1)"
"Framework  : $(Test-Path -LiteralPath $csc2)"

"--- Antigravity 宿主 ---"
Get-ChildItem "$env:LOCALAPPDATA\Programs" -Recurse -Depth 3 -Filter 'Antigravity.exe' -ErrorAction SilentlyContinue |
  Select-Object -First 3 FullName
Get-Process Antigravity -ErrorAction SilentlyContinue | Select-Object -First 1 Id, MainWindowTitle

"--- CDP 端口文件 ---"
Test-Path -LiteralPath "$env:APPDATA\Antigravity\DevToolsActivePort"

"--- 是否装过原版 Star Suite ---"
Test-Path -LiteralPath "$env:LOCALAPPDATA\Programs\AntigravityStarSuite\Widget\StarWidget.exe"
```

### 判定与处理

| 结果 | 处理 |
|---|---|
| `csc` 两行都是 `False` | **停下**，让用户装 .NET Framework 4.8（Win10/11 一般自带，若确实没有：`winget install Microsoft.DotNet.Framework.DeveloperPack_4`），装完重跑自检 |
| `node: NOT FOUND` | `winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements`，然后**新开一个 shell** 再验（PATH 要重载） |
| 找不到 Antigravity.exe | 问用户装在哪，让他给路径；后续用 `$env:ANTIGRAVITY_EXE` 指过去 |
| **`是否装过原版 = True`** | **立刻停下问用户**，见 §7 禁止事项第 1 条。不许自动覆盖 |
| CDP 文件不存在 | 不影响安装；最后提示用户，见 §5 |

---

## 2. 编译原生助手（硬步骤，失败即中止）

```powershell
cd <仓库根目录>
powershell -ExecutionPolicy Bypass -File ".\编译原生助手.ps1"
```

**期望输出**（必须真的出现）：

```
编译完成：ForegroundHost.exe、LaunchAntigravityWithWidget.exe 与进程图标签名工具已生成。
```

**独立复核**（不要只信上面那句话）：

```powershell
Test-Path -LiteralPath ".\app\Antigravity-Cat-Widget\src\native\ForegroundHost.exe"
Test-Path -LiteralPath ".\LaunchAntigravityWithWidget.exe"
```

两个都必须是 `True`。

### 编译失败的分支

| 现象 | 原因 | 处理 |
|---|---|---|
| `未找到 .NET Framework 4 csc.exe` | 系统缺 .NET 4 | 装 .NET 4.8 后重试 |
| `CS...` 编译错误 | 源码被改坏 | **停下报告**，不要自己改 C# 源码猜 |
| 静默失败 / exe 没生成 | 杀软拦截了 csc 写文件 | 让用户把仓库目录加入 Defender 排除项，或临时关闭实时保护，重试 |
| `拒绝访问` | 文件被占用 | `Get-Process ForegroundHost -ErrorAction SilentlyContinue` 结束后重试 |

**编译不过 = 安装失败。不要跳到第 3 步假装装好了。**

---

## 3. 安装 Electron 依赖

```powershell
cd <仓库根目录>\app
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"   # 国内必加，否则极易超时
npm install
```

**复核**：

```powershell
Test-Path -LiteralPath ".\node_modules\electron\dist\electron.exe"
```

`True` 才算成功。失败处理：

1. 清缓存重试：`npm cache clean --force`，再 `npm install`
2. 换源重试：`npm config set registry https://registry.npmmirror.com`
3. 两次都失败 → **停下报告完整报错**，不要无限重试

> 不需要 `npm install` 的例外：若用户已安装带 `resources/app` 的原版壳子，可走壳子路径——但**必须先获得用户同意**（见 §7）。

---

## 4. 启动

**默认走独立模式**（不碰用户已安装的任何东西）：

```powershell
cd <仓库根目录>
powershell -ExecutionPolicy Bypass -File ".\一键安装并启动.ps1" -Standalone
```

> ⚠️ **不要**去掉 `-Standalone`。不带这个开关时脚本会检测并**覆盖**用户已安装的原版 Star Suite。

启动后等 3 秒，再进 §6 验收。

---

## 5. 让宿主带上 CDP 端口（仅额度功能需要）

「实时额度 + 工作态星晶光边」依赖 Antigravity 的调试端口。两条路，任选其一并告知用户：

**A. 用随包启动器**（会带 `--remote-debugging-port=0` 启动宿主）：

```powershell
Start-Process -FilePath ".\LaunchAntigravityWithWidget.exe"
```

**B. 手动加参数**：宿主快捷方式 → 属性 → 目标末尾加 ` --remote-debugging-port=0`，重启宿主。

**这不是安装失败的判定条件。** 没有 CDP 时，贴边跟随、53 层动画、耳朵交互、点戳气泡全部正常，只是额度显示「未知」。要在报告里说清这一点，别让用户以为装坏了。

---

## 6. 验收（四项，逐项贴证据）

```powershell
"1) 进程"
Get-Process electron, StarWidget, ForegroundHost -ErrorAction SilentlyContinue |
  Select-Object Name, Id, MainWindowHandle, MainWindowTitle | Format-Table -AutoSize

"2) 窗口可见"
Get-Process electron -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object Id, MainWindowHandle

"3) CDP"
$p = "$env:APPDATA\Antigravity\DevToolsActivePort"
if (Test-Path -LiteralPath $p) { Get-Content -LiteralPath $p } else { "CDP: 未启用（额度不可用，其余功能不受影响）" }
```

- **[1] 进程**：必须能看到桌宠进程（独立模式是 `electron`，壳子模式是 `StarWidget`）。`ForegroundHost` 也应存在——**它是贴边跟随的执行者，缺了就是没装好**。
- **[2] 窗口**：`MainWindowHandle` 非 0，并且**截一张全屏图**，确认猫娘真的显示在屏幕上（不要只看进程在就宣布成功）。
- **[3] CDP**：能读到端口 / 或用 `Invoke-RestMethod http://127.0.0.1:<端口>/json/version` 返回带 `Browser` 的 JSON 才叫通。
- **[4] 贴边跟随（必须让用户确认）**：请用户把 Antigravity 窗口拖到屏幕左侧再拖回右侧，问一句「猫娘有没有跟着贴在窗口边上」。这是唯一无法脚本化验证的一项，**必须问到答案才能收尾**。

---

## 7. 禁止事项（违反即视为安装失败）

1. **绝不覆盖用户已安装的原版**。检测到 `%LOCALAPPDATA%\Programs\AntigravityStarSuite\Widget\StarWidget.exe` 存在时：停下来问「想装成独立版（不动原版），还是替换原版？」。用户选替换，才允许走非 `-Standalone` 路径，并且**先把原目录备份成 `.bak`**。
2. **不要按名字批量杀进程**。只结束你自己刚启动、且记录了 PID 的进程。`Stop-Process -Name StarWidget` 这类命令不许执行。
3. **不要改 Antigravity 的安装目录、`app.asar`、注册表自启动项。**
4. **不要为了「让它跑起来」而删减文件**：图片、ASSETS、LICENSE、NOTICE 一个都不能少。
5. **不要降级交付**。编译不过就说编译不过，不许装成普通桌宠然后说「安装成功」。
6. **不要上传/外发用户的任何文件**，不要打印用户路径以外的个人信息。
7. 需要重启宿主时，**把这一步放到最后单独告知**——重启会中断当前对话。

---

## 8. 故障速查

| 现象 | 最可能的原因 | 处理 |
|---|---|---|
| 猫娘完全不见 | `ForegroundHost.exe` 不存在，跟随逻辑空转 | 回 §2 重新编译；并检查杀软是否把它删了 |
| 猫娘出现但不跟随 | 宿主被最小化 / 在另一个虚拟桌面 / 多屏坐标异常 | 让宿主窗口在前台可见，再测一次 |
| 额度一直是「未知」 | 宿主没带 `--remote-debugging-port=0` | 走 §5 |
| 启动闪退 | Electron 版本与系统不匹配 / 缺 VC++ 运行库 | 看 `npm start` 的 stderr，贴完整报错 |
| `npm install` 卡在 electron 下载 | 没用镜像 | 回 §3 |
| 设置页打不开 | 独立模式下窗口被关掉了 | 重新执行 §4；或用托盘/`Ctrl+Alt+G` 唤回 |

---

## 9. 收尾报告格式（必须按这个写）

```
环境：Win <版本> / Node <版本> / csc ✅
编译：ForegroundHost.exe ✅  LaunchAntigravityWithWidget.exe ✅
依赖：electron ✅
启动：<进程名> PID <id>，窗口句柄 <handle>
额度：<可用 / 未启用，原因>
跟随：用户确认 <是/否>
未做：<你跳过的步骤，以及为什么>
```

**只要有任何一项是 ❌，报告第一句就必须是「安装未完成」，而不是「已安装」。**

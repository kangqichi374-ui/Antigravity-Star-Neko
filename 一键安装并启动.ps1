param(
    [switch]$Standalone,
    [switch]$Force,
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$appDir = Join-Path $root "app"

$suiteWidgetDir = Join-Path $env:LOCALAPPDATA "Programs\AntigravityStarSuite\Widget"
$suiteExe = Join-Path $suiteWidgetDir "StarWidget.exe"
$hasSuite = Test-Path -LiteralPath $suiteExe

# 任务 2：检测到已安装原版且未传 -Standalone / -Force，立即拒绝并给出明确两条路
if ((-not $Standalone) -and $hasSuite -and (-not $Force)) {
    Write-Host ""
    Write-Host "错误：检测到本机已安装原版 AntigravityStarSuite（$suiteExe）。" -ForegroundColor Red
    Write-Host "为避免误覆盖原版，未传 -Force 时已自动中止，原目录未被修改。" -ForegroundColor Red
    Write-Host ""
    Write-Host "请按你的需要选择其中一条路重新运行：" -ForegroundColor Yellow
    Write-Host "  1) 加 -Standalone 装独立版（不动原版，推荐）：" -ForegroundColor Cyan
    Write-Host "     powershell -ExecutionPolicy Bypass -File `".\一键安装并启动.ps1`" -Standalone"
    Write-Host "  2) 加 -Force 替换原版（覆盖前会自动备份原 resources\app 为 app.bak-<时间戳>）：" -ForegroundColor Cyan
    Write-Host "     powershell -ExecutionPolicy Bypass -File `".\一键安装并启动.ps1`" -Force"
    Write-Host ""
    exit 1
}

# 任务 3：硬依赖编译（fail-fast，编译失败立刻中止，不继续装 Electron）
Write-Host "[1/3] 编译原生窗口追踪与伴随启停助手..." -ForegroundColor Cyan
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& (Join-Path $root "编译原生助手.ps1")
$buildCode = $LASTEXITCODE
$ErrorActionPreference = $prevEap

$fgExe = Join-Path $appDir "Antigravity-Cat-Widget\src\native\ForegroundHost.exe"
if (($buildCode -ne 0) -or (-not (Test-Path -LiteralPath $fgExe))) {
    Write-Host "原生助手编译失败（退出码 $buildCode），已中止安装：不会继续安装 Electron，也不会降级为普通桌面桌宠。" -ForegroundColor Red
    exit 1
}

$useSuite = (-not $Standalone) -and $hasSuite -and $Force

if ($useSuite) {
    Write-Host "[2/3] 已指定 -Force，准备备份并替换原版 AntigravityStarSuite..." -ForegroundColor Cyan

    # 仅按目标安装目录路径匹配并结束进程，不按进程名批量杀
    $normDir = ([System.IO.Path]::GetFullPath($suiteWidgetDir)).TrimEnd('\') + '\'
    $targetProcs = @(Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($normDir, [System.StringComparison]::OrdinalIgnoreCase)
    })
    foreach ($tp in $targetProcs) {
        Write-Host "  结束目标目录进程：$($tp.Name) (PID $($tp.ProcessId))" -ForegroundColor DarkGray
        try {
            Stop-Process -Id $tp.ProcessId -Force -ErrorAction Stop
        } catch {
            # 进程可能已退出
        }
    }
    if ($targetProcs.Count -gt 0) {
        Start-Sleep -Milliseconds 400
    }

    # 覆盖前强制备份 Widget\resources\app -> app.bak-<yyyyMMdd-HHmmss>，备份失败立即中止
    $dstResources = Join-Path $suiteWidgetDir "resources"
    $dstApp = Join-Path $dstResources "app"
    if (Test-Path -LiteralPath $dstApp) {
        $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $backupDir = Join-Path $dstResources ("app.bak-" + $stamp)
        Write-Host "  备份原版 app 至：$backupDir" -ForegroundColor Cyan
        try {
            Copy-Item -LiteralPath $dstApp -Destination $backupDir -Recurse -Force -ErrorAction Stop
        } catch {
            Write-Host "错误：备份原版目录失败（$backupDir），已中止替换以保护原版：$($_.Exception.Message)" -ForegroundColor Red
            exit 1
        }
        if (-not (Test-Path -LiteralPath $backupDir)) {
            Write-Host "错误：备份目录验证失败（未找到 $backupDir），已中止替换以保护原版。" -ForegroundColor Red
            exit 1
        }
        Remove-Item -LiteralPath $dstApp -Recurse -Force
    }
    if (-not (Test-Path -LiteralPath $dstApp)) {
        New-Item -ItemType Directory -Path $dstApp -Force | Out-Null
    }

    Get-ChildItem -LiteralPath $appDir | Where-Object { $_.Name -ne "node_modules" } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $dstApp -Recurse -Force
    }
    foreach ($helper in @("LaunchAntigravityWithWidget.cs", "LaunchAntigravityWithWidget.exe")) {
        $srcHelper = Join-Path $root $helper
        if (Test-Path -LiteralPath $srcHelper) {
            try {
                Copy-Item -LiteralPath $srcHelper -Destination $suiteWidgetDir -Force -ErrorAction Stop
            } catch {
                # 守护进程运行中时跳过覆盖 exe，不影响替换
            }
        }
    }

    if (-not $NoStart) {
        Write-Host "[3/3] 正在静默启动 StarWidget..." -ForegroundColor Cyan
        $null = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
            CommandLine = "`"$suiteExe`" --background"
            CurrentDirectory = $suiteWidgetDir
        }
    }
    Write-Host "完成！已备份并替换原版至 $suiteWidgetDir" -ForegroundColor Green
} else {
    Write-Host "[2/3] 独立模式：检查本地 Electron 运行时..." -ForegroundColor Cyan
    $electronExe = Join-Path $appDir "node_modules\electron\dist\electron.exe"
    if (-not (Test-Path -LiteralPath $electronExe)) {
        $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
        if (-not $npmCmd) {
            Write-Host "错误：未检测到 Node.js / npm。请先安装 Node.js（>=18，推荐 LTS）后重新运行。" -ForegroundColor Red
            exit 1
        }

        # 任务 4：默认配置国内 Electron 镜像（若用户已设置则尊重用户值）
        if (-not $env:ELECTRON_MIRROR) {
            $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
        }
        Write-Host "使用 ELECTRON_MIRROR=$($env:ELECTRON_MIRROR)" -ForegroundColor DarkCyan
        Write-Host "正在 app\ 目录执行 npm install（第 1 次尝试）..." -ForegroundColor Yellow

        $npmOk = $false
        $firstErr = ""
        $secondErr = ""
        Push-Location $appDir
        $prevNpmEap = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $out1 = & npm install 2>&1
            $code1 = $LASTEXITCODE
            $out1 | ForEach-Object { Write-Host $_ }
            if (($code1 -eq 0) -and (Test-Path -LiteralPath $electronExe)) {
                $npmOk = $true
            } else {
                $firstErr = ($out1 | Out-String).Trim()
                Write-Host ""
                Write-Host "第 1 次 npm install 失败（退出码 $code1），正在清缓存并切换国内镜像源（https://registry.npmmirror.com）重试 1 次..." -ForegroundColor Yellow
                $cleanOut = & npm cache clean --force 2>&1
                $cleanOut | ForEach-Object { Write-Host $_ }
                $out2 = & npm install --registry=https://registry.npmmirror.com 2>&1
                $code2 = $LASTEXITCODE
                $out2 | ForEach-Object { Write-Host $_ }
                if (($code2 -eq 0) -and (Test-Path -LiteralPath $electronExe)) {
                    $npmOk = $true
                } else {
                    $secondErr = ($out2 | Out-String).Trim()
                }
            }
        } finally {
            $ErrorActionPreference = $prevNpmEap
            Pop-Location
        }

        if (-not $npmOk) {
            Write-Host ""
            Write-Host "错误：npm install 两次均失败（已清缓存并使用 https://registry.npmmirror.com 重试），已中止安装。" -ForegroundColor Red
            if ($firstErr) {
                Write-Host "=== 第 1 次完整报错 ===" -ForegroundColor DarkYellow
                Write-Host $firstErr
            }
            if ($secondErr) {
                Write-Host "=== 第 2 次（镜像重试）完整报错 ===" -ForegroundColor DarkYellow
                Write-Host $secondErr
            }
            exit 1
        }
    }

    if (-not $NoStart) {
        Write-Host "[3/3] 正在启动独立模式桌宠..." -ForegroundColor Cyan
        $null = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
            CommandLine = "`"$electronExe`" `"$appDir`""
            CurrentDirectory = $appDir
        }
    }
    Write-Host "完成！独立模式桌宠已启动。" -ForegroundColor Green
}

$cdpFile = Join-Path $env:APPDATA "Antigravity\DevToolsActivePort"
if (-not (Test-Path -LiteralPath $cdpFile)) {
    Write-Host ""
    Write-Host "提示：当前未检测到 Antigravity CDP 端口文件（DevToolsActivePort）。" -ForegroundColor Yellow
    Write-Host "如需启用「实时 Gemini 额度读取」与「AI 工作态星晶光边」，请带参数 --remote-debugging-port=0 启动 Antigravity，或直接双击运行同目录编译好的 LaunchAntigravityWithWidget.exe。" -ForegroundColor Yellow
}
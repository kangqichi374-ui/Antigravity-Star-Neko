$ErrorActionPreference = "Stop"

function Fail-Compile {
    param(
        [string]$What,
        [string]$Detail = ""
    )
    Write-Host ""
    Write-Host "【发生了什么】" -ForegroundColor Red
    Write-Host "  $What" -ForegroundColor Red
    if ($Detail) {
        Write-Host "  原始报错：$Detail" -ForegroundColor DarkYellow
    }
    Write-Host ""
    Write-Host "【最可能的三个原因】" -ForegroundColor Yellow
    Write-Host "  1. 系统缺少 .NET Framework 4.x 编译器（csc.exe 不存在）。"
    Write-Host "  2. 杀毒软件 / Windows Defender 拦截了 csc 写文件或秒删了刚生成的 .exe。"
    Write-Host "  3. 目标 .exe（如 ForegroundHost.exe）正在运行导致文件被占用。"
    Write-Host ""
    Write-Host "【分别怎么处理】" -ForegroundColor Cyan
    Write-Host "  1. .NET 4 缺失：安装 .NET Framework 4.8（或运行 winget install Microsoft.DotNet.Framework.DeveloperPack_4），装完重跑脚本。"
    Write-Host "  2. 杀软拦截 csc 写文件：把本仓库目录加入 Windows Defender / 杀软排除项后重试。"
    Write-Host "  3. 文件被占用：先结束正在占用该路径的 ForegroundHost 进程后再重试。"
    Write-Host ""
    exit 1
}

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $csc)) {
    $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path -LiteralPath $csc)) {
    Fail-Compile -What "未找到 .NET Framework 4 编译器（csc.exe），无法编译贴边跟随组件 ForegroundHost.exe。"
}

function Invoke-CscBuild {
    param(
        [string]$TargetType,
        [string]$SrcPath,
        [string]$OutPath,
        [string]$Label
    )
    if (-not (Test-Path -LiteralPath $SrcPath)) {
        Fail-Compile -What "找不到源码文件：$SrcPath"
    }
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $output = ""
    $code = 1
    try {
        $raw = & $csc /nologo "/target:$TargetType" /optimize+ "/out:$OutPath" $SrcPath 2>&1
        $code = $LASTEXITCODE
        $output = ($raw | Out-String).Trim()
    } catch {
        $output = $_.Exception.Message
        $code = 1
    } finally {
        $ErrorActionPreference = $prevEap
    }
    if ($code -ne 0) {
        Fail-Compile -What "编译 $Label 失败（csc 退出码 $code）。" -Detail $output
    }
    if (-not (Test-Path -LiteralPath $OutPath)) {
        Fail-Compile -What "csc 返回成功但未在磁盘检测到生成的 $Label（$OutPath），极可能被杀毒软件静默隔离。" -Detail $output
    }
}

$fgSrc = Join-Path $PSScriptRoot "app\Antigravity-Cat-Widget\src\native\ForegroundHost.cs"
$fgOut = Join-Path $PSScriptRoot "app\Antigravity-Cat-Widget\src\native\ForegroundHost.exe"
Invoke-CscBuild -TargetType "exe" -SrcPath $fgSrc -OutPath $fgOut -Label "ForegroundHost.exe"

$launchSrc = Join-Path $PSScriptRoot "LaunchAntigravityWithWidget.cs"
$launchOut = Join-Path $PSScriptRoot "LaunchAntigravityWithWidget.exe"
if (Test-Path -LiteralPath $launchSrc) {
    Invoke-CscBuild -TargetType "winexe" -SrcPath $launchSrc -OutPath $launchOut -Label "LaunchAntigravityWithWidget.exe"
}

Write-Host "编译完成：ForegroundHost.exe 与 LaunchAntigravityWithWidget.exe 已生成。" -ForegroundColor Green
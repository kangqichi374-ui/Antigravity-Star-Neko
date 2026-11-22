using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using Microsoft.Win32;

internal static class LaunchAntigravityWithWidget {
    private static string QuoteArg(string arg) {
        if (string.IsNullOrEmpty(arg)) return "\"\"";
        bool needsQuotes = false;
        foreach (char c in arg) {
            if (char.IsWhiteSpace(c) || c == '"') { needsQuotes = true; break; }
        }
        if (!needsQuotes) return arg;
        var sb = new StringBuilder();
        sb.Append('"');
        int bs = 0;
        foreach (char c in arg) {
            if (c == '\\') {
                bs++;
            } else if (c == '"') {
                sb.Append('\\', bs * 2 + 1);
                sb.Append('"');
                bs = 0;
            } else {
                if (bs > 0) { sb.Append('\\', bs); bs = 0; }
                sb.Append(c);
            }
        }
        if (bs > 0) sb.Append('\\', bs * 2);
        sb.Append('"');
        return sb.ToString();
    }

    private static string CleanIconPath(string raw) {
        if (string.IsNullOrEmpty(raw)) return null;
        string s = raw.Trim();
        int comma = s.LastIndexOf(',');
        if (comma > 0 && comma > s.Length - 5) s = s.Substring(0, comma);
        return s.Trim().Trim('"');
    }

    private static string FindAntigravityExe() {
        string envPath = Environment.GetEnvironmentVariable("ANTIGRAVITY_EXE");
        if (!string.IsNullOrEmpty(envPath) && File.Exists(envPath)) return envPath;

        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string progFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string progFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);

        var candidates = new List<string>();
        if (!string.IsNullOrEmpty(localAppData)) {
            candidates.Add(Path.Combine(localAppData, "Programs", "antigravity", "Antigravity.exe"));
            candidates.Add(Path.Combine(localAppData, "Programs", "Antigravity", "Antigravity.exe"));
            candidates.Add(Path.Combine(localAppData, "Antigravity", "Antigravity.exe"));
        }
        if (!string.IsNullOrEmpty(progFiles)) {
            candidates.Add(Path.Combine(progFiles, "Antigravity", "Antigravity.exe"));
        }
        if (!string.IsNullOrEmpty(progFilesX86)) {
            candidates.Add(Path.Combine(progFilesX86, "Antigravity", "Antigravity.exe"));
        }

        foreach (string c in candidates) {
            if (File.Exists(c)) return c;
        }

        // Fallback 1: check Uninstall registry entries
        var roots = new[] { Registry.CurrentUser, Registry.LocalMachine };
        var subPaths = new[] {
            @"Software\Microsoft\Windows\CurrentVersion\Uninstall",
            @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
        };
        foreach (var root in roots) {
            foreach (var sub in subPaths) {
                try {
                    using (var key = root.OpenSubKey(sub)) {
                        if (key == null) continue;
                        foreach (string name in key.GetSubKeyNames()) {
                            try {
                                using (var appKey = key.OpenSubKey(name)) {
                                    if (appKey == null) continue;
                                    string display = appKey.GetValue("DisplayName") as string;
                                    if (string.IsNullOrEmpty(display) ||
                                        display.IndexOf("Antigravity", StringComparison.OrdinalIgnoreCase) < 0) {
                                        continue;
                                    }
                                    string icon = CleanIconPath(appKey.GetValue("DisplayIcon") as string);
                                    if (!string.IsNullOrEmpty(icon) &&
                                        icon.EndsWith("Antigravity.exe", StringComparison.OrdinalIgnoreCase) &&
                                        File.Exists(icon)) {
                                        return icon;
                                    }
                                    string loc = appKey.GetValue("InstallLocation") as string;
                                    if (!string.IsNullOrEmpty(loc)) {
                                        string exe = Path.Combine(loc.Trim().Trim('"'), "Antigravity.exe");
                                        if (File.Exists(exe)) return exe;
                                    }
                                }
                            } catch {
                            }
                        }
                    }
                } catch {
                }
            }
        }

        // Fallback 2: inspect currently running Antigravity process
        var procs = Process.GetProcessesByName("Antigravity");
        try {
            foreach (var p in procs) {
                try {
                    string fn = p.MainModule.FileName;
                    if (!string.IsNullOrEmpty(fn) && File.Exists(fn)) return fn;
                } catch {
                }
            }
        } finally {
            foreach (var p in procs) p.Dispose();
        }

        return null;
    }

    private static Process StartClean(string exe, string workDir, string args) {
        if (string.IsNullOrEmpty(exe) || !File.Exists(exe)) return null;
        var psi = new ProcessStartInfo(exe, args) {
            WorkingDirectory = workDir,
            UseShellExecute = false
        };
        psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
        return Process.Start(psi);
    }

    private static bool AnyInSession(string processName, int sessionId) {
        var list = Process.GetProcessesByName(processName);
        try {
            foreach (var p in list) {
                try {
                    if (p.SessionId == sessionId) return true;
                } catch {
                }
            }
            return false;
        } finally {
            foreach (var p in list) p.Dispose();
        }
    }

    private static bool IsPidAlive(int pid) {
        if (pid <= 0) return false;
        try {
            using (var p = Process.GetProcessById(pid)) {
                return !p.HasExited;
            }
        } catch {
            return false;
        }
    }

    private static void StopWidget(string widgetExe, string widgetBaseArgs, bool isStarWidgetExe, int spawnedPid, int sessionId) {
        if (!string.IsNullOrEmpty(widgetExe) && File.Exists(widgetExe)) {
            try {
                string quitArgs = string.IsNullOrEmpty(widgetBaseArgs) ? "--quit" : (widgetBaseArgs + " --quit");
                var psi = new ProcessStartInfo(widgetExe, quitArgs) {
                    WorkingDirectory = Path.GetDirectoryName(widgetExe),
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
                using (var q = Process.Start(psi)) {
                    if (q != null) q.WaitForExit(4000);
                }
            } catch {
            }
        }
        if (isStarWidgetExe) {
            for (int i = 0; i < 10 && AnyInSession("StarWidget", sessionId); i++) {
                Thread.Sleep(250);
            }
            foreach (var name in new[] { "StarWidget", "ForegroundHost" }) {
                var procs = Process.GetProcessesByName(name);
                try {
                    foreach (var p in procs) {
                        try {
                            if (p.SessionId == sessionId) p.Kill();
                        } catch {
                        }
                    }
                } finally {
                    foreach (var p in procs) p.Dispose();
                }
            }
        } else {
            for (int i = 0; i < 10 && IsPidAlive(spawnedPid); i++) {
                Thread.Sleep(250);
            }
            if (IsPidAlive(spawnedPid)) {
                try {
                    using (var p = Process.GetProcessById(spawnedPid)) {
                        p.Kill();
                    }
                } catch {
                }
            }
            var fgProcs = Process.GetProcessesByName("ForegroundHost");
            try {
                foreach (var p in fgProcs) {
                    try {
                        if (p.SessionId == sessionId) p.Kill();
                    } catch {
                    }
                }
            } finally {
                foreach (var p in fgProcs) p.Dispose();
            }
        }
    }

    [STAThread]
    public static void Main(string[] args) {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string agyExe = FindAntigravityExe();

        string widgetExe = Path.Combine(baseDir, "StarWidget.exe");
        string widgetBaseArgs = "";
        string widgetWorkDir = baseDir;
        bool isStarWidgetExe = true;

        if (!File.Exists(widgetExe)) {
            string electronExe = Path.Combine(baseDir, "app", "node_modules", "electron", "dist", "electron.exe");
            string appDir = Path.Combine(baseDir, "app");
            if (File.Exists(electronExe)) {
                widgetExe = electronExe;
                widgetBaseArgs = QuoteArg(appDir);
                widgetWorkDir = appDir;
                isStarWidgetExe = false;
            }
        }

        bool attachOnly = args.Length == 1 && args[0] == "--attach";
        if (!attachOnly && !string.IsNullOrEmpty(agyExe)) {
            var argStr = new StringBuilder();
            bool hasDebugPort = false;
            for (int i = 0; i < args.Length; i++) {
                if (args[i].StartsWith("--remote-debugging-port", StringComparison.OrdinalIgnoreCase)) {
                    hasDebugPort = true;
                }
                if (i > 0) argStr.Append(' ');
                argStr.Append(QuoteArg(args[i]));
            }
            if (!hasDebugPort) {
                if (argStr.Length > 0) argStr.Append(' ');
                argStr.Append("--remote-debugging-port=0");
            }
            StartClean(agyExe, Path.GetDirectoryName(agyExe), argStr.ToString());
        }

        string startWidgetArgs = string.IsNullOrEmpty(widgetBaseArgs) ? "--background" : (widgetBaseArgs + " --background");
        int spawnedWidgetPid = 0;
        var widgetProc = StartClean(widgetExe, widgetWorkDir, startWidgetArgs);
        if (widgetProc != null) {
            try { spawnedWidgetPid = widgetProc.Id; } catch { }
            widgetProc.Dispose();
        }

        bool isOwner;
        using (var mutex = new Mutex(true, "Local\\AntigravityStarWidgetLifecycle", out isOwner)) {
            if (!isOwner) return;

            int sessionId = Process.GetCurrentProcess().SessionId;
            bool hostSeen = false;
            bool widgetSeen = false;
            int hostGoneCount = 0;
            int widgetGoneCount = 0;
            var startedAt = Stopwatch.StartNew();

            while (true) {
                Thread.Sleep(1500);

                bool hostAlive = AnyInSession("Antigravity", sessionId);
                bool widgetAlive = isStarWidgetExe
                    ? AnyInSession("StarWidget", sessionId)
                    : IsPidAlive(spawnedWidgetPid);

                if (hostAlive) {
                    hostSeen = true;
                    hostGoneCount = 0;
                } else if (hostSeen) {
                    hostGoneCount++;
                    if (hostGoneCount >= 2) {
                        StopWidget(widgetExe, widgetBaseArgs, isStarWidgetExe, spawnedWidgetPid, sessionId);
                        break;
                    }
                } else if (startedAt.ElapsedMilliseconds > 30000) {
                    StopWidget(widgetExe, widgetBaseArgs, isStarWidgetExe, spawnedWidgetPid, sessionId);
                    break;
                }

                if (widgetAlive) {
                    widgetSeen = true;
                    widgetGoneCount = 0;
                } else if (widgetSeen) {
                    widgetGoneCount++;
                    if (widgetGoneCount >= 4) break;
                } else if (startedAt.ElapsedMilliseconds > 20000) {
                    break;
                }
            }
        }
    }
}

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using Microsoft.Win32;

[assembly: AssemblyTitle("Star Neko Guard")]
[assembly: AssemblyDescription("Star Neko Guard")]
[assembly: AssemblyProduct("Star Neko Widget")]
[assembly: AssemblyCompany("Antigravity Star Neko")]
[assembly: AssemblyVersion("1.2.0.0")]
[assembly: AssemblyFileVersion("1.2.0.0")]

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

        // Prefer inspecting currently running Antigravity process first so custom install locations always match
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

        return null;
    }

    // If user's Desktop Antigravity.lnk already points to LaunchAntigravityWithWidget.exe,
    // heal Start Menu Antigravity.lnk whenever an Antigravity update resets it back to raw Antigravity.exe or loses its native icon.
    private static void RepairStartMenuShortcutIfOptedIn(string agyExe) {
        try {
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string startPrograms = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            if (string.IsNullOrEmpty(desktop) || string.IsNullOrEmpty(startPrograms)) return;

            string desktopLnk = Path.Combine(desktop, "Antigravity.lnk");
            if (!File.Exists(desktopLnk)) return;

            string desiredIcon = (!string.IsNullOrEmpty(agyExe) && File.Exists(agyExe)) ? (agyExe + ",0") : null;
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            object shell = Activator.CreateInstance(shellType);
            try {
                object dSc = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { desktopLnk });
                if (dSc == null) return;
                string dTarget = dSc.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, dSc, null) as string;
                string dArgs = dSc.GetType().InvokeMember("Arguments", BindingFlags.GetProperty, null, dSc, null) as string;
                string dWork = dSc.GetType().InvokeMember("WorkingDirectory", BindingFlags.GetProperty, null, dSc, null) as string;
                if (string.IsNullOrEmpty(dTarget) ||
                    !dTarget.EndsWith("LaunchAntigravityWithWidget.exe", StringComparison.OrdinalIgnoreCase) ||
                    !File.Exists(dTarget)) {
                    return;
                }

                string[] startMenuCandidates = new[] {
                    Path.Combine(startPrograms, "Antigravity.lnk"),
                    Path.Combine(startPrograms, "Antigravity", "Antigravity.lnk")
                };
                foreach (string smLnk in startMenuCandidates) {
                    if (!File.Exists(smLnk)) continue;
                    try {
                        object sSc = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { smLnk });
                        if (sSc == null) continue;
                        Type scType = sSc.GetType();
                        string curTarget = scType.InvokeMember("TargetPath", BindingFlags.GetProperty, null, sSc, null) as string;
                        string curIcon = scType.InvokeMember("IconLocation", BindingFlags.GetProperty, null, sSc, null) as string;
                        bool needTarget = !string.Equals(curTarget, dTarget, StringComparison.OrdinalIgnoreCase);
                        bool needIcon = !string.IsNullOrEmpty(desiredIcon) && !string.Equals(curIcon, desiredIcon, StringComparison.OrdinalIgnoreCase);
                        if (needTarget || needIcon) {
                            if (needTarget) {
                                scType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sSc, new object[] { dTarget });
                                scType.InvokeMember("Arguments", BindingFlags.SetProperty, null, sSc, new object[] { dArgs ?? "" });
                                scType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sSc, new object[] { string.IsNullOrEmpty(dWork) ? Path.GetDirectoryName(dTarget) : dWork });
                            }
                            if (needIcon) {
                                scType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sSc, new object[] { desiredIcon });
                            }
                            scType.InvokeMember("Save", BindingFlags.InvokeMethod, null, sSc, null);
                        }
                    } catch {
                    }
                }
            } finally {
                if (shell != null && MarshalIsComObject(shell)) {
                    try { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell); } catch {}
                }
            }
        } catch {
        }
    }

    private static bool MarshalIsComObject(object o) {
        try { return System.Runtime.InteropServices.Marshal.IsComObject(o); } catch { return false; }
    }

    private static void BindShortcutsToLauncher(string launcherExe, string launcherArgs, string agyExe) {
        if (string.IsNullOrEmpty(launcherExe) || !File.Exists(launcherExe)) return;
        try {
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string startPrograms = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            var candidates = new List<string>();
            if (!string.IsNullOrEmpty(desktop)) {
                candidates.Add(Path.Combine(desktop, "Antigravity.lnk"));
            }
            if (!string.IsNullOrEmpty(startPrograms)) {
                candidates.Add(Path.Combine(startPrograms, "Antigravity.lnk"));
                candidates.Add(Path.Combine(startPrograms, "Antigravity", "Antigravity.lnk"));
            }

            var targets = new List<string>();
            foreach (string c in candidates) {
                if (File.Exists(c)) targets.Add(c);
            }
            if (targets.Count == 0 && !string.IsNullOrEmpty(startPrograms)) {
                targets.Add(Path.Combine(startPrograms, "Antigravity.lnk"));
            }
            if (targets.Count == 0) return;

            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            object shell = Activator.CreateInstance(shellType);
            try {
                string workDir = Path.GetDirectoryName(launcherExe);
                string defaultIcon = (!string.IsNullOrEmpty(agyExe) && File.Exists(agyExe)) ? (agyExe + ",0") : null;
                foreach (string lnk in targets) {
                    try {
                        object sc = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
                        if (sc == null) continue;
                        Type scType = sc.GetType();
                        scType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { launcherExe });
                        scType.InvokeMember("Arguments", BindingFlags.SetProperty, null, sc, new object[] { launcherArgs ?? "" });
                        scType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { workDir });
                        if (!string.IsNullOrEmpty(defaultIcon)) {
                            scType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { defaultIcon });
                        }
                        scType.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
                    } catch {
                    }
                }
            } finally {
                if (shell != null && MarshalIsComObject(shell)) {
                    try { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell); } catch {}
                }
            }
        } catch {
        }
    }

    private static bool IsWidgetLockHeld(string dataDir) {
        if (string.IsNullOrEmpty(dataDir)) return false;
        try {
            string lockPath = Path.Combine(dataDir, "runtime", "lockfile");
            if (!File.Exists(lockPath)) return false;
            using (File.Open(lockPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) {
                return false;
            }
        } catch (IOException) {
            return true;
        } catch {
            return false;
        }
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

    private static int GetPrimaryHostPid(int sessionId) {
        var list = Process.GetProcessesByName("Antigravity");
        int fallbackPid = 0;
        try {
            foreach (var p in list) {
                try {
                    if (p.SessionId != sessionId) continue;
                    if (p.MainWindowHandle != IntPtr.Zero) return p.Id;
                    if (fallbackPid == 0) fallbackPid = p.Id;
                } catch {
                }
            }
            return fallbackPid;
        } finally {
            foreach (var p in list) p.Dispose();
        }
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

    private static void CloseExistingAntigravity(int sessionId) {
        var initial = Process.GetProcessesByName("Antigravity");
        try {
            foreach (var p in initial) {
                try {
                    if (p.SessionId == sessionId && p.MainWindowHandle != IntPtr.Zero) {
                        p.CloseMainWindow();
                    }
                } catch {
                }
            }
        } finally {
            foreach (var p in initial) p.Dispose();
        }

        for (int i = 0; i < 22 && AnyInSession("Antigravity", sessionId); i++) {
            Thread.Sleep(250);
        }

        if (AnyInSession("Antigravity", sessionId)) {
            var remain = Process.GetProcessesByName("Antigravity");
            try {
                foreach (var p in remain) {
                    try {
                        if (p.SessionId == sessionId) p.Kill();
                    } catch {
                    }
                }
            } finally {
                foreach (var p in remain) p.Dispose();
            }
            for (int i = 0; i < 8 && AnyInSession("Antigravity", sessionId); i++) {
                Thread.Sleep(200);
            }
        }

        try {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string portFile = Path.Combine(appData, "Antigravity", "DevToolsActivePort");
            if (File.Exists(portFile)) File.Delete(portFile);
        } catch {
        }
    }

    private static void StopWidget(string widgetExe, string widgetBaseArgs, string extraFlags, bool isStarWidgetExe, int spawnedPid, int sessionId) {
        if (!string.IsNullOrEmpty(widgetExe) && File.Exists(widgetExe)) {
            try {
                string quitArgs = (string.IsNullOrEmpty(widgetBaseArgs) ? "--quit" : (widgetBaseArgs + " --quit")) + (extraFlags ?? "");
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
        int sessionId = Process.GetCurrentProcess().SessionId;

        bool relaunchHost = false;
        bool attachOnly = false;
        bool bindShortcuts = false;
        int waitPid = 0;
        string overrideWidgetExe = null;
        string overrideAppDir = null;
        string overrideDataDir = null;
        bool overrideNoShortcuts = false;
        var passthroughArgs = new List<string>();

        for (int i = 0; i < args.Length; i++) {
            string a = args[i] ?? "";
            if (a == "--relaunch-host") relaunchHost = true;
            else if (a == "--attach") attachOnly = true;
            else if (a == "--bind-shortcuts") bindShortcuts = true;
            else if (a.StartsWith("--wait-pid=", StringComparison.OrdinalIgnoreCase)) Int32.TryParse(a.Substring(11).Trim('"'), out waitPid);
            else if (a.StartsWith("--widget-exe=", StringComparison.OrdinalIgnoreCase)) overrideWidgetExe = a.Substring(13).Trim('"');
            else if (a.StartsWith("--widget-app=", StringComparison.OrdinalIgnoreCase)) overrideAppDir = a.Substring(13).Trim('"');
            else if (a.StartsWith("--data-dir=", StringComparison.OrdinalIgnoreCase)) overrideDataDir = a.Substring(11).Trim('"');
            else if (a == "--no-shortcuts") overrideNoShortcuts = true;
            else passthroughArgs.Add(a);
        }

        string agyExe = FindAntigravityExe();
        RepairStartMenuShortcutIfOptedIn(agyExe);

        string widgetExe = Path.Combine(baseDir, "StarWidget.exe");
        string widgetBaseArgs = "";
        string widgetWorkDir = baseDir;
        bool isStarWidgetExe = true;

        if (!string.IsNullOrEmpty(overrideWidgetExe) && File.Exists(overrideWidgetExe)) {
            widgetExe = overrideWidgetExe;
            widgetWorkDir = Path.GetDirectoryName(overrideWidgetExe);
            isStarWidgetExe = Path.GetFileName(overrideWidgetExe).Equals("StarWidget.exe", StringComparison.OrdinalIgnoreCase);
            if (!isStarWidgetExe && !string.IsNullOrEmpty(overrideAppDir) && Directory.Exists(overrideAppDir)) {
                widgetBaseArgs = QuoteArg(overrideAppDir);
                widgetWorkDir = overrideAppDir;
            }
        } else if (!File.Exists(widgetExe)) {
            string electronExe = Path.Combine(baseDir, "app", "node_modules", "electron", "dist", "electron.exe");
            string appDir = Path.Combine(baseDir, "app");
            if (File.Exists(electronExe)) {
                widgetExe = electronExe;
                widgetBaseArgs = QuoteArg(appDir);
                widgetWorkDir = appDir;
                isStarWidgetExe = false;
            }
        }

        string effectiveDataDir = !string.IsNullOrEmpty(overrideDataDir)
            ? overrideDataDir
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".antigravity-cat-widget");

        if (bindShortcuts && !overrideNoShortcuts) {
            string selfExe = Assembly.GetExecutingAssembly().Location;
            bool localAutoDiscoverable =
                File.Exists(Path.Combine(baseDir, "StarWidget.exe")) ||
                File.Exists(Path.Combine(baseDir, "app", "node_modules", "electron", "dist", "electron.exe"));
            string normBase = Path.GetFullPath(baseDir).TrimEnd('\\') + "\\";
            bool widgetInsideBase = !string.IsNullOrEmpty(widgetExe) &&
                File.Exists(widgetExe) &&
                Path.GetFullPath(widgetExe).StartsWith(normBase, StringComparison.OrdinalIgnoreCase);
            var scArgs = new StringBuilder();
            if (!localAutoDiscoverable || !widgetInsideBase) {
                if (!string.IsNullOrEmpty(widgetExe)) {
                    scArgs.Append(QuoteArg("--widget-exe=" + widgetExe));
                }
                if (!isStarWidgetExe && !string.IsNullOrEmpty(overrideAppDir)) {
                    if (scArgs.Length > 0) scArgs.Append(' ');
                    scArgs.Append(QuoteArg("--widget-app=" + overrideAppDir));
                }
            }
            BindShortcutsToLauncher(selfExe, scArgs.ToString(), agyExe);
        }

        var extraWidgetFlags = new StringBuilder();
        if (!string.IsNullOrEmpty(overrideDataDir)) {
            extraWidgetFlags.Append(" ").Append(QuoteArg("--data-dir=" + overrideDataDir));
        }
        if (overrideNoShortcuts) {
            extraWidgetFlags.Append(" --no-shortcuts");
        }
        string extraFlagsStr = extraWidgetFlags.ToString();

        if (relaunchHost) {
            if (string.IsNullOrEmpty(agyExe)) return;
            CloseExistingAntigravity(sessionId);
            RepairStartMenuShortcutIfOptedIn(agyExe);
            StartClean(agyExe, Path.GetDirectoryName(agyExe), "--remote-debugging-port=0");
            Thread.Sleep(1200);
        } else if (!attachOnly && !string.IsNullOrEmpty(agyExe)) {
            var argStr = new StringBuilder();
            bool hasDebugPort = false;
            for (int i = 0; i < passthroughArgs.Count; i++) {
                if (passthroughArgs[i].StartsWith("--remote-debugging-port", StringComparison.OrdinalIgnoreCase)) {
                    hasDebugPort = true;
                }
                if (i > 0) argStr.Append(' ');
                argStr.Append(QuoteArg(passthroughArgs[i]));
            }
            if (!hasDebugPort) {
                if (argStr.Length > 0) argStr.Append(' ');
                argStr.Append("--remote-debugging-port=0");
            }
            StartClean(agyExe, Path.GetDirectoryName(agyExe), argStr.ToString());
        }

        if (waitPid > 0) {
            try {
                using (var oldProc = Process.GetProcessById(waitPid)) {
                    oldProc.WaitForExit(5000);
                }
            } catch {
            }
            for (int i = 0; i < 15 && IsWidgetLockHeld(effectiveDataDir); i++) {
                Thread.Sleep(60);
            }
            Thread.Sleep(80);
        }

        string startWidgetArgs = (string.IsNullOrEmpty(widgetBaseArgs) ? "--background" : (widgetBaseArgs + " --background")) + extraFlagsStr;
        int spawnedWidgetPid = 0;
        var widgetProc = StartClean(widgetExe, widgetWorkDir, startWidgetArgs);
        if (widgetProc != null) {
            try { spawnedWidgetPid = widgetProc.Id; } catch { }
            widgetProc.Dispose();
        }

        // If invoked purely to hot-restart the widget (compatMode toggle / restart) while no Antigravity host is running,
        // exit cleanly instead of entering the 30s host-wait loop that would kill the newly relaunched widget.
        if (attachOnly && waitPid > 0 && GetPrimaryHostPid(sessionId) == 0) {
            return;
        }

        bool isOwner;
        using (var mutex = new Mutex(true, "Local\\AntigravityStarWidgetLifecycle", out isOwner)) {
            if (!isOwner) return;

            bool hostSeen = false;
            bool widgetSeen = false;
            int lastHostPid = 0;
            int hostGoneCount = 0;
            int widgetGoneCount = 0;
            var startedAt = Stopwatch.StartNew();

            while (true) {
                Thread.Sleep(1500);

                int curHostPid = GetPrimaryHostPid(sessionId);
                bool hostAlive = curHostPid > 0;
                bool widgetAlive = isStarWidgetExe
                    ? (AnyInSession("StarWidget", sessionId) || IsWidgetLockHeld(effectiveDataDir))
                    : (IsPidAlive(spawnedWidgetPid) || IsWidgetLockHeld(effectiveDataDir) || AnyInSession("ForegroundHost", sessionId));

                if (hostAlive) {
                    bool hostRestarted = hostSeen && lastHostPid > 0 && curHostPid != lastHostPid;
                    if (hostRestarted) {
                        // Antigravity restarted within one poll tick: heal Start Menu shortcut & re-ensure widget!
                        RepairStartMenuShortcutIfOptedIn(agyExe);
                        if (!widgetAlive) {
                            var wp = StartClean(widgetExe, widgetWorkDir, startWidgetArgs);
                            if (wp != null) {
                                try { spawnedWidgetPid = wp.Id; widgetAlive = true; } catch { }
                                wp.Dispose();
                            }
                        }
                    }
                    lastHostPid = curHostPid;
                    hostSeen = true;
                    hostGoneCount = 0;
                } else if (hostSeen) {
                    hostGoneCount++;
                    if (hostGoneCount >= 1) {
                        StopWidget(widgetExe, widgetBaseArgs, extraFlagsStr, isStarWidgetExe, spawnedWidgetPid, sessionId);
                        break;
                    }
                } else if (startedAt.ElapsedMilliseconds > 30000) {
                    StopWidget(widgetExe, widgetBaseArgs, extraFlagsStr, isStarWidgetExe, spawnedWidgetPid, sessionId);
                    break;
                }

                if (widgetAlive) {
                    widgetSeen = true;
                    widgetGoneCount = 0;
                } else if (widgetSeen) {
                    if (hostGoneCount > 0) continue;
                    widgetGoneCount++;
                    if (widgetGoneCount >= 4) break;
                } else if (startedAt.ElapsedMilliseconds > 20000) {
                    break;
                }
            }
        }
    }
}

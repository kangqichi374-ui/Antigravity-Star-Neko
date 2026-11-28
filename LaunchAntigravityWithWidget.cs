using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Star Neko Guard")]
[assembly: AssemblyDescription("Star Neko Guard")]
[assembly: AssemblyProduct("Star Neko Widget")]
[assembly: AssemblyCompany("Antigravity Star Neko")]
[assembly: AssemblyVersion("1.2.2.0")]
[assembly: AssemblyFileVersion("1.2.2.0")]

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

    private static bool IsHostLockHeld() {
        try {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if (string.IsNullOrEmpty(appData)) return false;
            string lockPath = Path.Combine(appData, "Antigravity", "lockfile");
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

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    private const uint WM_CLOSE = 0x0010;
    private const uint WM_NCLBUTTONDOWN = 0x00A1;
    private const int HTCAPTION = 2;
    private const uint GW_OWNER = 4;
    private const uint MB_OK = 0x00000000;
    private const uint MB_ICONINFORMATION = 0x00000040;
    private const uint MB_TOPMOST = 0x00040000;
    private const string RelaunchMutexName = "Local\\AntigravityStarWidgetRelaunching";
    private const int HostGracefulCloseTimeoutMs = 15000;
    private const int TrayDetectGraceMs = 1500;
    private const int TrayQuitWaitTimeoutMs = 60000;

    private enum CloseHostOutcome {
        Exited,
        UserCancelled,
        TrayTimeout,
        WindowStillOpen
    }

    private static HashSet<int> GetSessionProcessIds(string processName, int sessionId) {
        var ids = new HashSet<int>();
        var list = Process.GetProcessesByName(processName);
        try {
            foreach (var p in list) {
                try {
                    if (p.SessionId == sessionId) ids.Add(p.Id);
                } catch {
                }
            }
        } finally {
            foreach (var p in list) p.Dispose();
        }
        return ids;
    }

    private static List<IntPtr> CollectVisibleHostWindows(int sessionId, out HashSet<int> ownerPids, out bool anyVisible) {
        var pids = GetSessionProcessIds("Antigravity", sessionId);
        var topLevel = new List<IntPtr>();
        var owners = new HashSet<int>();
        bool foundAny = false;
        if (pids.Count > 0) {
            EnumWindows((hWnd, lParam) => {
                if (!IsWindowVisible(hWnd)) return true;
                uint wpid;
                GetWindowThreadProcessId(hWnd, out wpid);
                if (!pids.Contains((int)wpid)) return true;
                RECT rc;
                if (!GetWindowRect(hWnd, out rc)) return true;
                if ((rc.Right - rc.Left) <= 80 || (rc.Bottom - rc.Top) <= 80) return true;
                foundAny = true;
                owners.Add((int)wpid);
                if (GetWindow(hWnd, GW_OWNER) == IntPtr.Zero) {
                    topLevel.Add(hWnd);
                }
                return true;
            }, IntPtr.Zero);
        }
        ownerPids = owners;
        anyVisible = foundAny;
        return topLevel;
    }

    private static bool HasAnyVisibleHostWindow(int sessionId) {
        HashSet<int> unused;
        bool anyVisible;
        CollectVisibleHostWindows(sessionId, out unused, out anyVisible);
        return anyVisible;
    }

    private static bool IsTrackedHostAlive(int sessionId, HashSet<int> trackedPids) {
        if (IsHostLockHeld()) return true;
        if (HasAnyVisibleHostWindow(sessionId)) return true;
        if (trackedPids != null) {
            foreach (int pid in trackedPids) {
                if (IsPidAlive(pid)) return true;
            }
        }
        return false;
    }

    private static int GetPrimaryHostPid(int sessionId) {
        HashSet<int> visOwners;
        bool anyVisible;
        CollectVisibleHostWindows(sessionId, out visOwners, out anyVisible);
        foreach (int pid in visOwners) {
            return pid;
        }
        if (!IsHostLockHeld()) return 0;
        var list = Process.GetProcessesByName("Antigravity");
        try {
            foreach (var p in list) {
                try {
                    if (p.SessionId == sessionId) return p.Id;
                } catch {
                }
            }
            return 0;
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

    private static bool IsHostRelaunchInProgress() {
        try {
            Mutex existing;
            if (Mutex.TryOpenExisting(RelaunchMutexName, out existing)) {
                existing.Dispose();
                return true;
            }
        } catch {
        }
        return false;
    }

    private struct ThemePalette {
        public Color BgTop;
        public Color BgBottom;
        public Color Border;
        public Color Sep;
        public Color BrandFg;
        public Color StarFg;
        public Color Heading;
        public Color Text;
        public Color Muted;
        public Color SubBg;
        public Color SubBorder;
        public Color AccentA;
        public Color AccentB;
        public Color TrackBg;
        public Color BtnBg;
        public Color BtnHover;
        public Color BtnBorder;
        public Color BtnFg;
        public Color CloseFg;
    }

    private static string ReadBubbleTheme(string dataDir) {
        try {
            if (!string.IsNullOrEmpty(dataDir)) {
                string path = Path.Combine(dataDir, "settings.json");
                if (File.Exists(path)) {
                    string json = File.ReadAllText(path, Encoding.UTF8);
                    Match m = Regex.Match(json, "\"bubbleTheme\"\\s*:\\s*\"([a-zA-Z0-9_-]+)\"");
                    if (m.Success) return m.Groups[1].Value.ToLowerInvariant();
                }
            }
        } catch {
        }
        return "crystal";
    }

    private static ThemePalette GetThemePalette(string theme) {
        if (theme == "sakura") {
            return new ThemePalette {
                BgTop = Color.FromArgb(255, 251, 253),
                BgBottom = Color.FromArgb(253, 232, 242),
                Border = Color.FromArgb(236, 142, 184),
                Sep = Color.FromArgb(242, 198, 218),
                BrandFg = Color.FromArgb(212, 74, 134),
                StarFg = Color.FromArgb(234, 120, 171),
                Heading = Color.FromArgb(92, 27, 59),
                Text = Color.FromArgb(116, 43, 77),
                Muted = Color.FromArgb(158, 92, 122),
                SubBg = Color.FromArgb(255, 249, 252),
                SubBorder = Color.FromArgb(244, 206, 224),
                AccentA = Color.FromArgb(230, 93, 146),
                AccentB = Color.FromArgb(245, 148, 181),
                TrackBg = Color.FromArgb(245, 212, 228),
                BtnBg = Color.FromArgb(254, 240, 246),
                BtnHover = Color.FromArgb(252, 226, 237),
                BtnBorder = Color.FromArgb(236, 152, 190),
                BtnFg = Color.FromArgb(156, 63, 105),
                CloseFg = Color.FromArgb(173, 101, 134)
            };
        }
        if (theme == "ocean") {
            return new ThemePalette {
                BgTop = Color.FromArgb(255, 255, 255),
                BgBottom = Color.FromArgb(242, 247, 255),
                Border = Color.FromArgb(37, 58, 123),
                Sep = Color.FromArgb(206, 219, 242),
                BrandFg = Color.FromArgb(37, 58, 123),
                StarFg = Color.FromArgb(59, 99, 184),
                Heading = Color.FromArgb(25, 43, 92),
                Text = Color.FromArgb(39, 60, 117),
                Muted = Color.FromArgb(88, 112, 164),
                SubBg = Color.FromArgb(246, 250, 255),
                SubBorder = Color.FromArgb(208, 221, 244),
                AccentA = Color.FromArgb(45, 83, 168),
                AccentB = Color.FromArgb(88, 138, 226),
                TrackBg = Color.FromArgb(221, 231, 247),
                BtnBg = Color.FromArgb(237, 243, 252),
                BtnHover = Color.FromArgb(223, 234, 250),
                BtnBorder = Color.FromArgb(176, 198, 234),
                BtnFg = Color.FromArgb(43, 76, 153),
                CloseFg = Color.FromArgb(78, 102, 158)
            };
        }
        if (theme == "night") {
            return new ThemePalette {
                BgTop = Color.FromArgb(34, 28, 59),
                BgBottom = Color.FromArgb(25, 21, 46),
                Border = Color.FromArgb(132, 110, 212),
                Sep = Color.FromArgb(66, 56, 110),
                BrandFg = Color.FromArgb(204, 184, 255),
                StarFg = Color.FromArgb(197, 163, 255),
                Heading = Color.FromArgb(240, 234, 255),
                Text = Color.FromArgb(216, 206, 250),
                Muted = Color.FromArgb(155, 142, 199),
                SubBg = Color.FromArgb(42, 35, 74),
                SubBorder = Color.FromArgb(78, 66, 128),
                AccentA = Color.FromArgb(116, 130, 248),
                AccentB = Color.FromArgb(177, 120, 255),
                TrackBg = Color.FromArgb(54, 45, 94),
                BtnBg = Color.FromArgb(48, 40, 86),
                BtnHover = Color.FromArgb(64, 54, 112),
                BtnBorder = Color.FromArgb(116, 98, 186),
                BtnFg = Color.FromArgb(230, 222, 255),
                CloseFg = Color.FromArgb(178, 164, 222)
            };
        }
        return new ThemePalette {
            BgTop = Color.FromArgb(253, 251, 255),
            BgBottom = Color.FromArgb(238, 234, 255),
            Border = Color.FromArgb(146, 122, 236),
            Sep = Color.FromArgb(218, 207, 245),
            BrandFg = Color.FromArgb(107, 67, 168),
            StarFg = Color.FromArgb(169, 124, 240),
            Heading = Color.FromArgb(45, 31, 89),
            Text = Color.FromArgb(62, 47, 107),
            Muted = Color.FromArgb(114, 98, 158),
            SubBg = Color.FromArgb(252, 250, 255),
            SubBorder = Color.FromArgb(219, 208, 244),
            AccentA = Color.FromArgb(119, 131, 246),
            AccentB = Color.FromArgb(164, 109, 232),
            TrackBg = Color.FromArgb(223, 209, 242),
            BtnBg = Color.FromArgb(245, 240, 253),
            BtnHover = Color.FromArgb(235, 226, 251),
            BtnBorder = Color.FromArgb(196, 179, 235),
            BtnFg = Color.FromArgb(91, 67, 158),
            CloseFg = Color.FromArgb(126, 108, 176)
        };
    }

    private static GraphicsPath CreateRoundedRect(Rectangle bounds, int radius) {
        int d = radius * 2;
        var path = new GraphicsPath();
        path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
        path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
        path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
        path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    private sealed class ThemedCardForm : Form {
        private readonly ThemePalette _pal;
        public ThemedCardForm(ThemePalette pal) {
            _pal = pal;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            ShowInTaskbar = true;
            TopMost = true;
            AutoScaleMode = AutoScaleMode.Font;
            Font = new Font("Microsoft YaHei UI", 9.5f);
            BackColor = pal.BgTop;
            DoubleBuffered = true;
            try {
                Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location);
            } catch {
            }
        }

        public void ApplyRoundRegion() {
            if (Width > 20 && Height > 20) {
                using (var path = CreateRoundedRect(new Rectangle(0, 0, Width, Height), 16)) {
                    Region = new Region(path);
                }
            }
        }

        protected override void OnSizeChanged(EventArgs e) {
            base.OnSizeChanged(e);
            ApplyRoundRegion();
        }

        protected override void OnPaint(PaintEventArgs e) {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var outer = new Rectangle(0, 0, Width - 1, Height - 1);
            using (var bgBrush = new LinearGradientBrush(outer, _pal.BgTop, _pal.BgBottom, 135f)) {
                g.FillRectangle(bgBrush, outer);
            }
            var borderRect = new Rectangle(1, 1, Width - 3, Height - 3);
            using (var borderPath = CreateRoundedRect(borderRect, 15))
            using (var pen = new Pen(_pal.Border, 2f)) {
                g.DrawPath(pen, borderPath);
            }
        }
    }

    private static Panel BuildThemedHeader(Form owner, ThemePalette pal, string brandText, Action onClose) {
        var header = new Panel();
        header.Height = 38;
        header.Dock = DockStyle.Top;
        header.BackColor = Color.Transparent;
        header.Padding = new Padding(16, 0, 10, 0);

        MouseEventHandler startDrag = (s, e) => {
            if (e.Button == MouseButtons.Left) {
                ReleaseCapture();
                SendMessage(owner.Handle, WM_NCLBUTTONDOWN, (IntPtr)HTCAPTION, IntPtr.Zero);
            }
        };
        header.MouseDown += startDrag;

        header.Paint += (s, e) => {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var pen = new Pen(pal.Sep, 1f)) {
                g.DrawLine(pen, 14, header.Height - 1, header.Width - 14, header.Height - 1);
            }
            // Twin catgirl eye dots (gold & pink)
            int dotX = header.Width - 56;
            int dotY = (header.Height - 7) / 2;
            using (var gold = new SolidBrush(Color.FromArgb(242, 189, 73)))
            using (var pink = new SolidBrush(Color.FromArgb(233, 110, 184))) {
                g.FillEllipse(gold, dotX, dotY, 7, 7);
                g.FillEllipse(pink, dotX + 11, dotY, 7, 7);
            }
        };

        var titleLbl = new Label();
        titleLbl.AutoSize = true;
        titleLbl.Text = "✦ " + brandText;
        titleLbl.Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Bold);
        titleLbl.ForeColor = pal.BrandFg;
        titleLbl.BackColor = Color.Transparent;
        titleLbl.Location = new Point(16, 9);
        titleLbl.MouseDown += startDrag;

        var closeBtn = new Button();
        closeBtn.Text = "×";
        closeBtn.Font = new Font("Segoe UI", 12f, FontStyle.Regular);
        closeBtn.ForeColor = pal.CloseFg;
        closeBtn.BackColor = Color.Transparent;
        closeBtn.FlatStyle = FlatStyle.Flat;
        closeBtn.FlatAppearance.BorderSize = 0;
        closeBtn.FlatAppearance.MouseOverBackColor = pal.BtnHover;
        closeBtn.Size = new Size(28, 26);
        closeBtn.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        closeBtn.Location = new Point(header.Width - 36, 6);
        closeBtn.Cursor = Cursors.Hand;
        closeBtn.TabStop = false;
        closeBtn.Click += (s, e) => onClose();

        header.Controls.Add(titleLbl);
        header.Controls.Add(closeBtn);
        return header;
    }

    private static Button CreateThemedButton(ThemePalette pal, string text, bool primary) {
        var btn = new Button();
        btn.Text = text;
        btn.AutoSize = true;
        btn.MinimumSize = new Size(104, 34);
        btn.Padding = new Padding(12, 4, 12, 4);
        btn.Font = new Font("Microsoft YaHei UI", 9.2f, FontStyle.Bold);
        btn.FlatStyle = FlatStyle.Flat;
        btn.Cursor = Cursors.Hand;
        if (primary) {
            btn.BackColor = pal.AccentA;
            btn.ForeColor = Color.White;
            btn.FlatAppearance.BorderSize = 0;
            btn.FlatAppearance.MouseOverBackColor = pal.AccentB;
            btn.FlatAppearance.MouseDownBackColor = pal.AccentA;
        } else {
            btn.BackColor = pal.BtnBg;
            btn.ForeColor = pal.BtnFg;
            btn.FlatAppearance.BorderSize = 1;
            btn.FlatAppearance.BorderColor = pal.BtnBorder;
            btn.FlatAppearance.MouseOverBackColor = pal.BtnHover;
            btn.FlatAppearance.MouseDownBackColor = pal.BtnBg;
        }
        return btn;
    }

    private static CloseHostOutcome ShowTrayQuitWaitDialog(int sessionId, HashSet<int> trackedPids, int timeoutMs, string dataDir) {
        try { SetProcessDPIAware(); } catch { }
        try { Application.EnableVisualStyles(); } catch { }

        ThemePalette pal = GetThemePalette(ReadBubbleTheme(dataDir));
        CloseHostOutcome outcome = CloseHostOutcome.UserCancelled;
        var sw = Stopwatch.StartNew();
        float progress = 1f;

        using (var form = new ThemedCardForm(pal))
        using (var pollTimer = new System.Windows.Forms.Timer()) {
            form.Text = "星语猫娘 · 请从系统托盘退出 Antigravity";

            var header = BuildThemedHeader(form, pal, "星语猫娘 · 等待托盘退出", () => {
                outcome = CloseHostOutcome.UserCancelled;
                form.Close();
            });

            var content = new TableLayoutPanel();
            content.Dock = DockStyle.Fill;
            content.ColumnCount = 1;
            content.RowCount = 6;
            content.BackColor = Color.Transparent;
            content.Padding = new Padding(20, 14, 20, 16);
            content.AutoSize = true;
            content.AutoSizeMode = AutoSizeMode.GrowAndShrink;

            var titleLabel = new Label();
            titleLabel.AutoSize = true;
            titleLabel.MaximumSize = new Size(430, 0);
            titleLabel.Font = new Font("Microsoft YaHei UI", 11.5f, FontStyle.Bold);
            titleLabel.ForeColor = pal.Heading;
            titleLabel.BackColor = Color.Transparent;
            titleLabel.Margin = new Padding(0, 0, 0, 10);
            titleLabel.Text = "Antigravity 已收进右下角系统托盘";

            var noticeBox = new Panel();
            noticeBox.AutoSize = true;
            noticeBox.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            noticeBox.BackColor = pal.SubBg;
            noticeBox.Padding = new Padding(14, 10, 12, 10);
            noticeBox.Margin = new Padding(0, 0, 0, 12);
            noticeBox.MinimumSize = new Size(430, 0);
            noticeBox.Paint += (s, e) => {
                Graphics g = e.Graphics;
                g.SmoothingMode = SmoothingMode.AntiAlias;
                var r = new Rectangle(0, 0, noticeBox.Width - 1, noticeBox.Height - 1);
                using (var p = CreateRoundedRect(r, 10))
                using (var pen = new Pen(pal.SubBorder, 1f)) {
                    g.DrawPath(pen, p);
                }
                using (var bar = new LinearGradientBrush(new Rectangle(4, 8, 4, Math.Max(10, noticeBox.Height - 16)), pal.AccentA, pal.AccentB, 90f)) {
                    g.FillRectangle(bar, 5, 9, 3, Math.Max(10, noticeBox.Height - 18));
                }
            };

            var bodyLabel = new Label();
            bodyLabel.AutoSize = true;
            bodyLabel.MaximumSize = new Size(402, 0);
            bodyLabel.ForeColor = pal.Text;
            bodyLabel.BackColor = Color.Transparent;
            bodyLabel.Text =
                "Antigravity 主窗口已关闭，但因开启了「后台运行」仍驻留在托盘。\n" +
                "为保护数据安全，启动器绝不强杀进程。\n\n" +
                "请执行以下两步：\n" +
                "  1. 右键右下角系统托盘中的 Antigravity 图标\n" +
                "  2. 点击「退出 / Quit」\n\n" +
                "检测到退出后，将自动以实时额度模式重开并接回猫娘。";
            noticeBox.Controls.Add(bodyLabel);

            var statusLabel = new Label();
            statusLabel.AutoSize = true;
            statusLabel.MaximumSize = new Size(430, 0);
            statusLabel.Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Bold);
            statusLabel.ForeColor = pal.BrandFg;
            statusLabel.BackColor = Color.Transparent;
            statusLabel.Margin = new Padding(0, 0, 0, 6);
            statusLabel.Text = string.Format("正在等待托盘退出（剩余 {0} 秒）…", Math.Max(1, timeoutMs / 1000));

            var barPanel = new Panel();
            barPanel.Size = new Size(430, 7);
            barPanel.BackColor = Color.Transparent;
            barPanel.Margin = new Padding(0, 0, 0, 10);
            barPanel.Paint += (s, e) => {
                Graphics g = e.Graphics;
                g.SmoothingMode = SmoothingMode.AntiAlias;
                var tr = new Rectangle(0, 0, barPanel.Width - 1, barPanel.Height - 1);
                using (var tp = CreateRoundedRect(tr, 3))
                using (var tb = new SolidBrush(pal.TrackBg)) {
                    g.FillPath(tb, tp);
                }
                int fw = Math.Max(6, (int)Math.Round(barPanel.Width * Math.Max(0f, Math.Min(1f, progress))));
                var fr = new Rectangle(0, 0, fw - 1, barPanel.Height - 1);
                using (var fp = CreateRoundedRect(fr, 3))
                using (var fb = new LinearGradientBrush(new Rectangle(0, 0, Math.Max(8, barPanel.Width), barPanel.Height), pal.AccentA, pal.AccentB, 0f)) {
                    g.FillPath(fb, fp);
                }
            };

            var tipLabel = new Label();
            tipLabel.AutoSize = true;
            tipLabel.MaximumSize = new Size(430, 0);
            tipLabel.Font = new Font("Microsoft YaHei UI", 8.5f);
            tipLabel.ForeColor = pal.Muted;
            tipLabel.BackColor = Color.Transparent;
            tipLabel.Margin = new Padding(0, 0, 0, 12);
            tipLabel.Text = "提示：如需以后一键自动重开，可在 Antigravity 设置中关闭「后台运行」。";

            var btnPanel = new FlowLayoutPanel();
            btnPanel.FlowDirection = FlowDirection.RightToLeft;
            btnPanel.AutoSize = true;
            btnPanel.Dock = DockStyle.Fill;
            btnPanel.BackColor = Color.Transparent;
            btnPanel.Margin = new Padding(0);

            var cancelBtn = CreateThemedButton(pal, "取消重开", false);
            cancelBtn.Click += (s, e) => {
                outcome = CloseHostOutcome.UserCancelled;
                form.Close();
            };
            btnPanel.Controls.Add(cancelBtn);

            content.Controls.Add(titleLabel, 0, 0);
            content.Controls.Add(noticeBox, 0, 1);
            content.Controls.Add(statusLabel, 0, 2);
            content.Controls.Add(barPanel, 0, 3);
            content.Controls.Add(tipLabel, 0, 4);
            content.Controls.Add(btnPanel, 0, 5);

            var rootPanel = new Panel();
            rootPanel.Dock = DockStyle.Fill;
            rootPanel.BackColor = Color.Transparent;
            rootPanel.AutoSize = true;
            rootPanel.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            rootPanel.Controls.Add(content);
            rootPanel.Controls.Add(header);

            form.Controls.Add(rootPanel);
            form.AutoSize = true;
            form.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            form.CancelButton = cancelBtn;

            pollTimer.Interval = 250;
            pollTimer.Tick += (s, e) => {
                if (!IsTrackedHostAlive(sessionId, trackedPids)) {
                    pollTimer.Stop();
                    outcome = CloseHostOutcome.Exited;
                    form.Close();
                    return;
                }
                long remainMs = timeoutMs - sw.ElapsedMilliseconds;
                if (remainMs <= 0) {
                    pollTimer.Stop();
                    outcome = CloseHostOutcome.TrayTimeout;
                    form.Close();
                    return;
                }
                progress = (float)remainMs / timeoutMs;
                int remainSec = (int)Math.Ceiling(remainMs / 1000.0);
                statusLabel.Text = string.Format("正在等待托盘退出（剩余 {0} 秒）…", Math.Max(1, remainSec));
                barPanel.Invalidate();
            };

            form.Shown += (s, e) => {
                form.ApplyRoundRegion();
                pollTimer.Start();
            };
            form.FormClosed += (s, e) => {
                pollTimer.Stop();
            };

            form.ShowDialog();
        }

        return outcome;
    }

    private static void ShowThemedNoticeDialog(string title, string heading, string message, string dataDir) {
        try {
            try { SetProcessDPIAware(); } catch { }
            try { Application.EnableVisualStyles(); } catch { }
            ThemePalette pal = GetThemePalette(ReadBubbleTheme(dataDir));

            using (var form = new ThemedCardForm(pal)) {
                form.Text = title;

                var header = BuildThemedHeader(form, pal, title, () => form.Close());

                var content = new TableLayoutPanel();
                content.Dock = DockStyle.Fill;
                content.ColumnCount = 1;
                content.RowCount = 3;
                content.BackColor = Color.Transparent;
                content.Padding = new Padding(20, 14, 20, 16);
                content.AutoSize = true;
                content.AutoSizeMode = AutoSizeMode.GrowAndShrink;

                var headingLbl = new Label();
                headingLbl.AutoSize = true;
                headingLbl.MaximumSize = new Size(420, 0);
                headingLbl.Font = new Font("Microsoft YaHei UI", 11f, FontStyle.Bold);
                headingLbl.ForeColor = pal.Heading;
                headingLbl.BackColor = Color.Transparent;
                headingLbl.Margin = new Padding(0, 0, 0, 10);
                headingLbl.Text = heading;

                var msgLbl = new Label();
                msgLbl.AutoSize = true;
                msgLbl.MaximumSize = new Size(420, 0);
                msgLbl.ForeColor = pal.Text;
                msgLbl.BackColor = Color.Transparent;
                msgLbl.Margin = new Padding(0, 0, 0, 16);
                msgLbl.Text = message;

                var btnPanel = new FlowLayoutPanel();
                btnPanel.FlowDirection = FlowDirection.RightToLeft;
                btnPanel.AutoSize = true;
                btnPanel.Dock = DockStyle.Fill;
                btnPanel.BackColor = Color.Transparent;
                btnPanel.Margin = new Padding(0);

                var okBtn = CreateThemedButton(pal, "知道了", true);
                okBtn.Click += (s, e) => form.Close();
                btnPanel.Controls.Add(okBtn);

                content.Controls.Add(headingLbl, 0, 0);
                content.Controls.Add(msgLbl, 0, 1);
                content.Controls.Add(btnPanel, 0, 2);

                var rootPanel = new Panel();
                rootPanel.Dock = DockStyle.Fill;
                rootPanel.BackColor = Color.Transparent;
                rootPanel.AutoSize = true;
                rootPanel.AutoSizeMode = AutoSizeMode.GrowAndShrink;
                rootPanel.Controls.Add(content);
                rootPanel.Controls.Add(header);

                form.Controls.Add(rootPanel);
                form.AutoSize = true;
                form.AutoSizeMode = AutoSizeMode.GrowAndShrink;
                form.AcceptButton = okBtn;
                form.CancelButton = okBtn;
                form.Shown += (s, e) => form.ApplyRoundRegion();
                form.ShowDialog();
            }
        } catch {
            try { MessageBoxW(IntPtr.Zero, message, title, MB_OK | MB_ICONINFORMATION | MB_TOPMOST); } catch { }
        }
    }

    private static CloseHostOutcome CloseExistingAntigravity(int sessionId, int windowTimeoutMs, int trayTimeoutMs, bool silentAbort, string dataDir) {
        HashSet<int> trackedPids;
        bool anyVisible;
        var topWindows = CollectVisibleHostWindows(sessionId, out trackedPids, out anyVisible);

        if (!IsHostLockHeld() && !anyVisible) {
            TryDeleteStaleDevToolsPort();
            return CloseHostOutcome.Exited;
        }

        // 绝不调用 p.Kill() 强杀宿主：仅对可见主窗口发送 WM_CLOSE 优雅关闭请求
        if (anyVisible) {
            if (topWindows.Count > 0) {
                foreach (IntPtr hWnd in topWindows) {
                    try {
                        PostMessage(hWnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                    } catch {
                    }
                }
            } else {
                var initial = Process.GetProcessesByName("Antigravity");
                try {
                    foreach (var p in initial) {
                        try {
                            if (p.SessionId == sessionId && p.MainWindowHandle != IntPtr.Zero) {
                                trackedPids.Add(p.Id);
                                p.CloseMainWindow();
                            }
                        } catch {
                        }
                    }
                } finally {
                    foreach (var p in initial) p.Dispose();
                }
            }

            var sw = Stopwatch.StartNew();
            Stopwatch windowGoneSw = null;
            bool enteredTray = false;

            while (sw.ElapsedMilliseconds < windowTimeoutMs) {
                if (!IsTrackedHostAlive(sessionId, trackedPids)) {
                    Thread.Sleep(250);
                    TryDeleteStaleDevToolsPort();
                    return CloseHostOutcome.Exited;
                }

                if (!HasAnyVisibleHostWindow(sessionId)) {
                    if (windowGoneSw == null) {
                        windowGoneSw = Stopwatch.StartNew();
                    } else if (windowGoneSw.ElapsedMilliseconds >= TrayDetectGraceMs) {
                        enteredTray = true;
                        break;
                    }
                } else {
                    windowGoneSw = null;
                }

                Thread.Sleep(200);
            }

            if (!enteredTray) {
                if (!IsTrackedHostAlive(sessionId, trackedPids)) {
                    Thread.Sleep(250);
                    TryDeleteStaleDevToolsPort();
                    return CloseHostOutcome.Exited;
                }
                return CloseHostOutcome.WindowStillOpen;
            }
        }

        // 主窗口已关闭但宿主仍持有实例锁（Antigravity 开启「后台运行」驻留系统托盘）
        if (silentAbort) {
            return CloseHostOutcome.TrayTimeout;
        }

        CloseHostOutcome trayOutcome = ShowTrayQuitWaitDialog(sessionId, trackedPids, trayTimeoutMs, dataDir);
        if (trayOutcome == CloseHostOutcome.Exited) {
            Thread.Sleep(300);
            TryDeleteStaleDevToolsPort();
            return CloseHostOutcome.Exited;
        }
        return trayOutcome;
    }

    private static void TryDeleteStaleDevToolsPort() {
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
        bool silentAbort = false;
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
            else if (a == "--silent") silentAbort = true;
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
            CloseHostOutcome closeOutcome = CloseHostOutcome.Exited;
            bool relaunchStarted = false;
            bool relaunchGuardOwned;
            using (var relaunchGuard = new Mutex(true, RelaunchMutexName, out relaunchGuardOwned)) {
                if (!relaunchGuardOwned) return;
                try {
                    closeOutcome = CloseExistingAntigravity(sessionId, HostGracefulCloseTimeoutMs, TrayQuitWaitTimeoutMs, silentAbort, effectiveDataDir);
                    if (closeOutcome == CloseHostOutcome.Exited) {
                        RepairStartMenuShortcutIfOptedIn(agyExe);
                        StartClean(agyExe, Path.GetDirectoryName(agyExe), "--remote-debugging-port=0");
                        var bootSw = Stopwatch.StartNew();
                        while (bootSw.ElapsedMilliseconds < 5000 && !IsHostLockHeld() && !HasAnyVisibleHostWindow(sessionId)) {
                            Thread.Sleep(200);
                        }
                        Thread.Sleep(400);
                        relaunchStarted = true;
                    }
                } finally {
                    if (relaunchGuardOwned) {
                        try { relaunchGuard.ReleaseMutex(); } catch { }
                    }
                }
            }
            if (!relaunchStarted) {
                if (!silentAbort && closeOutcome != CloseHostOutcome.UserCancelled) {
                    string title = closeOutcome == CloseHostOutcome.TrayTimeout
                        ? "星语猫娘 · 等待托盘退出超时"
                        : "星语猫娘 · 已取消自动重开";
                    string heading = closeOutcome == CloseHostOutcome.TrayTimeout
                        ? "60 秒内未检测到托盘退出"
                        : "Antigravity 主窗口未在 15 秒内关闭";
                    string msg;
                    if (closeOutcome == CloseHostOutcome.TrayTimeout) {
                        msg = bindShortcuts
                            ? "已取消本次自动重开（绝不强杀进程）。\n\n快捷方式已更新，之后右键托盘退出 Antigravity 再从桌面/开始菜单重开即可开启实时额度。"
                            : "已取消本次自动重开（绝不强杀进程）。\n\n请右键右下角托盘退出 Antigravity 后再试，或在 Antigravity 设置中关闭「后台运行」。";
                    } else {
                        msg = bindShortcuts
                            ? "可能仍有未保存内容、正在运行的任务，或您已取消关闭。\n\n为保护数据安全，已放弃自动重开并原样保留当前窗口（绝不强杀进程）。\n快捷方式已更新，待当前工作结束后手动重开即可开启实时额度。"
                            : "可能仍有未保存内容、正在运行的任务，或您已取消关闭。\n\n为保护数据安全，已放弃自动重开并原样保留当前窗口（绝不强杀进程）。请手动保存关闭后再试。";
                    }
                    ShowThemedNoticeDialog(title, heading, msg, effectiveDataDir);
                }
                return;
            }
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
                    if (IsHostRelaunchInProgress()) {
                        hostGoneCount = 0;
                        continue;
                    }
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

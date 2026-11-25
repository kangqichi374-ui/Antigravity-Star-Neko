using System;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.InteropServices;

[assembly: AssemblyTitle("Star Neko Brander")]
[assembly: AssemblyDescription("Star Neko Brander")]
[assembly: AssemblyProduct("Star Neko Widget")]
[assembly: AssemblyVersion("1.2.0.0")]
[assembly: AssemblyFileVersion("1.2.0.0")]

internal static class BrandExe {
    private delegate bool EnumResNameProc(IntPtr hModule, IntPtr lpszType, IntPtr lpszName, IntPtr lParam);
    private delegate bool EnumResLangProc(IntPtr hModule, IntPtr lpszType, IntPtr lpszName, ushort wIDLanguage, IntPtr lParam);

    [DllImport("shell32.dll")]
    private static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibraryExW(string lpFileName, IntPtr hFile, uint dwFlags);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeLibrary(IntPtr hModule);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool EnumResourceNamesW(IntPtr hModule, IntPtr lpszType, EnumResNameProc lpEnumFunc, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool EnumResourceLanguagesW(IntPtr hModule, IntPtr lpszType, IntPtr lpszName, EnumResLangProc lpEnumFunc, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr FindResourceExW(IntPtr hModule, IntPtr lpType, IntPtr lpName, ushort wLanguage);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint SizeofResource(IntPtr hModule, IntPtr hResInfo);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LoadResource(IntPtr hModule, IntPtr hResInfo);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LockResource(IntPtr hResData);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr BeginUpdateResourceW(string pFileName, bool bDeleteExistingResources);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool UpdateResourceW(IntPtr hUpdate, IntPtr lpType, IntPtr lpName, ushort wLanguage, byte[] lpData, uint cbData);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool EndUpdateResourceW(IntPtr hUpdate, bool fDiscard);

    private sealed class ResEntry {
        public int TypeId;
        public int IntId;
        public string StrName;
        public ushort Lang;
        public byte[] Data;
    }

    private static List<ResEntry> ReadResources(string path, int[] types) {
        var list = new List<ResEntry>();
        IntPtr hMod = LoadLibraryExW(path, IntPtr.Zero, 0x00000002u);
        if (hMod == IntPtr.Zero) throw new InvalidOperationException("LoadLibraryExW failed: " + Marshal.GetLastWin32Error());
        try {
            foreach (int rt in types) {
                IntPtr pType = new IntPtr(rt);
                EnumResNameProc nameCb = delegate(IntPtr m, IntPtr t, IntPtr rn, IntPtr lp) {
                    long raw = rn.ToInt64();
                    bool isInt = (raw >= 0 && raw < 0x10000L);
                    int intId = isInt ? (int)raw : 0;
                    string strName = isInt ? null : Marshal.PtrToStringUni(rn);
                    EnumResLangProc langCb = delegate(IntPtr m2, IntPtr t2, IntPtr rn2, ushort lang, IntPtr lp2) {
                        IntPtr hRes = FindResourceExW(m2, t2, rn2, lang);
                        if (hRes != IntPtr.Zero) {
                            uint sz = SizeofResource(m2, hRes);
                            IntPtr hGlob = LoadResource(m2, hRes);
                            IntPtr ptr = LockResource(hGlob);
                            if (ptr != IntPtr.Zero && sz > 0) {
                                byte[] buf = new byte[sz];
                                Marshal.Copy(ptr, buf, 0, (int)sz);
                                list.Add(new ResEntry { TypeId = rt, IntId = intId, StrName = strName, Lang = lang, Data = buf });
                            }
                        }
                        return true;
                    };
                    EnumResourceLanguagesW(m, t, rn, langCb, IntPtr.Zero);
                    GC.KeepAlive(langCb);
                    return true;
                };
                EnumResourceNamesW(hMod, pType, nameCb, IntPtr.Zero);
                GC.KeepAlive(nameCb);
            }
        } finally {
            FreeLibrary(hMod);
        }
        return list;
    }

    private static bool PutRes(IntPtr hUpd, int typeId, int intId, string strName, ushort lang, byte[] data) {
        IntPtr pType = new IntPtr(typeId);
        uint len = data == null ? 0u : (uint)data.Length;
        if (strName != null) {
            IntPtr pName = Marshal.StringToHGlobalUni(strName);
            try { return UpdateResourceW(hUpd, pType, pName, lang, data, len); }
            finally { Marshal.FreeHGlobal(pName); }
        }
        return UpdateResourceW(hUpd, pType, new IntPtr(intId), lang, data, len);
    }

    public static int Main(string[] args) {
        if (args.Length < 2) return 2;
        string targetExe = args[0];
        string carrierDll = args[1];
        int[] rtypes = new[] { 3, 14, 16 };
        var oldRes = ReadResources(targetExe, rtypes);
        var newRes = ReadResources(carrierDll, rtypes);
        IntPtr hUpd = BeginUpdateResourceW(targetExe, false);
        if (hUpd == IntPtr.Zero) return 3;
        foreach (var r in oldRes) {
            PutRes(hUpd, r.TypeId, r.IntId, r.StrName, r.Lang, null);
        }
        foreach (var r in newRes) {
            int id = (r.TypeId == 14 || r.TypeId == 16) ? 1 : r.IntId;
            string sName = (r.TypeId == 14 || r.TypeId == 16) ? null : r.StrName;
            PutRes(hUpd, r.TypeId, id, sName, 1033, r.Data);
        }
        if (!EndUpdateResourceW(hUpd, false)) return 4;
        try { SHChangeNotify(0x08000000, 0u, IntPtr.Zero, IntPtr.Zero); } catch {}
        return 0;
    }
}

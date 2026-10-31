using System.IO;
using System.Runtime.InteropServices;

namespace Aurora;

/// <summary>Windows 数据保护 API（DPAPI），只给当前用户解开。</summary>
public static class Dpapi
{
    private const int CRYPTPROTECT_UI_FORBIDDEN = 0x1;

    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob
    {
        public int cbData;
        public IntPtr pbData;
    }

    [DllImport("crypt32.dll", SetLastError = true)]
    private static extern bool CryptProtectData(
        ref DataBlob pDataIn,
        [MarshalAs(UnmanagedType.LPWStr)] string? szDataDescr,
        ref DataBlob pOptionalEntropy,
        IntPtr pvReserved,
        IntPtr pPromptStruct,
        int dwFlags,
        out DataBlob pDataOut);

    [DllImport("crypt32.dll", SetLastError = true)]
    private static extern bool CryptUnprotectData(
        ref DataBlob pDataIn,
        IntPtr ppszDataDescr,
        ref DataBlob pOptionalEntropy,
        IntPtr pvReserved,
        IntPtr pPromptStruct,
        int dwFlags,
        out DataBlob pDataOut);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr hMem);

    public static byte[] Protect(byte[] plain)
    {
        var input = new DataBlob();
        var entropy = new DataBlob();
        var output = new DataBlob();
        var ptr = Marshal.AllocHGlobal(plain.Length);
        try
        {
            Marshal.Copy(plain, 0, ptr, plain.Length);
            input.cbData = plain.Length;
            input.pbData = ptr;

            if (!CryptProtectData(ref input, "Aurora", ref entropy, IntPtr.Zero, IntPtr.Zero,
                    CRYPTPROTECT_UI_FORBIDDEN, out output))
            {
                throw new IOException("DPAPI 加密失败：" + Marshal.GetLastWin32Error());
            }

            var result = new byte[output.cbData];
            Marshal.Copy(output.pbData, result, 0, output.cbData);
            return result;
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
            if (output.pbData != IntPtr.Zero) LocalFree(output.pbData);
        }
    }

    public static byte[] Unprotect(byte[] cipher)
    {
        var input = new DataBlob();
        var entropy = new DataBlob();
        var output = new DataBlob();
        var ptr = Marshal.AllocHGlobal(cipher.Length);
        try
        {
            Marshal.Copy(cipher, 0, ptr, cipher.Length);
            input.cbData = cipher.Length;
            input.pbData = ptr;

            if (!CryptUnprotectData(ref input, IntPtr.Zero, ref entropy, IntPtr.Zero, IntPtr.Zero,
                    CRYPTPROTECT_UI_FORBIDDEN, out output))
            {
                throw new IOException("DPAPI 解密失败：" + Marshal.GetLastWin32Error());
            }

            var result = new byte[output.cbData];
            Marshal.Copy(output.pbData, result, 0, output.cbData);
            return result;
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
            if (output.pbData != IntPtr.Zero) LocalFree(output.pbData);
        }
    }
}

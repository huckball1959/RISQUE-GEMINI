# Win32 helpers for RISQUE.ps1 dual-display launch: Chromium/Edge top-level windows, TV move, F11.
# Edge and Chrome use Chromium; top-level browser windows are class "Chrome_WidgetWin_1".

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class ChromiumWindowHelper {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern IntPtr GetParent(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    public static readonly IntPtr HWND_TOP = IntPtr.Zero;

    public static List<IntPtr> ListRootChromium() {
        var list = new List<IntPtr>();
        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;
            if (GetParent(hWnd) != IntPtr.Zero) return true;
            var sb = new StringBuilder(256);
            if (GetClassName(hWnd, sb, sb.Capacity) == 0) return true;
            if (sb.ToString() == "Chrome_WidgetWin_1") {
                list.Add(hWnd);
            }
            return true;
        }, IntPtr.Zero);
        return list;
    }

    public static bool MoveTo(IntPtr hWnd, int left, int top, int width, int height) {
        if (hWnd == IntPtr.Zero) return false;
        /* uFlags 0: apply X,Y,cx,cy (not SWP_NOMOVE | SWP_NOSIZE) */
        return SetWindowPos(hWnd, HWND_TOP, left, top, width, height, 0);
    }
}
'@

function Wait-RisqueNewChromiumWindow {
    param(
        [IntPtr[]]$BeforeHandles,
        [int]$TimeoutMs = 20000
    )
    $before = New-Object 'System.Collections.Generic.HashSet[System.IntPtr]'
    if ($BeforeHandles) {
        foreach ($h in $BeforeHandles) {
            if ($h -ne [IntPtr]::Zero) { [void]$before.Add($h) }
        }
    }
    $deadline = [Environment]::TickCount + $TimeoutMs
    while ([Environment]::TickCount -lt $deadline) {
        $now = [ChromiumWindowHelper]::ListRootChromium()
        foreach ($h in $now) {
            if (-not $before.Contains($h)) {
                return $h
            }
        }
        Start-Sleep -Milliseconds 200
    }
    return [IntPtr]::Zero
}

function Move-RisqueChromiumToRect {
    param(
        [IntPtr]$Handle,
        [int]$Left,
        [int]$Top,
        [int]$Width,
        [int]$Height
    )
    if ($Handle -eq [IntPtr]::Zero) { return }
    [void][ChromiumWindowHelper]::MoveTo($Handle, $Left, $Top, $Width, $Height)
}

try {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class RisqueFgWin {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
}
catch {
    /* type already loaded in this PowerShell session */
}

function Enter-RisqueChromiumF11Fullscreen {
    param([IntPtr]$Handle)
    if ($Handle -eq [IntPtr]::Zero) { return }
    [void][RisqueFgWin]::SetForegroundWindow($Handle)
    Start-Sleep -Milliseconds 450
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait("{F11}")
}

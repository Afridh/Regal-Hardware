# Hands a file to a printer exactly as it is (RAW): the label printer's own language (ZPL) goes
# straight to the Zebra, so Windows does not scale, centre or add margins to it.
#   print-raw.ps1 -Printer "ZDesigner ZD230-203dpi ZPL" -File C:\...\labels.zpl
param([Parameter(Mandatory = $true)][string]$Printer, [Parameter(Mandatory = $true)][string]$File, [string]$Name = 'Regal labels')
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RegalRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern int StartDocPrinter(IntPtr h, int level, DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int written);
  public static string Send(string printer, byte[] data, string doc) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "cannot open the printer (" + Marshal.GetLastWin32Error() + ")";
    try {
      var di = new DOCINFO { pDocName = doc, pDataType = "RAW" };
      if (StartDocPrinter(h, 1, di) == 0) return "the printer would not start (" + Marshal.GetLastWin32Error() + ")";
      StartPagePrinter(h); int w; bool ok = WritePrinter(h, data, data.Length, out w); EndPagePrinter(h); EndDocPrinter(h);
      return ok && w == data.Length ? "ok" : "only " + w + " of " + data.Length + " bytes went";
    } finally { ClosePrinter(h); }
  }
}
'@
$r = [RegalRaw]::Send($Printer, [System.IO.File]::ReadAllBytes($File), $Name)
if ($r -ne 'ok') { Write-Error $r; exit 1 }
Write-Output "sent $((Get-Item $File).Length) bytes to $Printer"

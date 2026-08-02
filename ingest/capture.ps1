<#
  Captures a single named window to a PNG.

    powershell -Sta -ExecutionPolicy Bypass -File ingest/capture.ps1 -Match "TradingView" -Out shot.png
    powershell -ExecutionPolicy Bypass -File ingest/capture.ps1 -List

  Uses PrintWindow rather than a screen-region grab, so the target does not have
  to be the foreground window and does not have to be unobscured.

  IT STILL NEEDS AN UNLOCKED, LOGGED-IN INTERACTIVE SESSION. There is no way
  around that: a scheduled task set to "run whether user is logged on or not"
  lands in session 0, which has no desktop, and every capture comes back black.
  A black or blank capture is worse than no capture, because OCR will happily
  read nothing out of it and report a quiet day.

  PERSONAL USE ONLY. See ingest/README.md.
#>
param(
  [string]$Match,
  [string]$Out,
  [switch]$List
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing | Out-Null
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Cap {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@

function Get-Candidates {
  Get-Process | Where-Object { $_.MainWindowTitle -ne '' -and $_.MainWindowHandle -ne 0 } |
    Select-Object Id, ProcessName, MainWindowTitle, MainWindowHandle
}

if ($List) {
  Get-Candidates | Sort-Object ProcessName | Format-Table -AutoSize | Out-String -Width 200
  exit 0
}

if (-not $Match -or -not $Out) { Write-Output 'ERR: -Match and -Out are both required'; exit 1 }

$hits = @(Get-Candidates | Where-Object { $_.MainWindowTitle -like "*$Match*" })
if ($hits.Count -eq 0) { Write-Output "ERR: no window title contains '$Match'"; exit 1 }
if ($hits.Count -gt 1) {
  # Ambiguity is a silent-wrong-capture waiting to happen: pick nothing.
  Write-Output "ERR: '$Match' matches $($hits.Count) windows: $(($hits | ForEach-Object { $_.MainWindowTitle }) -join ' | ')"
  exit 1
}

$h = $hits[0].MainWindowHandle
if ([Win32Cap]::IsIconic($h)) { Write-Output 'ERR: the window is minimised; PrintWindow returns blank for a minimised window'; exit 1 }
if (-not [Win32Cap]::IsWindowVisible($h)) { Write-Output 'ERR: the window is not visible'; exit 1 }

$r = New-Object Win32Cap+RECT
[void][Win32Cap]::GetWindowRect($h, [ref]$r)
$w = $r.R - $r.L; $ht = $r.B - $r.T
if ($w -le 0 -or $ht -le 0) { Write-Output 'ERR: the window has no usable size'; exit 1 }

$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc()
# 2 = PW_RENDERFULLCONTENT, required for windows that render with the GPU
# (Chromium, Electron); without it those come back as an empty frame.
$okFull = [Win32Cap]::PrintWindow($h, $dc, 2)
$g.ReleaseHdc($dc)
$g.Dispose()

# A capture that is a single flat colour is a failed capture, not a quiet
# market. Sample a grid and refuse if every pixel matches.
$distinct = @{}
for ($x = 0; $x -lt $w; $x += [Math]::Max(1, [int]($w / 32))) {
  for ($y = 0; $y -lt $ht; $y += [Math]::Max(1, [int]($ht / 32))) {
    $distinct[$bmp.GetPixel($x, $y).ToArgb()] = $true
    if ($distinct.Count -gt 3) { break }
  }
  if ($distinct.Count -gt 3) { break }
}
if ($distinct.Count -le 2) {
  $bmp.Dispose()
  Write-Output 'ERR: the capture is a flat image (blank or black) - the session is probably locked, or the window renders in a way PrintWindow cannot reach'
  exit 1
}

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Output "$Out"
Write-Output "INFO: captured '$($hits[0].MainWindowTitle)' at ${w}x${ht}, printWindow=$okFull"

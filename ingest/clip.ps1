<#
  Saves the image currently on the Windows clipboard to a PNG.

    powershell -Sta -ExecutionPolicy Bypass -File ingest/clip.ps1 -Out shot.png

  Exists so the daily loop is "Win+Shift+S, then run one command" — no saving a
  file by hand and no hunting for where it landed.

  Clipboard access needs a single-threaded apartment. powershell.exe is STA by
  default in 5.1 and the caller passes -Sta as well, so the work happens on the
  main thread. Do NOT try to marshal this onto a manually-created STA thread:
  a PowerShell scriptblock converted to a ThreadStart delegate has no runspace
  on that thread and fails silently, returning neither an image nor an error.
#>
param([Parameter(Mandatory = $true)][string]$Out)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -AssemblyName System.Drawing | Out-Null

# Reasons go to stdout on an ERR: line rather than through Write-Error. The
# caller then reports the cause verbatim instead of parsing PowerShell's error
# formatting, which wraps mid-sentence and mangles non-ASCII on the console.
function Fail($msg) { Write-Output "ERR: $msg"; exit 1 }

if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
  Fail 'clipboard access needs an STA thread; re-run with powershell -Sta'
}

if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) {
  Fail 'there is no image on the clipboard'
}

$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($null -eq $img) { Fail 'the clipboard reported an image but returned nothing' }

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$img.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$img.Dispose()
Write-Output $Out

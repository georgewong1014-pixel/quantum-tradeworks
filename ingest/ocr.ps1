<#
  Image -> text, using the OCR engine built into Windows.

  No install and no dependency: Windows.Media.Ocr ships with Windows 10/11.

    powershell -ExecutionPolicy Bypass -File ingest/ocr.ps1 -Path shot.png
    powershell -ExecutionPolicy Bypass -File ingest/ocr.ps1 -Path shot.png -Lines

  PERSONAL USE ONLY. This reads pixels you are entitled to look at. It does not
  grant any right to redistribute what it recognises. See ingest/README.md.
#>
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [switch]$Lines
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path)) { Write-Error "no such file: $Path"; exit 1 }
$full = (Resolve-Path -LiteralPath $Path).ProviderPath

Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

# WinRT async methods return IAsyncOperation, which PowerShell cannot await
# directly. This pulls the generic AsTask extension out by reflection and
# blocks on the resulting Task.
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($op, $type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}

# Row icons in a watchlist come back as glyphs from the private-use area and as
# raw control characters. ConvertTo-Json emits those unescaped, which makes the
# whole payload invalid and kills the run over a single bullet. Filter by code
# point rather than by regex: this file gets read back as ANSI on some consoles,
# and a literal high character in a pattern corrupts it.
function Clean([string]$s) {
  if (-not $s) { return '' }
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $s.ToCharArray()) {
    $c = [int][char]$ch
    if ($c -lt 32) { continue }                        # C0 controls
    if ($c -eq 127) { continue }                       # DEL
    if ($c -ge 128 -and $c -le 159) { continue }       # C1 controls
    if ($c -ge 57344 -and $c -le 63743) { continue }   # private use area (icons)
    if ($c -eq 65533) { continue }                     # replacement character
    [void]$sb.Append($ch)
  }
  return $sb.ToString().Trim()
}

[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]              | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]  | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]           | Out-Null

$file    = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($full)) ([Windows.Storage.StorageFile])
$stream  = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap  = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { Write-Error 'no OCR language pack available'; exit 1 }

$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

if ($Lines) {
  # Word-level boxes, not lines. A watchlist is a table: the OCR engine's own
  # line grouping is unreliable across widely-spaced columns, so emit the words
  # with their geometry and let the caller reconstruct rows.
  $out = New-Object System.Collections.ArrayList
  foreach ($line in $result.Lines) {
    foreach ($w in $line.Words) {
      $t = Clean $w.Text
      if (-not $t) { continue }
      $r = $w.BoundingRect
      [void]$out.Add([pscustomobject]@{
        text = $t
        top  = [math]::Round($r.Top, 1)
        left = [math]::Round($r.Left, 1)
        # Width matters: it is the only way to tell a thousands separator split
        # across two words ("4," + "643") from two genuinely separate numbers.
        w    = [math]::Round($r.Width, 1)
        h    = [math]::Round($r.Height, 1)
      })
    }
  }
  # ConvertTo-Json unwraps a single-element array; force brackets either way.
  $json = $out | ConvertTo-Json -Compress -Depth 3
  if ($null -eq $json) { $json = '[]' }
  if ($json -notmatch '^\s*\[') { $json = "[$json]" }
  Write-Output $json
} else {
  Clean $result.Text
}

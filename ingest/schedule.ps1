<#
  Registers (or removes) the daily price run as a Windows scheduled task.

    powershell -ExecutionPolicy Bypass -File ingest/schedule.ps1 `
      -Url "https://www.tradingview.com/watchlists/XXXXXXXX/" -At 18:30

    powershell -ExecutionPolicy Bypass -File ingest/schedule.ps1 -Remove
    powershell -ExecutionPolicy Bypass -File ingest/schedule.ps1 -Status
    powershell -ExecutionPolicy Bypass -File ingest/schedule.ps1 -RunNow

  The capture is headless and drives its own browser profile, so this does NOT
  need the screen unlocked and does not disturb whatever you are doing. It does
  need the machine awake -- a sleeping machine runs nothing, which is why the
  task is registered to wake it and to catch up on a missed start.
#>
param(
  [string]$Url,
  [string]$At = '18:30',
  [string]$TaskName = 'QuantumTradeworks-DailyPrices',
  [switch]$Remove,
  [switch]$Status,
  [switch]$RunNow,
  [switch]$WhenLoggedOff
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -EA SilentlyContinue
  Write-Output "removed: $TaskName"
  exit 0
}

if ($Status -or $RunNow) {
  $t = Get-ScheduledTask -TaskName $TaskName -EA SilentlyContinue
  if (-not $t) { Write-Output "not registered: $TaskName"; exit 1 }
  if ($RunNow) { Start-ScheduledTask -TaskName $TaskName; Write-Output 'started'; Start-Sleep -Seconds 3 }
  $i = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Output "task        : $TaskName"
  Write-Output "state       : $($t.State)"
  Write-Output "last run    : $($i.LastRunTime)"
  # 0 clean, 1 nothing imported, 2 needs your eyes. 267009 means "running now".
  Write-Output "last result : $($i.LastTaskResult)   (0 clean, 1 nothing imported, 2 needs review)"
  Write-Output "next run    : $($i.NextRunTime)"
  $report = Join-Path $repo 'data\daily-report.txt'
  if (Test-Path $report) { Write-Output ''; Write-Output '--- last report ---'; Get-Content $report }
  exit 0
}

if (-not $Url) { Write-Error 'give -Url "<your watchlist url>" (or use -Remove / -Status / -RunNow)'; exit 1 }

$node = (Get-Command node -EA SilentlyContinue).Source
if (-not $node) { Write-Error 'node is not on PATH for this account'; exit 1 }

# -NoProfile so a slow or interactive PowerShell profile cannot hang the run.
$action = New-ScheduledTaskAction -Execute $node `
  -Argument "ingest/daily.mjs --url `"$Url`"" -WorkingDirectory $repo

$trigger = New-ScheduledTaskTrigger -Daily -At $At

# StartWhenAvailable catches up if the machine was off at $At.
# WakeToRun matters more than it looks: a sleeping machine runs nothing, and a
# task that never fires is indistinguishable from a market that never moved.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew

# Interactive by default because it registers WITHOUT elevation and the capture
# is headless, so it needs no desktop -- only that you are signed in. S4U would
# also run while signed out, but registering it requires an elevated shell, and
# an install step that fails with "Access is denied" is a worse default than one
# that just works.
$logon = if ($WhenLoggedOff) { 'S4U' } else { 'Interactive' }
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType $logon -RunLevel Limited

try {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force -EA Stop | Out-Null
} catch {
  if ($WhenLoggedOff) {
    Write-Error "Could not register: $($_.Exception.Message)`n`n-WhenLoggedOff uses S4U, which needs an elevated PowerShell. Either run this from an Administrator prompt, or drop the switch to register a task that runs while you are signed in."
  } else {
    Write-Error "Could not register: $($_.Exception.Message)"
  }
  exit 1
}

Write-Output "registered  : $TaskName"
Write-Output "runs        : daily at $At"
Write-Output "working dir : $repo"
Write-Output "url         : $Url"
Write-Output ''
Write-Output 'Check it with:'
Write-Output "  powershell -ExecutionPolicy Bypass -File ingest/schedule.ps1 -Status"
Write-Output "  powershell -ExecutionPolicy Bypass -File ingest/schedule.ps1 -RunNow"

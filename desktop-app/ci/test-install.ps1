# Install like a student would (silent, no admin), check icons + Settings › Apps, then self-test the installed app. Never fails the build.
$ErrorActionPreference = 'Continue'
$out = Join-Path $PWD 'selftest\installed'
New-Item -ItemType Directory -Force $out | Out-Null
$r = New-Object System.Collections.Generic.List[string]
try {
  $setup = Get-ChildItem 'desktop-app\dist\RankerNode-Setup-*.exe' | Select-Object -First 1
  $r.Add("info  installer $($setup.Name) — $([math]::Round($setup.Length / 1MB, 1)) MB")
  $t = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process -FilePath $setup.FullName -ArgumentList '/S' -PassThru
  if ($p.WaitForExit(240000)) { $r.Add("PASS  installer finishes without admin rights — $([math]::Round($t.Elapsed.TotalSeconds,1)) s, exit $($p.ExitCode)") }
  else { $r.Add('FAIL  installer finishes without admin rights — timed out') }
  Start-Sleep -Seconds 3
  Get-Process -Name RankerNode -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  $exe = Get-ChildItem "$env:LOCALAPPDATA\Programs" -Recurse -Filter 'RankerNode.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($exe) { $r.Add("PASS  installed to $($exe.FullName)") } else { $r.Add('FAIL  installed app not found under %LOCALAPPDATA%\Programs') }
  $desk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'RankerNode.lnk'
  if (Test-Path $desk) { $r.Add('PASS  desktop icon created') } else { $r.Add("FAIL  desktop icon created — missing $desk") }
  $start = Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Recurse -Filter 'RankerNode.lnk' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($start) { $r.Add('PASS  Start-menu entry created') } else { $r.Add('FAIL  Start-menu entry created') }
  $un = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'RankerNode*' } | Select-Object -First 1
  if ($un) { $r.Add("PASS  listed in Settings › Apps as '$($un.DisplayName)' $($un.DisplayVersion) by $($un.Publisher)") } else { $r.Add('FAIL  listed in Settings › Apps') }
  if (Test-Path 'HKCU:\Software\Classes\rankernode') { $r.Add('PASS  rankernode:// links registered') } else { $r.Add('info  rankernode:// links not registered by the installer') }
  if ($exe) {
    $p2 = Start-Process -FilePath $exe.FullName -ArgumentList "--aero-selftest=$out" -PassThru
    if (-not $p2.WaitForExit(240000)) { Stop-Process -Id $p2.Id -Force; $r.Add('FAIL  installed app self-test finished in time') }
  }
} catch { $r.Add("FAIL  install test ran — $($_.Exception.Message)") }
$r | Set-Content "$out\install-report.txt"
Get-Content "$out\install-report.txt"
if (Test-Path "$out\report.txt") { Get-Content "$out\report.txt" }
exit 0

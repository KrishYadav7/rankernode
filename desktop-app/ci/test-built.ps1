# Self-test of the freshly built app (dist/win-unpacked). Never fails the build.
$ErrorActionPreference = 'Continue'
$out = Join-Path $PWD 'selftest\built'
New-Item -ItemType Directory -Force $out | Out-Null
try {
  $p = Start-Process -FilePath 'desktop-app\dist\win-unpacked\RankerNode.exe' -ArgumentList "--aero-selftest=$out" -PassThru
  if (-not $p.WaitForExit(240000)) { Stop-Process -Id $p.Id -Force; Add-Content "$out\report.txt" 'FAIL  app finished in time — killed after 240 s' }
} catch { Add-Content "$out\report.txt" "FAIL  app starts — $($_.Exception.Message)" }
if (-not (Test-Path "$out\report.txt")) { Set-Content "$out\report.txt" 'FAIL  no report written (app did not start?)' }
Get-Content "$out\report.txt"
exit 0

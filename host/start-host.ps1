# 守护循环：宿主崩溃后 2 秒自动重启
Set-Location $PSScriptRoot
while ($true) {
  node src\index.js
  Start-Sleep -Seconds 2
}

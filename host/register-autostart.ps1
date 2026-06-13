# 注册登录时自动启动（隐藏窗口运行守护循环）
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSScriptRoot\start-host.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "ClaudeSessionHost" -Action $action -Trigger $trigger `
  -Description "Claude Remote 会话宿主" -Force
Write-Host "已注册开机自启任务 ClaudeSessionHost。立即启动：Start-ScheduledTask -TaskName ClaudeSessionHost"

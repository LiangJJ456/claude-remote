# cc —— 通过会话宿主启动/附身 Claude Code 会话
# 用法：cc            在当前目录新建会话
#       cc -Name foo  新建并命名
#       cc -Attach <sessionId>  附身已有会话
param(
  [string]$Name = "",
  [string]$Attach = ""
)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Attach) {
  node "$here\attach-client.js" --attach $Attach
} else {
  $argv = @("$here\attach-client.js", "--cwd", (Get-Location).Path)
  if ($Name) { $argv += @("--name", $Name) }
  node @argv
}

#!/usr/bin/env sh
# cc —— 通过会话宿主启动/附身 Claude Code 会话（POSIX 版，对应 cc.ps1）
# 用法：cc                 在当前目录新建会话
#       cc --name foo      新建并命名
#       cc --attach <id>   附身已有会话
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$here/attach-client.js" --cwd "$PWD" "$@"

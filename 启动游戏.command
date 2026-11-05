#!/bin/zsh
cd "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  print '请先安装 Node.js 22 或更新版本：https://nodejs.org/'
  read -k 1 '?按任意键退出。'
  exit 1
fi
export OPEN_BROWSER=1
exec node server.cjs

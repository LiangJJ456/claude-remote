'use strict';
// 手动触发一次 cc 注册（与宿主启动时做的事一致）。平时不用跑——宿主一起来就会自动注册。
const path = require('path');
const { registerCcOnStartup } = require('../src/cc-register');
registerCcOnStartup({
  winScript: path.join(__dirname, '..', 'bin', 'cc.ps1'),
  posixScript: path.join(__dirname, '..', 'bin', 'cc.sh'),
});

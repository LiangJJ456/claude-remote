'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = {
  port: 8787,
  bufferLimit: 1024 * 1024,
  claudeCommand: 'claude',
  claudeArgs: [],
};

function loadConfig(dataDir) {
  const file = path.join(dataDir, 'config.json');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dataDir, { recursive: true });
    const cfg = { ...DEFAULTS, token: crypto.randomBytes(32).toString('hex') };
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
    return cfg;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to parse config file ${file}: ${e.message}`);
  }
  const cfg = { ...DEFAULTS, ...parsed };
  if (typeof cfg.token !== 'string' || cfg.token.length === 0) {
    cfg.token = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  }
  return cfg;
}

module.exports = { loadConfig };

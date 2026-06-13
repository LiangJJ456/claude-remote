'use strict';
const os = require('os');

function isTailscaleIPv4(address) {
  const parts = address.split('.').map(Number);
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function getBindAddresses(interfaces = os.networkInterfaces()) {
  const addrs = ['127.0.0.1'];
  for (const list of Object.values(interfaces)) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && isTailscaleIPv4(iface.address)) {
        addrs.push(iface.address);
      }
    }
  }
  return addrs;
}

module.exports = { getBindAddresses, isTailscaleIPv4 };

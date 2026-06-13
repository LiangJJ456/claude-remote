'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { getBindAddresses, isTailscaleIPv4 } = require('../src/net');

test('识别 Tailscale CGNAT 地址（100.64.0.0/10）', () => {
  assert.ok(isTailscaleIPv4('100.64.0.1'));
  assert.ok(isTailscaleIPv4('100.101.102.103'));
  assert.ok(isTailscaleIPv4('100.127.255.254'));
  assert.ok(!isTailscaleIPv4('100.63.0.1'));
  assert.ok(!isTailscaleIPv4('100.128.0.1'));
  assert.ok(!isTailscaleIPv4('192.168.1.2'));
});

test('从接口列表提取绑定地址：loopback 永远在，Tailscale 有则加', () => {
  const fake = {
    Loopback: [{ family: 'IPv4', address: '127.0.0.1' }],
    Ethernet: [{ family: 'IPv4', address: '192.168.1.5' }],
    Tailscale: [
      { family: 'IPv4', address: '100.80.1.2' },
      { family: 'IPv6', address: 'fd7a::1' },
    ],
  };
  assert.deepStrictEqual(getBindAddresses(fake), ['127.0.0.1', '100.80.1.2']);
});

test('没有 Tailscale 接口时只绑 loopback', () => {
  const fake = { Ethernet: [{ family: 'IPv4', address: '192.168.1.5' }] };
  assert.deepStrictEqual(getBindAddresses(fake), ['127.0.0.1']);
});

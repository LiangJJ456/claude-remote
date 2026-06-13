'use strict';

function waitFor(fn, timeout = 15000, interval = 50) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (fn()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeout) {
        clearInterval(timer);
        reject(new Error('waitFor 超时'));
      }
    }, interval);
  });
}

module.exports = { waitFor };

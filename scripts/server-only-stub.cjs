const Module = require('module');

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (request === 'server-only' || request === 'client-only') {
    return require.resolve('./server-only-stub.cjs');
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};

module.exports = {};

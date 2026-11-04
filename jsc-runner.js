/*
 * jsc-runner.js — runs test.js with the JavaScriptCore CLI on machines
 * that do not have Node installed.
 *
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc \
 *     thyroid-ultrasound-report/jsc-runner.js
 *
 * (With Node installed, simply use: node test.js)
 */
(function () {
  'use strict';

  // Directory of this file (both files live together).
  var __DIR = (typeof arguments !== 'undefined' && arguments.length > 1)
    ? arguments[1].replace(/\/[^/]+$/, '')   // optional: <script> <dir>
    : '/Users/NathanMBP/.cline/data/workspaces/chat/thyroid-ultrasound-report';

  var g = Function('return this')();
  g.global = g;
  var __exitCode = 0;

  var __cache = {};
  function require(p) {
    var file = p.charAt(0) === '.' ? __DIR + p.replace(/^\.\//, '/') : p;
    if (__cache[file]) return __cache[file].exports;
    var src = readFile(file);
    if (src === null) throw new Error('cannot read ' + file);
    var m = { exports: {} };
    __cache[file] = m;
    var fn = new Function('module', 'exports', 'require', '__filename', '__dirname', src);
    fn(m, m.exports, require, file, __DIR);
    return m.exports;
  }
  g.require = require;
  g.console = { log: print, error: print, warn: print, info: print };
  g.process = { exit: function (code) { __exitCode = code || 0; throw new Error('__exit__' + code); } };

  var script = (typeof arguments !== 'undefined' && arguments.length > 0 && arguments[0])
    ? arguments[0]
    : __DIR + '/test.js';
  if (script.charAt(0) !== '/') script = __DIR + '/' + script;

  try {
    load(script);
    print('Exited with code ' + __exitCode);
    quit(__exitCode);
  } catch (e) {
    if (String(e).indexOf('__exit__') !== -1) {
      print('Exited with code ' + __exitCode);
      quit(__exitCode);
    }
    throw e;
  }
})();

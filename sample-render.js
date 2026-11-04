/* sample-render.js — pretty-prints a complete sample report (run: jsc sample-render.js) */
(function () {
  var g = Function('return this')();
  g.global = g;
  var __DIR = '/Users/NathanMBP/.cline/data/workspaces/chat/thyroid-ultrasound-report/';
  var __cache = {};
  function require(p) {
    var file = __DIR + p.replace(/^\.\//, '');
    if (__cache[file]) return __cache[file].exports;
    var m = { exports: {} };
    __cache[file] = m;
    var src = read(file);
    var fn = new Function('module', 'exports', 'require', '__filename', '__dirname', src);
    fn(m, m.exports, require, file, __DIR);
    return m.exports;
  }
  g.require = require;
  var R = require('./report.js');
  var st = {
    study: { date: '2026-10-30', physician: 'J. Smith, MD', operator: 'A. Doe, RDMS', priorUsDate: '2025-03-12', indication: 'Follow-up thyroid nodules' },
    thyroid: { rightLobe: ['4.2', '2.1', '1.8'], leftLobe: ['4.6', '2.3', '2.0'], isthmus: '0.5', chars: ['heterogenous', 'normalVascularity'] },
    nodules: [
      { lobe: 'right', vertical: 'superior', depth: 'anterior', dims: ['2.1', '1.4', '1.8'], composition: 'solid', echogenicity: 'veryHypo', shape: 'taller', margin: 'lobulated', foci: ['punctate'], interval: 'increased', vascularity: '2', parathyroid: false },
      { lobe: 'left', vertical: 'middle', depth: 'anterior', dims: ['0.8', '0.5', '0.6'], composition: 'spongiform', echogenicity: 'anechoic', shape: 'wider', margin: 'smooth', foci: ['cometTail'], interval: 'stable', vascularity: 'none', parathyroid: false }
    ],
    lymphNodes: [{ side: 'right', compartment: 'IV', size: '1.2', findings: ['hilum', 'cystic'] }],
    freeText: 'I recommend surgical referral.',
    settings: Object.assign({}, R.DEFAULT_SETTINGS)
  };
  print(R.renderReport(st));
})();

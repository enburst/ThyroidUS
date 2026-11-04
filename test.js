/*
 * test.js — test suite for the TI-RADS engine and report renderer.
 * Run: node test.js   (or jsc jsc-runner.js on machines without Node)
 */
'use strict';
var T = require('./tirads.js');
var R = require('./report.js');

var passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL: ' + msg); }
}
function section(text, start, end) {
  var i = text.indexOf(start), j = end ? text.indexOf(end) : text.length;
  return i === -1 ? '' : text.slice(i, j === -1 ? text.length : j);
}

function N(o) {
  return Object.assign({
    lobe: 'right', vertical: 'middle', depth: 'anterior',
    dims: ['', '', ''],
    composition: 'solid', echogenicity: 'hypo', shape: 'wider', margin: 'smooth',
    foci: ['none'], interval: 'none', vascularity: '', isthmus: false, parathyroid: false
  }, o);
}

console.log('# tirads.js');

ok(T.trLevelForPoints(0) === 'TR1', '0 -> TR1');
ok(T.trLevelForPoints(1) === 'TR2', '1 -> TR2');
ok(T.trLevelForPoints(2) === 'TR2', '2 -> TR2');
ok(T.trLevelForPoints(3) === 'TR3', '3 -> TR3');
ok(T.trLevelForPoints(4) === 'TR4', '4 -> TR4');
ok(T.trLevelForPoints(6) === 'TR4', '6 -> TR4');
ok(T.trLevelForPoints(7) === 'TR5', '7 -> TR5');
ok(T.trLevelForPoints(13) === 'TR5', '13 -> TR5');

var spong = T.scoreNodule(N({ composition: 'spongiform', echogenicity: 'veryHypo', shape: 'taller', margin: 'lobulated', foci: ['punctate'] }));
ok(spong.level === 'TR1' && spong.autoTr1 === true && spong.points === 0, 'spongiform is auto-TR1, 0 points');
ok(spong.breakdown.length === 1 && spong.breakdown[0].label === 'spongiform', 'spongiform breakdown is composition only');
ok(T.scoreNodule(N({ composition: 'cystic', echogenicity: 'hypo' })).level === 'TR1', 'cystic is auto-TR1');
ok(T.scoreNodule(N()).points === 4 && T.scoreNodule(N()).level === 'TR4', 'solid+hypo = 4 -> TR4');
ok(T.scoreNodule(N({ composition: 'mixed', echogenicity: 'anechoic' })).points === 1 && T.scoreNodule(N({ composition: 'mixed', echogenicity: 'anechoic' })).level === 'TR2', '1 point -> TR2');

var hyp = T.scoreNodule(N({ composition: 'mixed', echogenicity: 'hyper' }));
ok(hyp.level === 'TR2' && hyp.breakdown.some(function (b) { return b.label === 'hyperechoic' && b.points === 1; }), 'hyperechoic is separate, 1 pt');
var iso = T.scoreNodule(N({ composition: 'mixed', echogenicity: 'iso' }));
ok(iso.level === 'TR2' && iso.breakdown.some(function (b) { return b.label === 'isoechoic' && b.points === 1; }), 'isoechoic is separate, 1 pt');

var multiFoci = T.scoreNodule(N({ echogenicity: 'hypo', foci: ['macro', 'punctate'] }));
ok(multiFoci.points === 2 + 2 + 1 + 3 && multiFoci.level === 'TR5', 'foci are summed (2+2+1+3=8 -> TR5)');

function recN(bits, sizeCm) {
  var n = N(bits);
  n.dims = [String(sizeCm), '0.1', '0.1'];
  return T.recommendation(n, 'cm');
}
var TR3 = { composition: 'mixed', echogenicity: 'hypo' };
ok(recN(TR3, 1.4).action === 'none', 'TR3 1.4cm -> none');
ok(recN(TR3, 1.5).action === 'follow-up', 'TR3 1.5cm -> follow-up');
ok(recN(TR3, 2.5).action === 'fna', 'TR3 2.5cm -> FNA');
var TR4 = { composition: 'solid', echogenicity: 'hypo', foci: ['macro'] };
ok(recN(TR4, 1.0).action === 'follow-up', 'TR4 1.0cm -> follow-up');
ok(recN(TR4, 1.5).action === 'fna', 'TR4 1.5cm -> FNA');
var TR5 = { composition: 'solid', echogenicity: 'veryHypo', shape: 'taller', margin: 'lobulated', foci: ['punctate'] };
ok(recN(TR5, 0.5).action === 'follow-up', 'TR5 0.5cm -> follow-up');
ok(recN(TR5, 1.0).action === 'fna', 'TR5 1.0cm -> FNA');
ok(recN({ composition: 'cystic' }, 5).action === 'none', 'TR1 5cm -> none');
ok(recN({ composition: 'mixed', echogenicity: 'anechoic' }, 10).action === 'none', 'TR2 10cm -> none');

var mmN = N({ composition: 'solid', echogenicity: 'hypo', foci: ['macro'], dims: ['15', '14', '10'] });
ok(T.recommendation(mmN, 'mm').action === 'fna', 'mm dims convert to cm for thresholds (15mm=1.5cm -> FNA)');

function sized(bits, maxCm) {
  var n = N(bits);
  n.dims = [String(maxCm), '0.5', '0.5'];
  return n;
}
var tie = [sized(TR4, 1.2), sized(TR4, 2.2)];
var tieSorted = T.sortNodules(tie, 'cm');
ok(tieSorted[0] === tie[1], 'tie on score -> larger nodule first');
var pool = [sized({ composition: 'cystic' }, 4.0), sized({ composition: 'solid' }, 2.0), sized(TR3, 1.6), sized(TR4, 1.8), sized(TR5, 0.9)];
ok(T.sortNodules(pool, 'cm')[0] === pool[4], 'highest score sorts first');

console.log('# report.js');

var sampleState = {
  study: {
    date: '2026-10-30', physician: 'J. Smith, MD', operator: 'A. Doe, RDMS',
    patient: '', mrn: '', dob: '', priorUsDate: '2025-03-12', indication: 'palpable thyroid nodule'
  },
  thyroid: {
    rightLobe: ['4.2', '2.1', '1.8'], leftLobe: ['4.6', '2.3', '2.0'], isthmus: '0.5',
    chars: ['heterogenous', 'normalVascularity']
  },
  nodules: [
    N({ lobe: 'right', vertical: 'superior', dims: ['2.1', '1.4', '1.8'], echogenicity: 'veryHypo', shape: 'taller', margin: 'lobulated', foci: ['punctate'], interval: 'increased' }),
    N({ lobe: 'left', vertical: 'middle', dims: ['0.8', '0.5', '0.6'], composition: 'spongiform', echogenicity: 'anechoic' })
  ],
  lymphNodes: [],
  freeText: '',
  settings: Object.assign({}, R.DEFAULT_SETTINGS, { includeNoduleSummary: true, includeLymphNodeSummary: true })
};

var rpt = R.renderReport(sampleState);
ok(rpt.indexOf('THYROID ULTRASOUND') === 0, 'title is first line');
ok(rpt.indexOf('Date: 10/30/2026') !== -1, 'date formatted');
ok(rpt.indexOf('Physician diagnostician: J. Smith, MD') !== -1, 'physician line');
ok(rpt.indexOf('Ultrasound operator: A. Doe, RDMS') !== -1, 'operator line');
ok(rpt.indexOf('Indication: palpable thyroid nodule') !== -1, 'indication line');
ok(rpt.indexOf('Patient:') === -1, 'patient line hidden when setting off');
ok(rpt.indexOf('Prior study: thyroid ultrasound 03/12/2025') !== -1, 'prior study line');

ok(rpt.indexOf('All measurements are in centimeters (cm) and are listed in the order: longitudinal \u00D7 anteroposterior \u00D7 transverse (L \u00D7 AP \u00D7 T).') !== -1, 'measurement note at top');

ok(rpt.indexOf('The right lobe measures 4.2 \u00D7 2.1 \u00D7 1.8, the left lobe measures 4.6 \u00D7 2.3 \u00D7 2.0, and the isthmus measures 0.5.') !== -1, 'gland size sentence');
ok(rpt.indexOf('The gland is heterogenous with normal vascularity.') !== -1, 'gland characteristics sentence');

var nsec = section(rpt, 'NODULES', 'LYMPH NODES');
ok(nsec.indexOf('- 1 (TR5) Right, superior, anterior (2.1 \u00D7 1.4 \u00D7 1.8) increased in size compared to the prior ultrasound of 03/12/2025. (solid 2, very hypoechoic 3, taller-than-wide 3, lobulated 2, punctate echogenic foci 3)') !== -1, 'nodule line: number, TR, location, size, interval, breakdown');
ok(nsec.indexOf('- 2 (TR1) Left, middle, anterior (0.8 \u00D7 0.5 \u00D7 0.6). (spongiform 0)') !== -1, 'second nodule line');
ok(!/fna|biopsy|follow-up/i.test(nsec), 'no recommendations in the nodule section');

var isec = section(rpt, 'IMPRESSION', 'This report was drafted');
ok(isec.indexOf('The gland is heterogenous with normal vascularity.') === 0 || isec.indexOf('\nThe gland is heterogenous with normal vascularity.') !== -1, 'impression starts with gland statement');
ok(isec.indexOf('1 2.1 cm (TR5) right, superior, anterior') !== -1, 'compact impression nodule line 1');
ok(isec.indexOf('2 0.8 cm (TR1) left, middle, anterior') !== -1, 'compact impression nodule line 2');
ok(isec.indexOf('The following nodules meet ACR TI-RADS criteria for biopsy if not previously performed:') !== -1, 'biopsy block');
ok(isec.indexOf('\u2022 1: 2.1 cm, TR5') !== -1, 'biopsy list entry');
ok(rpt.indexOf(R.LN_DEFAULT) !== -1, 'default lymph node line present');

var html = R.renderReportHtml(sampleState);
ok(html.indexOf('class="f-tr5"') !== -1, 'html: TR5 colored segment');
ok(html.indexOf('<b><u>NODULES</u></b>') !== -1, 'html: section header bold + underlined');
ok(html.indexOf('<span class="f-title">THYROID ULTRASOUND</span>') !== -1, 'html: title styled');

// per-location numbering (Right / Isthmus / Left groups)
var sLoc = JSON.parse(JSON.stringify(sampleState));
sLoc.settings.numberingScheme = 'byLocation';
var rLoc = R.renderReport(sLoc);
ok(rLoc.indexOf('Right 1 (TR5) superior, anterior (2.1 \u00D7 1.4 \u00D7 1.8)') !== -1, 'per-location: group prefix before number, lobe dropped from location');
ok(rLoc.indexOf('Left 1 (TR1) middle, anterior (0.8 \u00D7 0.5 \u00D7 0.6)') !== -1, 'per-location: counter restarts per lobe');
ok(rLoc.indexOf('Right 1 2.1 cm (TR5) superior, anterior') !== -1, 'per-location impression reference');
ok(rLoc.indexOf('\u2022 Right 1: 2.1 cm, TR5') !== -1, 'per-location biopsy entry');

// right/left-only scheme: isthmus is a position flag; the nodule keeps its lobe label
var sLobe = JSON.parse(JSON.stringify(sampleState));
sLobe.settings.numberingScheme = 'byLobe';
sLobe.nodules.push(N({ lobe: 'left', vertical: 'superior', isthmus: true, depth: '', dims: ['0.9', '0.6', '0.5'], composition: 'spongiform', echogenicity: 'anechoic' }));
var rLobe = R.renderReport(sLobe);
var lobeSec = section(rLobe, 'NODULES', 'LYMPH NODES');
ok(lobeSec.indexOf('Left 1 (TR1) superior, isthmus (0.9 \u00D7 0.6 \u00D7 0.5)') !== -1, 'byLobe: isthmus prints in the position slot, lobe label stays Left');
ok(lobeSec.indexOf('Isthmus 1') === -1, 'byLobe: no separate Isthmus group');
ok(lobeSec.indexOf('Left 2 (TR1) middle, anterior (0.8 \u00D7 0.5 \u00D7 0.6)') !== -1, 'byLobe: per-lobe counter continues for the lobe');

// legacy v4 by-lobesaved state (isthmus stored as the lobe) still labels Left/Right
var sLobe2 = JSON.parse(JSON.stringify(sampleState));
sLobe2.settings.numberingScheme = 'byLobe';
sLobe2.nodules[0].lobe = 'isthmus';
ok(R.renderReport(sLobe2).indexOf('Left 1 (TR5) superior, isthmus, anterior') !== -1, 'byLobe: legacy isthmus lobe falls back to Left with isthmus position');

// list order: right (sup -> mid -> inf), then isthmus, then left (sup -> mid -> inf)
var sOrd = JSON.parse(JSON.stringify(sampleState));
sOrd.nodules = [
  N({ lobe: 'left', vertical: 'middle', dims: ['1', '1', '1'] }),
  N({ lobe: 'isthmus', vertical: 'middle', dims: ['1', '1', '1'], composition: 'mixed', echogenicity: 'iso' }),
  N({ vertical: 'inferior', dims: ['1', '1', '1'] }),
  N({ vertical: 'superior', dims: ['1', '1', '1'] }),
  N({ vertical: 'middle', dims: ['1', '1', '1'] })
];
var rOrd = R.renderReport(sOrd);
var oLines = section(rOrd, 'NODULES', 'LYMPH NODES').split('\n').filter(function (l) { return l.charAt(0) === '-'; });
ok(oLines.length === 5 &&
  oLines[0].indexOf('Right, superior') !== -1 && oLines[1].indexOf('Right, middle') !== -1 && oLines[2].indexOf('Right, inferior') !== -1 &&
  oLines[3].indexOf('Isthmus') !== -1 && oLines[4].indexOf('Left, middle') !== -1,
  'global list ordered: right sup->mid->inf, then isthmus, then left');
ok(oLines[0].indexOf('- 1 ') === 0 && oLines[4].indexOf('- 5 ') === 0, 'numbering follows the location-ordered list');

// lymph node three-dimension measurement (configurable)
var sLn3 = JSON.parse(JSON.stringify(sampleState));
sLn3.settings.lnDims = '3d';
sLn3.lymphNodes = [{ side: 'right', compartment: 'IV', size: '1.2', dims: ['1.2', '0.8', '0.6'], findings: ['hilum'] }];
var rLn3 = R.renderReport(sLn3);
ok(rLn3.indexOf('- 1 Right, level IV (1.2 \u00D7 0.8 \u00D7 0.6 cm) loss of the fatty hilum.') !== -1, 'LN 3-dim line with unit');
ok(rLn3.indexOf('1 right level IV node, 1.2 \u00D7 0.8 \u00D7 0.6 cm, loss of the fatty hilum.') !== -1, 'LN 3-dim in impression');

// impression summaries are opt-in (default off)
var sImpOff = JSON.parse(JSON.stringify(sampleState));
sImpOff.settings.includeNoduleSummary = false;
sImpOff.settings.includeLymphNodeSummary = false;
sImpOff.lymphNodes = [{ side: 'right', compartment: 'IV', size: '1.2', findings: ['hilum'] }];
var impOff = section(R.renderReport(sImpOff), 'IMPRESSION', 'This report was drafted');
ok(impOff.indexOf('2.1 cm (TR5)') === -1, 'nodule summary removed when off');
ok(impOff.indexOf(R.LN_DEFAULT) === -1 && impOff.indexOf('level IV node') === -1, 'LN summary removed when off');
ok(impOff.indexOf('The gland is heterogenous with normal vascularity.') !== -1, 'gland statement still present when summaries off');

// no "two highest-scoring first" note (setting removed)
var sFna3 = JSON.parse(JSON.stringify(sampleState));
sFna3.nodules = [
  N({ lobe: 'right', dims: ['1.2', '1', '1'], composition: 'solid', echogenicity: 'veryHypo', shape: 'taller', margin: 'lobulated', foci: ['punctate'] }),
  N({ lobe: 'left', dims: ['1.1', '1', '1'], composition: 'solid', echogenicity: 'veryHypo', shape: 'taller', margin: 'lobulated', foci: ['punctate'] }),
  N({ lobe: 'right', dims: ['2.0', '1', '1'], composition: 'solid', echogenicity: 'hypo' })
];
var rFna3 = R.renderReport(sFna3);
ok((rFna3.match(/TR5/g) || []).length >= 6, 'three FNA-eligible nodules all listed');
ok(rFna3.indexOf('two highest-scoring') === -1, 'no top-two note anywhere in the report');

// html: hanging-indent classes + date subtitle marker
ok(html.indexOf('r-list-dash') !== -1, 'html: bulleted lines carry a hanging-indent class');
ok(html.indexOf('r-subtitle') !== -1, 'html: date line marked as subtitle');


// lymph nodes: one abnormal node with findings
var sLn = JSON.parse(JSON.stringify(sampleState));
sLn.lymphNodes = [{ side: 'right', compartment: 'IV', size: '1.2', findings: ['hilum', 'cystic'] }];
var rLn = R.renderReport(sLn);
ok(rLn.indexOf('- 1 Right, level IV (1.2 cm) loss of the fatty hilum, cystic change.') !== -1, 'lymph node line: side, compartment, size, findings');
var lnImp = section(rLn, 'IMPRESSION', 'This report was drafted');
ok(lnImp.indexOf('1 right level IV node, 1.2 cm, loss of the fatty hilum, cystic change.') !== -1, 'lymph node in impression');
ok(lnImp.indexOf(R.LN_DEFAULT) === -1, 'default LN sentence replaced when nodes present');
ok(section(rLn, 'LYMPH NODES', 'IMPRESSION').indexOf('- 1 Right, level IV (1.2 cm)') !== -1, 'LN single-dim line unchanged by default');

// impression free text
var sFree = JSON.parse(JSON.stringify(sampleState));
sFree.freeText = 'I recommend surgical referral.';
ok(R.renderReport(sFree).indexOf('I recommend surgical referral.') !== -1, 'free text appears in impression');
sFree.settings.includeFreeText = false;
ok(R.renderReport(sFree).indexOf('I recommend surgical referral.') === -1, 'free text toggle hides it');

// units + order flow into the report
var sMm = JSON.parse(JSON.stringify(sampleState));
sMm.settings.dimOrder = 'alt';
sMm.settings.unit = 'mm';
sMm.settings.decimals = 0;
sMm.nodules[0].dims = ['21', '14', '18'];
var rMm = R.renderReport(sMm);
ok(rMm.indexOf('All measurements are in millimeters (mm) and are listed in the order: anteroposterior \u00D7 transverse \u00D7 longitudinal (AP \u00D7 T \u00D7 L).') !== -1, 'note follows unit + order settings');
ok(rMm.indexOf('(14 \u00D7 18 \u00D7 21)') !== -1, 'nodule dims reformatted (mm, AP-T-L)');

// no cap on the number of nodules reported
var sFive = JSON.parse(JSON.stringify(sampleState));
sFive.nodules = [
  N({ dims: ['1', '1', '1'] }),
  N({ lobe: 'left', dims: ['1.1', '1', '1'] }),
  N({ lobe: 'left', vertical: 'inferior', dims: ['1.2', '1', '1'], composition: 'mixed', foci: ['cometTail'] }),
  N({ vertical: 'superior', dims: ['1.3', '1', '1'], echogenicity: 'veryHypo' }),
  N({ lobe: 'left', vertical: 'inferior', vertical: 'inferior', dims: ['1.4', '1', '1'], composition: 'solid', echogenicity: 'hypo', foci: ['macro'] })
];
var rFive = R.renderReport(sFive);
var fsec = section(rFive, 'NODULES', 'LYMPH NODES');
ok((fsec.match(/^- /gm) || []).length === 5, 'all five entered nodules are reported (no cap)');

// gland sentence variants
ok(R.glandSentence(['increasedVascularity']) === 'The gland has increased vascularity.', 'vasc-only gland sentence');
ok(R.glandSentence(['spTotal']) === 'The gland is s/p total thyroidectomy.', 's/p-only gland sentence');
ok(R.glandSentence(['nodular', 'increasedVascularity', 'spRight']) === 'The gland is nodular with increased vascularity, s/p right lobectomy.', 'combined gland sentence');

// patient line appears when the setting is on
var sPt = JSON.parse(JSON.stringify(sampleState));
sPt.settings.includePatient = true;
sPt.study.patient = 'John Doe'; sPt.study.mrn = '123456'; sPt.study.dob = '1950-01-02';
ok(R.renderReport(sPt).indexOf('Patient: John Doe  |  MRN: 123456  |  DOB: 01/02/1950') !== -1, 'patient/MRN/DOB line when setting on');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  try { process.exit(1); } catch (e) { throw new Error('__exit__' + 1); }
}


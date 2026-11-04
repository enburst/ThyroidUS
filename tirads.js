/*
 * tirads.js — ACR TI-RADS scoring & recommendation logic.
 * Pure (no DOM), usable in the browser and in Node (for tests).
 */
(function (global, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.TIRADS = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /*
   * Category definitions.
   *  label  — wording used in the report score breakdown
   *  ui     — wording used on the input buttons
   *  points — ACR TI-RADS points
   *  autoTr1 — spongiform / completely cystic nodules are automatically TR1
   */
  var CATEGORIES = {
    composition: {
      cystic:     { label: 'cystic', ui: 'Cystic', points: 0, autoTr1: true },
      spongiform: { label: 'spongiform', ui: 'Spongiform', points: 0, autoTr1: true },
      mixed:      { label: 'mixed cystic and solid', ui: 'Mixed cystic and solid', points: 1 },
      solid:      { label: 'solid', ui: 'Solid / almost completely solid', points: 2 }
    },
    echogenicity: {
      anechoic: { label: 'anechoic', ui: 'Anechoic', points: 0 },
      hyper:    { label: 'hyperechoic', ui: 'Hyperechoic', points: 1 },
      iso:      { label: 'isoechoic', ui: 'Isoechoic', points: 1 },
      hypo:     { label: 'hypoechoic', ui: 'Hypoechoic', points: 2 },
      veryHypo: { label: 'very hypoechoic', ui: 'Very hypoechoic', points: 3 }
    },
    shape: {
      wider:  { label: 'wider-than-tall', ui: 'Wider than tall', points: 0 },
      taller: { label: 'taller-than-wide', ui: 'Taller than wide', points: 3 }
    },
    margin: {
      smooth:          { label: 'smooth', ui: 'Smooth', points: 0 },
      illDefined:      { label: 'ill-defined', ui: 'Ill-defined', points: 0 },
      lobulated:       { label: 'lobulated', ui: 'Lobulated / irregular', points: 2 },
      extraThyroidal:  { label: 'extra-thyroidal extension', ui: 'Extra-thyroidal extension', points: 3 }
    },
    /* Multi-select: every selected finding is scored and summed (ACR lexicon). */
    foci: {
      none:       { label: 'no echogenic foci', ui: 'No echogenic foci', points: 0 },
      cometTail:  { label: 'comet-tail artifact', ui: 'Large comet-tail artifact', points: 0 },
      macro:      { label: 'macrocalcifications', ui: 'Macrocalcifications', points: 1 },
      peripheral: { label: 'peripheral/rim calcifications', ui: 'Peripheral / rim calcifications', points: 2 },
      punctate:   { label: 'punctate echogenic foci', ui: 'Punctate echogenic foci', points: 3 }
    }
  };

  var TR_DESCRIPTORS = {
    TR1: 'benign',
    TR2: 'not suspicious',
    TR3: 'mildly suspicious',
    TR4: 'moderately suspicious',
    TR5: 'highly suspicious'
  };

  var TR_RISK = { TR1: '0.3%', TR2: '1.5%', TR3: '4.8%', TR4: '9.1%', TR5: '35%' };

  var FNA_FOLLOWUP = {
    TR3: { fnaCm: 2.5, followCm: 1.5, followUp: 'follow-up ultrasound at 1, 3, and 5 years' },
    TR4: { fnaCm: 1.5, followCm: 1.0, followUp: 'follow-up ultrasound at 1, 2, 3, and 5 years' },
    TR5: { fnaCm: 1.0, followCm: 0.5, followUp: 'annual follow-up ultrasound for up to 5 years' }
  };

  function trLevelForPoints(points) {
    if (points <= 0) return 'TR1';
    if (points <= 2) return 'TR2';
    if (points === 3) return 'TR3';
    if (points <= 6) return 'TR4';
    return 'TR5';
  }

  /*
   * Score one nodule.
   * nodule: { composition, echogenicity, shape, margin, foci: [keys] }
   * Returns { points, level, descriptor, autoTr1, breakdown: [{label, points}] }
   */
  function scoreNodule(nodule) {
    var comp = CATEGORIES.composition[nodule.composition] || CATEGORIES.composition.solid;

    if (comp.autoTr1) {
      // Predominantly cystic / spongiform nodules are inherently benign:
      // automatically TR1, no further points added.
      return {
        points: 0,
        level: 'TR1',
        descriptor: TR_DESCRIPTORS.TR1,
        autoTr1: true,
        breakdown: [{ category: 'composition', label: comp.label, points: 0 }]
      };
    }

    var points = 0;
    var breakdown = [];

    function addCat(catName, multiple) {
      var opts = CATEGORIES[catName];
      var items = multiple
        ? (nodule[catName] || []).map(function (k) { return opts[k]; }).filter(Boolean)
        : [(opts[nodule[catName]] || opts[Object.keys(opts)[0]])];
      items.forEach(function (it) {
        points += it.points;
        breakdown.push({ category: catName, label: it.label, points: it.points });
      });
    }

    addCat('composition', false);
    addCat('echogenicity', false);
    addCat('shape', false);
    addCat('margin', false);
    addCat('foci', true);

    var level = trLevelForPoints(points);
    return {
      points: points,
      level: level,
      descriptor: TR_DESCRIPTORS[level],
      autoTr1: false,
      breakdown: breakdown
    };
  }

  function parseDim(value) {
    var n = parseFloat(String(value == null ? '' : value).replace(',', '.'));
    return isFinite(n) && n >= 0 ? n : null;
  }

  /* Largest dimension in centimeters (unit: 'cm' | 'mm'), or null. */
  function maxDimensionCm(nodule, unit) {
    var vals = (nodule.dims || []).map(parseDim).filter(function (v) { return v > 0; });
    if (!vals.length) return null;
    var m = Math.max.apply(null, vals);
    return unit === 'mm' ? m / 10 : m;
  }

  /*
   * FNA / follow-up recommendation for one nodule.
   * action: 'none' | 'fna' | 'follow-up'
   */
  function recommendation(nodule, unit) {
    var s = scoreNodule(nodule);
    var sizeCm = maxDimensionCm(nodule, unit);
    var rec = { level: s.level, sizeCm: sizeCm, action: 'none', followUp: null, text: '' };

    if (s.level === 'TR1' || s.level === 'TR2') {
      rec.text = 'No FNA or follow-up required.';
      return rec;
    }
    var t = FNA_FOLLOWUP[s.level];
    if (t && sizeCm !== null) {
      if (sizeCm >= t.fnaCm) {
        rec.action = 'fna';
        rec.text = 'FNA biopsy recommended.';
      } else if (sizeCm >= t.followCm) {
        rec.action = 'follow-up';
        rec.followUp = t.followUp;
        rec.text = t.followUp.charAt(0).toUpperCase() + t.followUp.slice(1) + '.';
      }
    }
    if (rec.action === 'none') rec.text = 'No FNA or follow-up required.';
    return rec;
  }


  /* Score desc, then largest dimension desc (ACR tie-break), stable. */
  function sortNodules(nodules, unit) {
    return nodules
      .map(function (n, i) { return { n: n, i: i, s: scoreNodule(n), size: maxDimensionCm(n, unit) || 0 }; })
      .sort(function (a, b) {
        if (b.s.points !== a.s.points) return b.s.points - a.s.points;
        if (b.size !== a.size) return b.size - a.size;
        return a.i - b.i;
      })
      .map(function (x) { return x.n; });
  }

  /* ACR: only the four highest-scoring nodules are scored, reported, and followed. */
  function selectNodulesToDetail(nodules, unit, count) {
    var c = Math.max(0, typeof count === 'number' ? count : 4);
    return sortNodules(nodules, unit).slice(0, c);
  }

  function getDetailedNodules(nodules, unit, count) {
    var c = typeof count === 'number' ? count : 4;
    var sorted = sortNodules(nodules, unit);
    return {
      detailed: sorted.slice(0, c),
      undetailedCount: Math.max(0, nodules.length - c)
    };
  }

  return {
    CATEGORIES: CATEGORIES,
    TR_DESCRIPTORS: TR_DESCRIPTORS,
    TR_RISK: TR_RISK,
    FNA_FOLLOWUP: FNA_FOLLOWUP,
    trLevelForPoints: trLevelForPoints,
    scoreNodule: scoreNodule,
    parseDim: parseDim,
    maxDimensionCm: maxDimensionCm,
    recommendation: recommendation,
    sortNodules: sortNodules,
    selectNodulesToDetail: selectNodulesToDetail,
    getDetailedNodules: getDetailedNodules
  };
});


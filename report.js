/*
 * report.js — builds the report from state { study, thyroid, nodules, lymphNodes, freeText, settings }.
 * A structured line model is emitted as plain text (renderReport) and formatted HTML
 * (renderReportHtml, for rich clipboard copy / print).
 * Pure (no DOM), usable in the browser and in Node (for tests).
 */
(function (global, factory) {
  var api = factory(typeof module !== 'undefined' && module.exports ? require('./tirads.js') : global.TIRADS);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Report = api;
})(typeof window !== 'undefined' ? window : this, function (TIRADS) {
  'use strict';

  var DIM_ORDERS = {
    lat: { idx: [0, 1, 2], names: ['longitudinal', 'anteroposterior', 'transverse'], abbr: ['L', 'AP', 'T'] },
    alt: { idx: [1, 2, 0], names: ['anteroposterior', 'transverse', 'longitudinal'], abbr: ['AP', 'T', 'L'] },
    tla: { idx: [2, 0, 1], names: ['transverse', 'longitudinal', 'anteroposterior'], abbr: ['T', 'L', 'AP'] }
  };
  var CANON = ['longitudinal', 'ap', 'transverse'];

  var LOBE_NAMES = { right: 'Right', left: 'Left', isthmus: 'Isthmus' };
  var LOBE_ORDER = ['right', 'isthmus', 'left'];
  var VERT_RANK = { superior: 0, middle: 1, inferior: 2 };

  var GLAND_CHARS = {
    homogenous: { label: 'homogenous', group: 'echo' },
    heterogenous: { label: 'heterogenous', group: 'echo' },
    nodular: { label: 'nodular', group: 'echo' },
    increasedVascularity: { label: 'increased vascularity', group: 'vasc' },
    decreasedVascularity: { label: 'decreased vascularity', group: 'vasc' },
    normalVascularity: { label: 'normal vascularity', group: 'vasc' },
    spTotal: { label: 's/p total thyroidectomy', group: 'sp' },
    spRight: { label: 's/p right lobectomy', group: 'sp' },
    spLeft: { label: 's/p left lobectomy', group: 'sp' }
  };

  var LN_FINDINGS = {
    enlargement: 'enlargement',
    hilum: 'loss of the fatty hilum',
    rounded: 'rounded rather than oval shape',
    hyperechoic: 'hyper-echogenicity',
    cystic: 'cystic change',
    calcifications: 'calcifications',
    vascularity: 'peripheral vascularity / abnormal blood flow'
  };
  var LN_COMPARTMENTS = ['II', 'III', 'IV', 'V', 'VI'];
  var LN_DEFAULT = 'No significant lymph nodes seen in compartments II through VI bilaterally.';

  var VASC_GRADES = {
    '1': 'grade 1 vascularity (avascular)',
    '2': 'grade 2 vascularity (peripheral)',
    '3': 'grade 3 vascularity (intranodal)',
    '4': 'grade 4 vascularity (high intensity)'
  };

  var DEFAULT_SETTINGS = {
    reportTitle: 'THYROID ULTRASOUND',
    includeDate: true, includePhysician: true, includeOperator: true, includePatient: false, includeIndication: true,
    includeGland: true, includeNodules: true, includeLymphNodes: true, includeImpression: true, includeFreeText: true,
    includeMeasureNote: true, unit: 'cm', decimals: 1, dimOrder: 'lat', includeUnitInMeasurement: false,
    bullet: '-', noduleNumbering: '1', numberingScheme: 'global',
    includeBreakdown: true, includeZeroPointCategories: true, includeSizeComment: true,
    includeNoduleSummary: false, includeLymphNodeSummary: false, lnDims: 'single',
    includeBiopsyRec: true, includeFollowUpRec: true,
    footerText: 'This report was drafted with a report-assistance tool and must be reviewed and signed by the interpreting physician.'
  };

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function fmtDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    return p.length === 3 ? p[1] + '/' + p[2] + '/' + p[0] : iso;
  }

  function fmtNum(v, decimals) {
    var n = parseFloat(v);
    if (!isFinite(n)) return null;
    return n.toFixed(Math.max(0, decimals | 0));
  }

  /* Dimensions are stored canonically as [longitudinal, AP, transverse] (array or object). */
  function toDimObj(values) {
    if (values && Object.prototype.toString.call(values) === '[object Array]') {
      return { longitudinal: values[0], ap: values[1], transverse: values[2] };
    }
    return values || {};
  }

  /* Ordered, non-blank dimensions joined as "a \u00D7 b \u00D7 c" (+ optional unit). */
  function dimsText(values, settings) {
    var order = DIM_ORDERS[settings.dimOrder] || DIM_ORDERS.lat;
    var obj = toDimObj(values);
    var parts = [];
    order.idx.forEach(function (ci) {
      var s = fmtNum(obj[CANON[ci]], settings.decimals);
      if (s !== null) parts.push(s);
    });
    if (!parts.length) return '';
    var t = parts.join(' \u00D7 ');
    if (settings.includeUnitInMeasurement) t += ' ' + settings.unit;
    return t;
  }

  /* Single largest dimension with unit, e.g. "2.1 cm". */
  function sizeWithUnit(values, settings) {
    var obj = toDimObj(values);
    var vals = CANON.map(function (k) {
      var n = TIRADS.parseDim(obj[k]);
      return n > 0 ? n : null;
    }).filter(function (n) { return n !== null; });
    if (!vals.length) return '';
    var max = Math.max.apply(null, vals);
    var s = settings.unit === 'mm' ? String(Math.round(max)) : max.toFixed(1);
    return s + ' ' + settings.unit;
  }

  /* Top-of-report note: units + measurement order. */
  function measureNoteLine(settings) {
    var order = DIM_ORDERS[settings.dimOrder] || DIM_ORDERS.lat;
    var unitName = settings.unit === 'mm' ? 'millimeters (mm)' : 'centimeters (cm)';
    return 'All measurements are in ' + unitName + ' and are listed in the order: ' +
      order.names.join(' \u00D7 ') + ' (' + order.abbr.join(' \u00D7 ') + ').';
  }

  /* e.g. "The gland is heterogenous with increased vascularity, s/p right lobectomy." */
  function glandSentence(chars) {
    var g = { echo: [], vasc: [], sp: [] };
    Object.keys(GLAND_CHARS).forEach(function (k) {
      if ((chars || []).indexOf(k) !== -1) g[GLAND_CHARS[k].group].push(GLAND_CHARS[k].label);
    });
    if (!g.echo.length && !g.vasc.length && !g.sp.length) return '';
    var s = 'The gland ' + (g.echo.length || (!g.vasc.length && g.sp.length) ? 'is' : 'has') + ' ';
    if (g.echo.length) s += g.echo.join(', ');
    if (g.vasc.length) s += (g.echo.length ? ' with ' : '') + g.vasc.join(', ');
    if (g.sp.length) s += (g.echo.length || g.vasc.length ? ', ' : '') + g.sp.join(', ');
    return s + '.';
  }

  /* ---------------- structured line primitives ---------------- */
  function seg(t, f) { return { t: t, f: f || null }; }
  function textLine(t, f) { return { kind: 'text', segs: [seg(t, f)] }; }
  function kvLine(label, value, cls) { return { kind: 'kv', cls: cls || null, segs: [seg(label + ': ', 'f-b'), seg(value)] }; }
  function headerLine(text) { return { kind: 'h', segs: [seg(text, 'f-bu')] }; }
  function blankLine() { return { kind: 'blank', segs: [] }; }
  function titleLine(text) { return { kind: 'title', segs: [seg(text, 'f-title')] }; }

  /* CSS class that gives bulleted lines a hanging indent (bullet at the margin,
     wrapped lines aligned with the text after the bullet). */
  function listClass(settings) {
    if (settings.bullet === '\u2022') return 'r-list-dot';
    if (settings.bullet === 'numbered') return 'r-list-num';
    return 'r-list-dash';
  }

  function intervalPhrase(n, study, settings) {
    if (!n.interval || n.interval === 'none') return null;
    var s = n.interval === 'stable' ? 'stable' : 'increased';
    var t = s + ' in size compared to the prior ultrasound';
    if (study.priorUsDate) t += ' of ' + fmtDate(study.priorUsDate);
    return t;
  }

  function noduleLobe(n, scheme) {
    if (n.lobe === 'isthmus' || n.vertical === 'isthmus') {
      return scheme === 'byLobe' ? 'left' : 'isthmus';
    }
    return n.lobe === 'left' ? 'left' : 'right';
  }

  function numTok(i, settings) {
    return settings.noduleNumbering === 'N1' ? 'N' + i : String(i);
  }

  /* All nodules are reported (no cap). List order: lobe groups
     (Right -> Isthmus -> Left), and within each group superior -> middle ->
     inferior; the TI-RADS score/size sort breaks remaining ties. */
  function reportOrder(nodules, unit, settings) {
    var scheme = settings.numberingScheme || 'global';
    var groups = scheme === 'byLobe' ? ['right', 'left'] : LOBE_ORDER;
    var sorted = TIRADS.sortNodules(nodules, unit);
    return sorted.slice().sort(function (a, b) {
      var ga = groups.indexOf(noduleLobe(a, scheme));
      var gb = groups.indexOf(noduleLobe(b, scheme));
      if (ga !== gb) return ga - gb;
      var va = VERT_RANK[a.vertical] != null ? VERT_RANK[a.vertical] : 1;
      var vb = VERT_RANK[b.vertical] != null ? VERT_RANK[b.vertical] : 1;
      return va - vb;
    });
  }

  /* "1" for global schemes; "Right 2" for per-group schemes. */
  function noduleRef(ordered, i, settings) {
    var scheme = settings.numberingScheme || 'global';
    var n = ordered[i];
    if (scheme === 'global') return numTok(i + 1, settings);
    var grp = noduleLobe(n, scheme);
    var c = 0;
    for (var j = 0; j <= i; j++) if (noduleLobe(ordered[j], scheme) === grp) c++;
    return LOBE_NAMES[grp] + ' ' + numTok(c, settings);
  }

  /* Location text; in per-group schemes the lobe name is already the ref prefix.
     In by-lobe mode an isthmus nodule keeps its lobe label and prints "isthmus"
     in the position slot (where anterior/posterior sits). */
  function noduleLocation(n, settings, withLobe) {
    var scheme = settings.numberingScheme || 'global';
    var lobe = noduleLobe(n, scheme);
    if (lobe === 'isthmus') {
      if (withLobe) return LOBE_NAMES.isthmus;
      var rest = [];
      if (n.vertical && n.vertical !== 'isthmus') rest.push(n.vertical);
      if (n.depth) rest.push(n.depth);
      return rest.join(', ');
    }
    var parts = [];
    if (withLobe) parts.push(LOBE_NAMES[n.lobe] || 'Right');
    if (n.vertical && n.vertical !== 'isthmus') parts.push(n.vertical);
    if (scheme === 'byLobe' && (n.isthmus || n.lobe === 'isthmus')) parts.push('isthmus');
    if (n.depth) parts.push(n.depth);
    return parts.join(', ');
  }


  function noduleLineParts(n, ref, study, settings) {
    var sc = TIRADS.scoreNodule(n);
    var withLobe = (settings.numberingScheme || 'global') === 'global';
    var loc = noduleLocation(n, settings, withLobe);
    var dims = dimsText(n.dims, settings);
    var findings = [];
    if (VASC_GRADES[n.vascularity]) findings.push(VASC_GRADES[n.vascularity]);
    if (n.parathyroid) findings.push('suspected parathyroid');
    if (settings.includeSizeComment) {
      var ip = intervalPhrase(n, study, settings);
      if (ip) findings.push(ip);
    }
    var mid = [];
    if (loc) mid.push(loc);
    if (dims) mid.push('(' + dims + ')');
    var tail = findings.length ? ' ' + findings.join(', ') : '';
    var bd = '';
    if (settings.includeBreakdown) {
      var items = sc.breakdown.filter(function (b) { return b.points > 0 || settings.includeZeroPointCategories; });
      if (items.length) bd = ' (' + items.map(function (b) { return b.label + ' ' + b.points; }).join(', ') + ')';
    }
    var bullet = settings.bullet === 'numbered' ? '' : settings.bullet + ' ';
    var lead = bullet + ref + ' (';
    var after = ')' + (mid.length ? ' ' + mid.join(' ') : '') + tail + ((mid.length || tail) ? '.' : '') + bd;
    return {
      sc: sc,
      cls: listClass(settings),
      segs: [seg(lead), seg(sc.level, 'f-' + sc.level.toLowerCase()), seg(after)]
    };
  }

  function thyroidLines(th, settings) {
    var lines = [];
    var sizeParts = [];
    var r = dimsText(th.rightLobe, settings);
    var l = dimsText(th.leftLobe, settings);
    var ist = fmtNum(th.isthmus, settings.decimals);
    if (r) sizeParts.push('The right lobe measures ' + r);
    if (l) sizeParts.push('the left lobe measures ' + l);
    if (ist) sizeParts.push('the isthmus measures ' + ist + (settings.includeUnitInMeasurement ? ' ' + settings.unit : ''));
    if (sizeParts.length) {
      var s = sizeParts.length === 1 ? sizeParts[0]
        : sizeParts.length === 2 ? sizeParts[0] + ' and ' + sizeParts[1]
        : sizeParts.slice(0, -1).join(', ') + ', and ' + sizeParts[sizeParts.length - 1];
      lines.push(textLine(s.charAt(0).toUpperCase() + s.slice(1) + '.'));
    }
    var gs = glandSentence(th.chars);
    if (gs) lines.push(textLine(gs));
    return lines;
  }

  function nodulesLines(ns, study, settings) {
    if (!ns.length) return [textLine('No nodules were identified in either lobe or the isthmus.')];
    var ordered = reportOrder(ns, settings.unit, settings);
    return ordered.map(function (n, i) {
      return noduleLineParts(n, noduleRef(ordered, i, settings), study, settings);
    });
  }

  /* LN size as printed: single value or three dimensions, always with the unit. */
  function lnSizeText(ln, settings) {
    if (settings.lnDims === '3d') {
      var d = dimsText(ln.dims, settings);
      return d ? d + ' ' + settings.unit : '';
    }
    var s = fmtNum(ln.size, settings.decimals);
    return s === null ? '' : s + ' ' + settings.unit;
  }

  function lnLineParts(ln, i, settings) {
    var t = lnSizeText(ln, settings);
    var sizeTxt = t ? ' (' + t + ')' : '';
    var loc = cap(ln.side || 'right') + ', level ' + (ln.compartment || 'IV');
    var findings = (ln.findings || []).map(function (k) { return LN_FINDINGS[k] || null; }).filter(Boolean);
    var bullet = settings.bullet === 'numbered' ? '' : settings.bullet + ' ';
    var segs = [seg(bullet + (i + 1) + ' ' + loc + sizeTxt)];
    if (findings.length) {
      segs.push(seg(' '));
      findings.forEach(function (f, j) {
        segs.push(seg((j === 0 ? '' : ', ') + f, 'f-b'));
      });
      segs.push(seg('.'));
    } else {
      segs.push(seg('.'));
    }
    return { cls: listClass(settings), segs: segs };
  }

  function lnLines(lns, settings) {
    if (!lns.length) return [textLine(LN_DEFAULT)];
    return lns.map(function (ln, i) { return lnLineParts(ln, i, settings); });
  }


  function impressionLines(state, settings) {
    var ns = state.nodules || [];
    var lns = state.lymphNodes || [];
    var lines = [];

    var gs = glandSentence(state.thyroid ? state.thyroid.chars : null);
    if (gs) lines.push(textLine(gs));

    var ordered = reportOrder(ns, settings.unit, settings);
    var withLobe = (settings.numberingScheme || 'global') === 'global';
    var recs = ordered.map(function (n, idx) {
      return { n: n, idx: idx, s: TIRADS.scoreNodule(n), r: TIRADS.recommendation(n, settings.unit) };
    });

    if (settings.includeNoduleSummary) {
      recs.forEach(function (x) {
        var size = x.r.sizeCm !== null ? sizeWithUnit(x.n.dims, settings) : '';
        var loc = noduleLocation(x.n, settings, withLobe).toLowerCase();
        var segs = [seg(noduleRef(ordered, x.idx, settings) + (size ? ' ' + size : '') + ' (')];
        segs.push(seg(x.s.level, 'f-' + x.s.level.toLowerCase()));
        segs.push(seg(')' + (loc ? ' ' + loc : '')));
        lines.push({ kind: 'text', segs: segs });
      });
    }

    if (settings.includeFreeText && state.freeText && state.freeText.trim()) {
      lines.push(blankLine());
      state.freeText.split('\n').forEach(function (ln) { lines.push(textLine(ln)); });
    }

    var fna = recs.filter(function (x) { return x.r.action === 'fna'; });
    if (settings.includeBiopsyRec && fna.length) {
      lines.push(blankLine());
      lines.push({ kind: 'text', segs: [seg('The following nodules meet ACR TI-RADS criteria for biopsy if not previously performed:', 'f-bu')] });
      fna.forEach(function (x) {
        var size = x.r.sizeCm !== null ? sizeWithUnit(x.n.dims, settings) : 'size not recorded';
        lines.push({ kind: 'text', cls: 'r-nested', segs: [seg('   \u2022 ' + noduleRef(ordered, x.idx, settings) + ': ' + size + ', ' + x.s.level)] });
      });
    }

    var fu = recs.filter(function (x) { return x.r.action === 'follow-up'; });
    if (settings.includeFollowUpRec && fu.length) {
      lines.push(blankLine());
      lines.push(textLine('Ultrasound follow-up is recommended per ACR TI-RADS for:'));
      fu.forEach(function (x) {
        var size = x.r.sizeCm !== null ? sizeWithUnit(x.n.dims, settings) : 'size not recorded';
        lines.push({ kind: 'text', cls: 'r-nested', segs: [seg('   \u2022 ' + noduleRef(ordered, x.idx, settings) + ': ' + size + ', ' + x.s.level + ' - ' + x.r.followUp)] });
      });
    }

    if (settings.includeLymphNodeSummary) {
      if (!lns.length) {
        lines.push(blankLine());
        lines.push(textLine(LN_DEFAULT));
      } else {
        lines.push(blankLine());
        lns.forEach(function (ln, i) {
          var sizeTxt = lnSizeText(ln, settings);
          var findings = (ln.findings || []).map(function (k) { return LN_FINDINGS[k] || null; }).filter(Boolean);
          var head = (i + 1) + ' ' + (ln.side || 'right') + ' level ' + (ln.compartment || 'IV') + ' node' +
            (sizeTxt ? ', ' + sizeTxt : '') +
            (findings.length ? ', ' : '');
          var segs = [seg(head)];
          findings.forEach(function (f, j) { segs.push(seg((j === 0 ? '' : ', ') + f, 'f-b')); });
          segs.push(seg('.'));
          lines.push({ kind: 'text', segs: segs });
        });
      }
    }
    return lines;
  }


  function buildReport(state) {
    var s = state.study || {};
    var th = state.thyroid || {};
    var ns = state.nodules || [];
    var lns = state.lymphNodes || [];
    var settings = Object.assign({}, DEFAULT_SETTINGS, state.settings || {});
    var L = [titleLine(settings.reportTitle || 'THYROID ULTRASOUND')];

    var header = [];
    if (settings.includeDate !== false && s.date) header.push(kvLine('Date', fmtDate(s.date), 'r-subtitle'));
    if (settings.includePhysician && s.physician) header.push(kvLine('Physician diagnostician', s.physician));
    if (settings.includeOperator && s.operator) header.push(kvLine('Ultrasound operator', s.operator));
    if (settings.includePatient) {
      var p = [s.patient ? 'Patient: ' + s.patient : null, s.mrn ? 'MRN: ' + s.mrn : null, s.dob ? 'DOB: ' + fmtDate(s.dob) : null].filter(Boolean).join('  |  ');
      if (p) header.push(textLine(p));
    }
    if (settings.includeIndication) {
      if (s.indication) header.push(kvLine('Indication', s.indication));
      if (s.priorUsDate) header.push(kvLine('Prior study', 'thyroid ultrasound ' + fmtDate(s.priorUsDate)));
    }
    if (header.length) { L = L.concat(header); L.push(blankLine()); }

    if (settings.includeMeasureNote) { L.push(textLine(measureNoteLine(settings))); L.push(blankLine()); }

    if (settings.includeGland) {
      var gl = thyroidLines(th, settings);
      if (gl.length) { L.push(headerLine('THYROID')); L = L.concat(gl); L.push(blankLine()); }
    }

    if (settings.includeNodules) {
      L.push(headerLine('NODULES'));
      L = L.concat(nodulesLines(ns, s, settings));
      L.push(blankLine());
    }

    if (settings.includeLymphNodes) {
      L.push(headerLine('LYMPH NODES'));
      L = L.concat(lnLines(lns, settings));
      L.push(blankLine());
    }

    if (settings.includeImpression) {
      L.push(headerLine('IMPRESSION'));
      L = L.concat(impressionLines(state, settings));
      L.push(blankLine());
    }

    if (settings.footerText) L.push({ kind: 'footer', segs: [seg(settings.footerText, 'f-muted')] });

    return L;
  }

  /* ---------------- emitters ---------------- */
  function plainText(lines) {
    return lines.map(function (l) {
      if (l.kind === 'blank') return '';
      return (l.segs || []).map(function (s) { return s.t; }).join('');
    }).join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '');
  }

  function esc(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function segHtml(s) {
    var e = esc(s.t);
    if (!s.f) return e;
    if (s.f === 'f-b') return '<b>' + e + '</b>';
    if (s.f === 'f-u') return '<u>' + e + '</u>';
    if (s.f === 'f-bu') return '<b><u>' + e + '</u></b>';
    return '<span class="' + s.f + '">' + e + '</span>';
  }

  function renderHtml(lines) {
    return lines.map(function (l) {
      if (l.kind === 'blank') return '<div class="r-gap"></div>';
      var hang = l.cls && (l.cls.indexOf('r-list') === 0 || l.cls === 'r-nested');
      var cls = (l.kind === 'title' ? 'r-title' : l.kind === 'footer' ? 'r-footer' : 'r-line') + (l.cls ? ' ' + l.cls : '');
      var segs = (l.segs || []).map(function (s, i) {
        if (hang && i === 0) s = { t: s.t.replace(/^\s+/, ''), f: s.f };
        return s;
      });
      return '<div class="' + cls.replace(/^\s+/, '') + '">' + segs.map(segHtml).join('') + '</div>';
    }).join('');
  }

  function renderReport(state) { return plainText(buildReport(state)); }
  function renderReportHtml(state) { return renderHtml(buildReport(state)); }

  return {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    DIM_ORDERS: DIM_ORDERS,
    GLAND_CHARS: GLAND_CHARS,
    LN_FINDINGS: LN_FINDINGS,
    LN_COMPARTMENTS: LN_COMPARTMENTS,
    LN_DEFAULT: LN_DEFAULT,
    VASC_GRADES: VASC_GRADES,
    renderReport: renderReport,
    renderReportHtml: renderReportHtml,
    buildReport: buildReport,
    measureNoteLine: measureNoteLine,
    dimsText: dimsText,
    sizeWithUnit: sizeWithUnit,
    glandSentence: glandSentence,
    noduleLocation: noduleLocation,
    fmtDate: fmtDate,
    fmtNum: fmtNum
  };
});


/*
 * app.js — UI wiring for the thyroid ultrasound report generator.
 * Depends on tirads.js (window.TIRADS) and report.js (window.Report).
 */
(function () {
  'use strict';
  var T = window.TIRADS, R = window.Report;
  var STORE_KEY = 'thyroid-us-report-v2';

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function todayISO() { var d = new Date(); function p(x) { return (x < 10 ? '0' : '') + x; } return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function uid() { return 'n' + Math.random().toString(36).slice(2, 9); }

  function newNodule() {
    return {
      id: uid(), lobe: 'right', vertical: 'middle', depth: '', isthmus: false,
      dims: ['', '', ''],
      composition: 'solid', echogenicity: 'hypo', shape: 'wider', margin: 'smooth',
      foci: ['none'], interval: 'none', vascularity: '', parathyroid: false
    };
  }
  function newLymphNode() {
    return { id: uid(), side: 'right', compartment: 'IV', size: '', dims: ['', '', ''], findings: [] };
  }

  function defaultState() {
    return {
      study: { date: todayISO(), physician: '', operator: '', patient: '', mrn: '', dob: '', priorUsDate: '', indication: '' },
      thyroid: { rightLobe: ['', '', ''], leftLobe: ['', '', ''], isthmus: '', chars: ['homogenous', 'normalVascularity'] },
      nodules: [newNodule()],
      lymphNodes: [],
      freeText: '',
      settings: Object.assign({}, R.DEFAULT_SETTINGS)
    };
  }

  function loadRaw() {
    try {
      var raw = localStorage.getItem(STORE_KEY) || localStorage.getItem('thyroid-us-report-v1');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /* Upgrade older saved state to the current shape. */
  function migrate(st) {
    var d = defaultState();
    var s = Object.assign({}, d.study, st.study || {});
    if (s.indication == null) s.indication = s.history || '';
    delete s.history;
    var th = Object.assign({}, d.thyroid, st.thyroid || {});
    if (!Array.isArray(th.chars)) {
      th.chars = [];
      var emap = { homogeneous: 'homogenous', heterogeneous: 'heterogenous', markedHeterogeneous: 'nodular' };
      if (emap[th.echotexture]) th.chars.push(emap[th.echotexture]);
      var vmap = { normal: 'normalVascularity', increased: 'increasedVascularity', markedlyIncreased: 'increasedVascularity' };
      if (vmap[th.vascularity]) th.chars.push(vmap[th.vascularity]);
      delete th.echotexture; delete th.vascularity; delete th.sizeDesc;
    }
    var settings = Object.assign({}, R.DEFAULT_SETTINGS, st.settings || {});
    if (settings.includeSizeComment == null) settings.includeSizeComment = settings.includeIntervalNote != null ? !!settings.includeIntervalNote : true;
    if (settings.includeIndication == null) settings.includeIndication = settings.includeHistory != null ? !!settings.includeHistory : true;
    delete settings.includeIntervalNote; delete settings.includeHistory;
    delete settings.nodulesToDetail; delete settings.includeUndetailedSummary; delete settings.includeRisk;
    var nodules = Array.isArray(st.nodules) && st.nodules.length ? st.nodules : d.nodules;
    nodules.forEach(function (n) {
      if (n.echogenicity === 'hyperiso') n.echogenicity = 'iso';
      if (!Array.isArray(n.foci) || !n.foci.length) n.foci = ['none'];
      if (n.vascularity == null || n.vascularity === 'none') n.vascularity = '';
      if (n.isthmus == null) n.isthmus = false;
      if (n.parathyroid == null) n.parathyroid = false;
      if (n.depth == null) n.depth = '';
      if (n.vertical == null) n.vertical = 'middle';
      if (n.vertical === 'isthmus') { n.isthmus = true; n.vertical = 'middle'; }
    });
    if (settings.numberingScheme === 'byLobe') {
      nodules.forEach(function (n) {
        if (n.lobe === 'isthmus') { n.lobe = 'left'; n.isthmus = true; n.depth = ''; }
      });
    }
    var lns = Array.isArray(st.lymphNodes) ? st.lymphNodes : [];
    lns.forEach(function (ln) {
      if (!ln.side) ln.side = 'right';
      if (!ln.compartment) ln.compartment = 'IV';
      if (!Array.isArray(ln.findings)) ln.findings = [];
      if (ln.size == null) ln.size = '';
      if (!Array.isArray(ln.dims) || ln.dims.length !== 3) ln.dims = [ln.size || '', '', ''];
    });
    return { study: s, thyroid: th, nodules: nodules, lymphNodes: lns, freeText: st.freeText || '', settings: settings };
  }

  var state = migrate(loadRaw() || {});

  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private mode etc. */ } }

  /* ---------------- report output ---------------- */
  var reportEl = $('#report-text');
  var plainText = '', htmlText = '';
  function renderReport() {
    plainText = R.renderReport(state);
    htmlText = R.renderReportHtml(state);
    reportEl.innerHTML = htmlText;
    var words = plainText.trim() ? plainText.trim().split(/\s+/).length : 0;
    $('#report-meta').textContent = words + ' words \u00B7 ' + plainText.length + ' characters';
  }

  /* ---------------- study information ---------------- */
  function syncStudyInputs() {
    $$('[data-field]').forEach(function (inp) { inp.value = state.study[inp.dataset.field] || ''; });
    syncPresets();
  }
  $$('[data-field]').forEach(function (inp) {
    inp.value = state.study[inp.dataset.field] || '';
    inp.addEventListener('input', function () {
      state.study[inp.dataset.field] = inp.value;
      if (inp.dataset.field === 'indication') syncPresets();
      save(); renderReport();
    });
  });

  var INDICATION_PRESETS = ['Follow-up thyroid nodules', 'Goiter', 'Follow-up thyroid cancer'];
  function syncPresets() {
    var val = state.study.indication || '';
    $$('#indication-presets button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.value === val);
    });
  }
  (function buildPresets() {
    var box = $('#indication-presets');
    INDICATION_PRESETS.forEach(function (p) {
      var b = el('button');
      b.type = 'button';
      b.textContent = p;
      b.dataset.value = p;
      b.addEventListener('click', function () {
        state.study.indication = p;
        syncStudyInputs();
        save(); renderReport();
      });
      box.appendChild(b);
    });
  })();

  /* Each study input hides when the corresponding report setting is off. */
  var FIELD_SETTING = {
    date: 'includeDate', physician: 'includePhysician', operator: 'includeOperator',
    patient: 'includePatient', mrn: 'includePatient', dob: 'includePatient',
    priorUsDate: 'includeSizeComment', indication: 'includeIndication'
  };
  function applyStudyVisibility() {
    $$('[data-field]').forEach(function (inp) {
      var k = FIELD_SETTING[inp.dataset.field];
      if (!k) return;
      var lab = inp.parentNode;
      while (lab && lab.tagName !== 'LABEL') lab = lab.parentNode;
      if (lab) lab.classList.toggle('hidden', !state.settings[k]);
    });
  }

  /* New patient: keeps date, physician, operator & settings. */
  $('#btn-new-patient').addEventListener('click', function () {
    var s = state.study;
    s.patient = ''; s.mrn = ''; s.dob = ''; s.priorUsDate = ''; s.indication = '';
    state.thyroid = defaultState().thyroid;
    state.nodules = [newNodule()];
    state.lymphNodes = [];
    state.freeText = '';
    syncStudyInputs();
    buildGlandSizes();
    syncGlandChars();
    renderNoduleList();
    renderLnList();
    syncFreeText();
    save(); renderReport();
  });


  /* ---------------- thyroid gland ---------------- */
  var DIM_DEFS = [
    { key: 'rightLobe', title: 'Right lobe', n: 3 },
    { key: 'leftLobe', title: 'Left lobe', n: 3 },
    { key: 'isthmus', title: 'Isthmus', n: 1 }
  ];
  function dimName(ci) { return ci === 0 ? 'Longitudinal' : ci === 1 ? 'AP' : 'Transverse'; }

  function buildGlandSizes() {
    var wrap = $('#gland-sizes');
    wrap.innerHTML = '';
    var order = R.DIM_ORDERS[state.settings.dimOrder] || R.DIM_ORDERS.lat;
    DIM_DEFS.forEach(function (def) {
      var block = el('div', 'globe-block');
      block.appendChild(el('span', 'block-title', def.title));
      var row = el('div', def.n === 1 ? 'dim1' : 'dim3');
      var idxs = def.n === 1 ? [0] : order.idx;
      idxs.forEach(function (ci) {
        var lab = el('label');
        var name = def.n === 1 ? 'Isthmus' : dimName(ci);
        var sp = el('span', 'dim-label', name + ' (' + state.settings.unit + ')');
        sp.dataset.name = name;
        lab.appendChild(sp);
        var inp = el('input');
        inp.type = 'text'; inp.inputMode = 'decimal'; inp.placeholder = '0.0';
        inp.value = (def.n === 1 ? state.thyroid.isthmus : state.thyroid[def.key][ci]) || '';
        inp.addEventListener('input', function () {
          if (def.n === 1) state.thyroid.isthmus = inp.value;
          else state.thyroid[def.key][ci] = inp.value;
          save(); renderReport();
        });
        lab.appendChild(inp);
        row.appendChild(lab);
      });
      block.appendChild(row);
      wrap.appendChild(block);
    });
  }

  var GLAND_CHAR_OPTS = {
    homogenous: 'Homogenous',
    heterogenous: 'Heterogenous',
    nodular: 'Nodular',
    increasedVascularity: 'Increased vascularity',
    decreasedVascularity: 'Decreased vascularity',
    normalVascularity: 'Normal vascularity',
    spTotal: 's/p total thyroidectomy',
    spRight: 's/p right lobectomy',
    spLeft: 's/p left lobectomy'
  };
  function buildGlandChars() {
    var box = $('#gland-chars');
    box.innerHTML = '';
    Object.keys(GLAND_CHAR_OPTS).forEach(function (k) {
      var lab = el('label');
      var cb = el('input');
      cb.type = 'checkbox';
      cb.value = k;
      cb.checked = state.thyroid.chars.indexOf(k) !== -1;
      cb.addEventListener('change', function () {
        state.thyroid.chars = Object.keys(GLAND_CHAR_OPTS).filter(function (kk) {
          var i = $('input[value="' + kk + '"]', box);
          return i && i.checked;
        });
        save(); renderReport();
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(' ' + GLAND_CHAR_OPTS[k]));
      box.appendChild(lab);
    });
  }
  function syncGlandChars() {
    $$('#gland-chars input').forEach(function (cb) {
      cb.checked = state.thyroid.chars.indexOf(cb.value) !== -1;
    });
  }


  /* ---------------- nodules ---------------- */
  var noduleList = $('#nodule-list');
  var CAT = T.CATEGORIES;
  var VERTICAL_OPTS = {
    superior: { ui: 'Superior' }, middle: { ui: 'Middle' },
    inferior: { ui: 'Inferior' }, isthmus: { ui: 'Isthmus' }
  };
  var DEPTH_OPTS = { anterior: { ui: 'Anterior' }, posterior: { ui: 'Posterior' } };
  var LOBE_OPTS = {
    right: { ui: 'Right lobe' }, left: { ui: 'Left lobe' }, isthmus: { ui: 'Isthmus' }
  };
  var VASC_GRADE_OPTS = {
    '1': { ui: 'Grade 1 (avascular)' }, '2': { ui: 'Grade 2 (peripheral)' },
    '3': { ui: 'Grade 3 (intranodal)' }, '4': { ui: 'Grade 4 (high intensity)' }
  };
  var INTERVAL_OPTS = [
    { value: 'none', label: 'No prior study' },
    { value: 'stable', label: 'Stable in size' },
    { value: 'increased', label: 'Increased in size' }
  ];
  var FOCUS_UI = {
    none: 'None',
    cometTail: 'Large comet-tail artifact',
    macro: 'Macrocalcification(s)',
    peripheral: 'Peripheral / rim calcification(s)',
    punctate: 'Punctate echogenic foci'
  };

  function setSeg(box, value) {
    $$('button', box).forEach(function (b) { b.classList.toggle('active', b.dataset.value === value); });
  }

  function makeSegRow(labelText, opts, current, onPick, dataCat) {
    var row = el('div', 'nodule-row');
    row.appendChild(el('span', 'opt-label', labelText));
    var box = el('div', 'btn-group');
    if (dataCat) box.dataset.cat = dataCat;
    Object.keys(opts).forEach(function (k) {
      var b = el('button');
      b.type = 'button';
      b.textContent = opts[k].ui;
      b.dataset.value = k;
      if (k === current) b.classList.add('active');
      b.addEventListener('click', function () {
        setSeg(box, k);
        onPick(k);
      });
      box.appendChild(b);
    });
    row.appendChild(box);
    return { row: row, box: box };
  }

  function updateCard(card, n) {
    var sc = T.scoreNodule(n);
    var badge = $('.tr-badge', card);
    if (badge) {
      badge.textContent = sc.level + ' \u00B7 ' + sc.points + ' pts' + (sc.autoTr1 ? ' (auto-TR1)' : '');
      badge.className = 'tr-badge tr' + sc.level.slice(2);
    }
    var rec = T.recommendation(n, state.settings.unit);
    var chip = $('.rec-chip', card);
    if (chip) chip.textContent = rec.action === 'fna' ? 'FNA' : rec.action === 'follow-up' ? 'Follow-up' : 'no FNA / follow-up';
  }

  /* Auto shape from the transverse-plane comparison; manual picks stick until dims change. */
  function applyAutoShape(card, n) {
    if (card._shapeManual) return;
    var ap = T.parseDim(n.dims[1]);
    var tr = T.parseDim(n.dims[2]);
    if (ap == null || tr == null || ap === tr) return;
    var want = ap > tr ? 'taller' : 'wider';
    if (n.shape !== want) {
      n.shape = want;
      setSeg($('[data-cat="shape"]', card), want);
    }
  }


  function buildCard(n, idx) {
    var card = el('div', 'nodule-card');
    var finished = function () { updateCard(card, n); save(); renderReport(); };
    var scheme = state.settings.numberingScheme || 'global';

    var head = el('div', 'nodule-head');
    head.appendChild(el('span', 'nodule-title', 'Nodule ' + (idx + 1)));
    head.appendChild(el('span', 'tr-badge'));
    head.appendChild(el('span', 'rec-chip'));
    var actions = el('span', 'nodule-actions');
    var dup = el('button', 'btn', 'Duplicate'); dup.type = 'button';
    var del = el('button', 'btn btn-danger', 'Remove'); del.type = 'button';
    actions.appendChild(dup); actions.appendChild(del);
    head.appendChild(actions);
    card.appendChild(head);

    var body = el('div', 'nodule-body');

    var locRow = el('div', 'nodule-row');
    locRow.appendChild(el('span', 'opt-label', 'Location'));
    var locBox = el('div', 'nodule-row');
    var lobeSel = el('select');
    var lobeKeys = scheme === 'byLobe' ? ['right', 'left'] : ['right', 'left', 'isthmus'];
    lobeKeys.forEach(function (k) {
      var op = el('option', null, LOBE_OPTS[k].ui);
      op.value = k;
      if (k === n.lobe) op.selected = true;
      lobeSel.appendChild(op);
    });
    if (n.lobe === 'isthmus' && scheme === 'byLobe') lobeSel.value = 'left';
    var vertBox = el('div', 'btn-group');
    ['superior', 'middle', 'inferior'].forEach(function (k) {
      var b = el('button'); b.type = 'button'; b.textContent = VERTICAL_OPTS[k].ui; b.dataset.value = k;
      if (k === n.vertical) b.classList.add('active');
      b.addEventListener('click', function () {
        n.vertical = k;
        setSeg(vertBox, k);
        finished();
      });
      vertBox.appendChild(b);
    });
    var depthBox = el('div', 'btn-group');
    Object.keys(DEPTH_OPTS).forEach(function (k) {
      var b = el('button'); b.type = 'button'; b.textContent = DEPTH_OPTS[k].ui; b.dataset.value = k;
      if (k === n.depth) b.classList.add('active');
      b.addEventListener('click', function () {
        n.depth = n.depth === k ? '' : k;
        setSeg(depthBox, n.depth);
        finished();
      });
      depthBox.appendChild(b);
    });
    /* In by-lobe mode a nodule can be in the isthmus while keeping its lobe
       label: isthmus is an optional position flag, like anterior/posterior. */
    var isthmusBox = el('div', 'btn-group');
    var istb = el('button');
    istb.type = 'button'; istb.textContent = 'Isthmus'; istb.dataset.value = 'isthmus';
    if (n.isthmus) istb.classList.add('active');
    istb.addEventListener('click', function () {
      n.isthmus = n.isthmus ? false : true;
      istb.classList.toggle('active', n.isthmus);
      finished();
    });
    isthmusBox.appendChild(istb);
    function locVisibility() {
      var hidePos = n.lobe === 'isthmus';
      vertBox.style.display = hidePos ? 'none' : '';
      depthBox.style.display = hidePos ? 'none' : '';
      isthmusBox.style.display = (hidePos || scheme !== 'byLobe') ? 'none' : '';
    }
    lobeSel.addEventListener('change', function () {
      n.lobe = lobeSel.value;
      locVisibility();
      finished();
    });
    locVisibility();
    locBox.appendChild(lobeSel); locBox.appendChild(vertBox); locBox.appendChild(depthBox); locBox.appendChild(isthmusBox);
    locRow.appendChild(locBox);
    body.appendChild(locRow);

    var dimRow = el('div', 'nodule-row');
    dimRow.appendChild(el('span', 'opt-label', 'Size'));
    var dimBox = el('div', 'dim3');
    var order = R.DIM_ORDERS[state.settings.dimOrder] || R.DIM_ORDERS.lat;
    order.idx.forEach(function (ci) {
      var lab = el('label');
      var sp = el('span', 'dim-label', dimName(ci) + ' (' + state.settings.unit + ')');
      sp.dataset.name = dimName(ci);
      lab.appendChild(sp);
      var inp = el('input');
      inp.type = 'text'; inp.inputMode = 'decimal'; inp.placeholder = '0.0';
      inp.value = n.dims[ci] || '';
      inp.addEventListener('input', function () {
        n.dims[ci] = inp.value;
        card._shapeManual = false;
        applyAutoShape(card, n);
        finished();
      });
      lab.appendChild(inp);
      dimBox.appendChild(lab);
    });
    dimRow.appendChild(dimBox);
    body.appendChild(dimRow);


    [['Composition', 'composition'], ['Echogenicity', 'echogenicity'], ['Shape (transverse)', 'shape'], ['Margin', 'margin']].forEach(function (pair) {
      var r = makeSegRow(pair[0], CAT[pair[1]], n[pair[1]], function (v) {
        n[pair[1]] = v;
        if (pair[1] === 'shape') card._shapeManual = true;
        finished();
      }, pair[1]);
      body.appendChild(r.row);
    });

    /* Vascularity is optional: click a grade to select it, click again to clear. */
    var vascRow = el('div', 'nodule-row');
    vascRow.appendChild(el('span', 'opt-label', 'Vascularity'));
    var vascBox = el('div', 'btn-group');
    vascBox.dataset.cat = 'vascularity';
    Object.keys(VASC_GRADE_OPTS).forEach(function (k) {
      var b = el('button'); b.type = 'button'; b.textContent = VASC_GRADE_OPTS[k].ui; b.dataset.value = k;
      if (k === n.vascularity) b.classList.add('active');
      b.addEventListener('click', function () {
        n.vascularity = n.vascularity === k ? '' : k;
        setSeg(vascBox, n.vascularity);
        finished();
      });
      vascBox.appendChild(b);
    });
    vascRow.appendChild(vascBox);
    body.appendChild(vascRow);

    var fociRow = el('div', 'nodule-row');
    fociRow.appendChild(el('span', 'opt-label', 'Echogenic foci'));
    var fociBox = el('div', 'check-group foci');
    Object.keys(FOCUS_UI).forEach(function (k) {
      var lab = el('label');
      var cb = el('input');
      cb.type = 'checkbox';
      cb.value = k;
      cb.checked = (n.foci || []).indexOf(k) !== -1;
      cb.addEventListener('change', function () {
        var vals = $$('.foci input:checked', fociBox).map(function (x) { return x.value; });
        if (!vals.length) vals.push('none');
        n.foci = vals;
        finished();
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(' ' + FOCUS_UI[k]));
      fociBox.appendChild(lab);
    });
    fociRow.appendChild(fociBox);
    body.appendChild(fociRow);

    var parRow = el('div', 'nodule-row');
    parRow.appendChild(el('span', 'opt-label', 'Note'));
    var parBox = el('div', 'check-group');
    var parLab = el('label');
    var parCb = el('input');
    parCb.type = 'checkbox';
    parCb.checked = !!n.parathyroid;
    parCb.addEventListener('change', function () { n.parathyroid = parCb.checked; finished(); });
    parLab.appendChild(parCb);
    parLab.appendChild(document.createTextNode(' Suspected parathyroid'));
    parBox.appendChild(parLab);
    parRow.appendChild(parBox);
    body.appendChild(parRow);

    var ivRow = el('div', 'nodule-row');
    ivRow.appendChild(el('span', 'opt-label', 'vs. prior US'));
    var ivBox = el('div', 'radio-group');
    var radioName = 'iv-' + n.id;
    INTERVAL_OPTS.forEach(function (o) {
      var lab = el('label');
      var rb = el('input');
      rb.type = 'radio'; rb.name = radioName; rb.value = o.value;
      rb.checked = n.interval === o.value;
      rb.addEventListener('change', function () { n.interval = rb.value; finished(); });
      lab.appendChild(rb);
      lab.appendChild(document.createTextNode(' ' + o.label));
      ivBox.appendChild(lab);
    });
    ivRow.appendChild(ivBox);
    if (!state.settings.includeSizeComment) ivRow.style.display = 'none';
    body.appendChild(ivRow);

    card.appendChild(body);

    dup.addEventListener('click', function () {
      var i = state.nodules.indexOf(n);
      var copy = Object.assign({}, n, { id: uid(), dims: n.dims.slice(), foci: n.foci.slice() });
      state.nodules.splice(i + 1, 0, copy);
      renderNoduleList(); save(); renderReport();
    });
    del.addEventListener('click', function () {
      state.nodules = state.nodules.filter(function (x) { return x.id !== n.id; });
      renderNoduleList(); save(); renderReport();
    });

    applyAutoShape(card, n);
    updateCard(card, n);
    return card;
  }

  function renderNoduleList() {
    noduleList.innerHTML = '';
    state.nodules.forEach(function (n, i) { noduleList.appendChild(buildCard(n, i)); });
    if (!state.nodules.length) noduleList.appendChild(el('p', 'muted-text', 'No nodules. Click \u201C+ Add nodule\u201D to start scoring.'));
  }
  function addNodule() {
    state.nodules.push(newNodule());
    renderNoduleList(); save(); renderReport();
  }
  $('#btn-add-nodule').addEventListener('click', addNodule);
  $('#btn-add-nodule-2').addEventListener('click', addNodule);


  /* ---------------- lymph nodes ---------------- */
  var lnList = $('#ln-list');
  var LN_SIDE_OPTS = { right: { ui: 'Right' }, left: { ui: 'Left' } };
  var LN_COMP_OPTS = { II: { ui: 'II' }, III: { ui: 'III' }, IV: { ui: 'IV' }, V: { ui: 'V' }, VI: { ui: 'VI' } };
  var LN_FINDING_OPTS = {
    enlargement: 'Enlargement',
    hilum: 'Loss of the fatty hilum (OR 1.9)',
    rounded: 'Rounded rather than oval (OR 1.6)',
    hyperechoic: 'Hyper-echogenicity (OR 5.4)',
    cystic: 'Cystic change (OR 71.8)',
    calcifications: 'Calcifications (OR 6.2)',
    vascularity: 'Peripheral vascularity / abnormal flow (OR 3.8)'
  };

  function buildLnCard(ln, idx) {
    var card = el('div', 'nodule-card');
    var finished = function () { save(); renderReport(); };

    var head = el('div', 'nodule-head');
    head.appendChild(el('span', 'nodule-title', 'Lymph node ' + (idx + 1)));
    var actions = el('span', 'nodule-actions');
    var del = el('button', 'btn btn-danger', 'Remove'); del.type = 'button';
    actions.appendChild(del);
    head.appendChild(actions);
    card.appendChild(head);

    var body = el('div', 'nodule-body');

    var row1 = el('div', 'nodule-row');
    row1.appendChild(el('span', 'opt-label', 'Location'));
    var locBox = el('div', 'nodule-row');
    var sideBox = el('div', 'btn-group');
    Object.keys(LN_SIDE_OPTS).forEach(function (k) {
      var b = el('button'); b.type = 'button'; b.textContent = LN_SIDE_OPTS[k].ui; b.dataset.value = k;
      if (k === ln.side) b.classList.add('active');
      b.addEventListener('click', function () { ln.side = k; setSeg(sideBox, k); finished(); });
      sideBox.appendChild(b);
    });
    var compBox = el('div', 'btn-group');
    Object.keys(LN_COMP_OPTS).forEach(function (k) {
      var b = el('button'); b.type = 'button'; b.textContent = LN_COMP_OPTS[k].ui; b.dataset.value = k;
      if (k === ln.compartment) b.classList.add('active');
      b.addEventListener('click', function () { ln.compartment = k; setSeg(compBox, k); finished(); });
      compBox.appendChild(b);
    });
    locBox.appendChild(sideBox); locBox.appendChild(compBox);
    row1.appendChild(locBox);
    body.appendChild(row1);

    var row2 = el('div', 'nodule-row');
    row2.appendChild(el('span', 'opt-label', 'Size'));
    if (state.settings.lnDims === '3d') {
      var dWrap = el('div', 'dim3');
      var dOrder = R.DIM_ORDERS[state.settings.dimOrder] || R.DIM_ORDERS.lat;
      dOrder.idx.forEach(function (ci) {
        var lab = el('label');
        var sp = el('span', 'dim-label', dimName(ci) + ' (' + state.settings.unit + ')');
        sp.dataset.name = dimName(ci);
        lab.appendChild(sp);
        var inp = el('input');
        inp.type = 'text'; inp.inputMode = 'decimal'; inp.placeholder = '0.0';
        inp.value = ln.dims[ci] || '';
        inp.addEventListener('input', function () { ln.dims[ci] = inp.value; finished(); });
        lab.appendChild(inp);
        dWrap.appendChild(lab);
      });
      row2.appendChild(dWrap);
    } else {
      var sizeWrap = el('label');
      var sizeSp = el('span', 'dim-label', 'largest dimension (' + state.settings.unit + ')');
      sizeWrap.appendChild(sizeSp);
      var sizeInp = el('input');
      sizeInp.type = 'text'; sizeInp.inputMode = 'decimal'; sizeInp.placeholder = '0.0';
      sizeInp.value = ln.size || '';
      sizeInp.addEventListener('input', function () { ln.size = sizeInp.value; finished(); });
      sizeWrap.appendChild(sizeInp);
      row2.appendChild(sizeWrap);
    }
    body.appendChild(row2);

    var row3 = el('div', 'nodule-row');
    row3.appendChild(el('span', 'opt-label', 'Findings'));
    var fBox = el('div', 'check-group ln-findings');
    Object.keys(LN_FINDING_OPTS).forEach(function (k) {
      var lab = el('label');
      var cb = el('input');
      cb.type = 'checkbox';
      cb.value = k;
      cb.checked = (ln.findings || []).indexOf(k) !== -1;
      cb.addEventListener('change', function () {
        ln.findings = $$('.ln-findings input:checked', fBox).map(function (x) { return x.value; });
        finished();
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(' ' + LN_FINDING_OPTS[k]));
      fBox.appendChild(lab);
    });
    row3.appendChild(fBox);
    body.appendChild(row3);

    card.appendChild(body);

    del.addEventListener('click', function () {
      state.lymphNodes = state.lymphNodes.filter(function (x) { return x.id !== ln.id; });
      renderLnList(); finished();
    });
    return card;
  }

  function renderLnList() {
    lnList.innerHTML = '';
    state.lymphNodes.forEach(function (ln, i) { lnList.appendChild(buildLnCard(ln, i)); });
    if (!state.lymphNodes.length) lnList.appendChild(el('p', 'muted-text', 'No lymph nodes. If none are abnormal, the report states so automatically.'));
  }
  function addLn() {
    state.lymphNodes.push(newLymphNode());
    renderLnList(); save(); renderReport();
  }
  $('#btn-add-ln').addEventListener('click', addLn);

  /* ---------------- impression free text ---------------- */
  var freeEl = $('#free-text');
  freeEl.value = state.freeText || '';
  freeEl.addEventListener('input', function () { state.freeText = freeEl.value; save(); renderReport(); });
  function syncFreeText() { freeEl.value = state.freeText || ''; }


  /* ---------------- settings drawer ---------------- */
  var SETTINGS_SPEC = [
    { group: 'Header', items: [
      { key: 'reportTitle', label: 'Report title', type: 'text' },
      { key: 'includeDate', label: 'Date line', type: 'toggle' },
      { key: 'includePhysician', label: 'Physician diagnostician line', type: 'toggle' },
      { key: 'includeOperator', label: 'Ultrasound operator line', type: 'toggle' },
      { key: 'includePatient', label: 'Patient / MRN / DOB line (and inputs)', type: 'toggle' },
      { key: 'includeIndication', label: 'Indication / prior-study lines', type: 'toggle' }
    ] },
    { group: 'Sections', items: [
      { key: 'includeGland', label: 'Thyroid (gland) section', type: 'toggle' },
      { key: 'includeNodules', label: 'Nodules section', type: 'toggle' },
      { key: 'includeLymphNodes', label: 'Lymph node section', type: 'toggle' },
      { key: 'includeImpression', label: 'Impression section', type: 'toggle' },
      { key: 'includeFreeText', label: 'Impression free text', type: 'toggle' }
    ] },
    { group: 'Measurements', items: [
      { key: 'includeMeasureNote', label: 'Top note: units + order', type: 'toggle' },
      { key: 'unit', label: 'Units', type: 'select', options: [['cm', 'centimeters (cm)'], ['mm', 'millimeters (mm)']] },
      { key: 'decimals', label: 'Decimals', type: 'number', min: 0, max: 2 },
      { key: 'dimOrder', label: 'Dimension order', type: 'select', options: [['lat', 'Longitudinal \u00D7 AP \u00D7 Transverse'], ['alt', 'AP \u00D7 Transverse \u00D7 Longitudinal'], ['tla', 'Transverse \u00D7 Longitudinal \u00D7 AP']] },
      { key: 'includeUnitInMeasurement', label: 'Unit after each measurement', type: 'toggle' },
      { key: 'lnDims', label: 'Lymph node size', type: 'select', options: [['single', 'Single value (largest dimension)'], ['3d', 'Three dimensions']] }
    ] },
    { group: 'Nodule lines', items: [
      { key: 'bullet', label: 'Bullet', type: 'select', options: [['-', '\u2013 (dash)'], ['\u2022', '\u2022 (round)'], ['numbered', '1. (numbered)']] },
      { key: 'noduleNumbering', label: 'Numbering', type: 'select', options: [['N1', 'N1, N2, \u2026'], ['1', '1, 2, \u2026']] },
      { key: 'numberingScheme', label: 'Numbering scheme', type: 'select', options: [['global', 'Global (1, 2, 3, \u2026)'], ['byLocation', 'By location (Right / Isthmus / Left)'], ['byLobe', 'By lobe only (Right / Left)']] },
      { key: 'includeBreakdown', label: 'Score breakdown in parentheses', type: 'toggle' },
      { key: 'includeZeroPointCategories', label: 'Include zero-point categories', type: 'toggle' },
      { key: 'includeSizeComment', label: 'Include size comment', type: 'toggle' }
    ] },
    { group: 'Impression / recommendations', items: [
      { key: 'includeNoduleSummary', label: 'Nodule summary in impression', type: 'toggle' },
      { key: 'includeLymphNodeSummary', label: 'Lymph node summary in impression', type: 'toggle' },
      { key: 'includeBiopsyRec', label: 'Biopsy recommendation block', type: 'toggle' },
      { key: 'includeFollowUpRec', label: 'Follow-up recommendation block', type: 'toggle' },
      { key: 'footerText', label: 'Footer text', type: 'textarea' }
    ] }
  ];

  /* By-lobe mode treats isthmus as a position flag, not a lobe; convert legacy values. */
  function migrateIsthmus(scheme) {
    state.nodules.forEach(function (n) {
      if (n.vertical === 'isthmus') { n.isthmus = true; n.vertical = 'middle'; }
      if (scheme === 'byLobe' && n.lobe === 'isthmus') { n.lobe = 'left'; n.isthmus = true; n.depth = ''; }
    });
  }

  function buildSettings() {
    var form = $('#settings-form');
    form.innerHTML = '';
    SETTINGS_SPEC.forEach(function (group) {
      var fs = document.createElement('fieldset');
      var legend = document.createElement('legend');
      legend.textContent = group.group;
      fs.appendChild(legend);
      group.items.forEach(function (item) {
        var row = el('div', 'setting-row');
        row.appendChild(el('span', null, item.label));
        var ctrl;
        if (item.type === 'toggle') {
          ctrl = el('input');
          ctrl.type = 'checkbox';
          ctrl.checked = !!state.settings[item.key];
          ctrl.addEventListener('change', function () {
            state.settings[item.key] = ctrl.checked;
            applyStudyVisibility();
            if (item.key === 'includeSizeComment') renderNoduleList();
            save(); renderReport();
          });
        } else if (item.type === 'select') {
          ctrl = el('select');
          item.options.forEach(function (o) {
            var op = el('option', null, o[1]);
            op.value = o[0];
            if (state.settings[item.key] === o[0]) op.selected = true;
            ctrl.appendChild(op);
          });
          ctrl.addEventListener('change', function () {
            var v = ctrl.value;
            state.settings[item.key] = v;
            if (item.key === 'unit') {
              state.settings.decimals = state.settings.unit === 'mm' ? 0 : 1;
              buildSettings();
              buildGlandSizes();
              renderNoduleList();
              renderLnList();
            } else if (item.key === 'dimOrder') {
              buildGlandSizes();
              renderNoduleList();
              renderLnList();
            } else if (item.key === 'lnDims') {
              state.lymphNodes.forEach(function (ln) {
                if (v === '3d' && !ln.dims[0] && ln.size) ln.dims[0] = ln.size;
                else if (v === 'single' && !ln.size) ln.size = ln.dims[0] || '';
              });
              renderLnList();
            } else if (item.key === 'numberingScheme') {
              migrateIsthmus(v);
              renderNoduleList();
            }
            save(); renderReport();
          });
        } else if (item.type === 'number') {

          ctrl = el('input');
          ctrl.type = 'number';
          ctrl.min = item.min; ctrl.max = item.max;
          ctrl.value = state.settings[item.key];
          ctrl.addEventListener('change', function () {
            state.settings[item.key] = parseInt(ctrl.value, 10) || item.min;
            save(); renderReport();
          });
        } else if (item.type === 'textarea') {
          ctrl = el('textarea');
          ctrl.rows = 2;
          ctrl.value = state.settings[item.key] || '';
          ctrl.addEventListener('input', function () {
            state.settings[item.key] = ctrl.value;
            save(); renderReport();
          });
        } else {
          ctrl = el('input');
          ctrl.type = 'text';
          ctrl.value = state.settings[item.key] || '';
          ctrl.addEventListener('input', function () {
            state.settings[item.key] = ctrl.value;
            save(); renderReport();
          });
        }
        row.appendChild(ctrl);
        fs.appendChild(row);
      });
      form.appendChild(fs);
    });
  }

  var drawer = $('#settings-drawer');
  $('#btn-settings').addEventListener('click', function () {
    drawer.classList.toggle('hidden');
    if (!drawer.classList.contains('hidden')) buildSettings();
  });
  $('#btn-save-settings').addEventListener('click', function () { drawer.classList.add('hidden'); });

  /* ---------------- copy / print / reset ---------------- */
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    var okCopy = false;
    try { okCopy = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    return okCopy;
  }

  $('#btn-copy').addEventListener('click', function () {
    var btn = $('#btn-copy');
    function flash(ok) {
      var old = btn.textContent;
      btn.textContent = ok ? 'Copied!' : 'Copy failed';
      setTimeout(function () { btn.textContent = old; }, 1500);
    }
    /* Rich clipboard: HTML (bold/underline/colors) with a plain-text fallback payload. */
    if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      try {
        var item = new ClipboardItem({
          'text/html': new Blob([htmlText], { type: 'text/html' }),
          'text/plain': new Blob([plainText], { type: 'text/plain' })
        });
        navigator.clipboard.write([item]).then(function () {
          flash(true);
        }, function () {
          flash(fallbackCopy(plainText));
        });
        return;
      } catch (e) { /* fall through */ }
    }
    flash(fallbackCopy(plainText));
  });

  $('#btn-print').addEventListener('click', function () { window.print(); });

  $('#btn-reset').addEventListener('click', function () {
    if (!confirm('Reset all data? This clears the report stored in this browser.')) return;
    state = defaultState();
    syncStudyInputs();
    buildGlandSizes();
    buildGlandChars();
    renderNoduleList();
    renderLnList();
    syncFreeText();
    applyStudyVisibility();
    save(); renderReport();
  });

  /* ---------------- init ---------------- */
  applyStudyVisibility();
  buildGlandSizes();
  buildGlandChars();
  renderNoduleList();
  renderLnList();
  buildSettings();
  renderReport();
  save();
})();


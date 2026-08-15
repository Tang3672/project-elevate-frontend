/* ============================================================================
 * medlevate/static/js/market-model.js
 *
 * Drop-in enhancement for §2 "The Market" of an already-generated report.
 *
 * PROGRESSIVE ENHANCEMENT
 *   If this file fails to load, the report renders exactly as it does today.
 *
 * RE-INIT CONTRACT
 *   Call window.initMedlevateModel() after report HTML is injected into DOM
 *   so the module can rebind to the new #market-model element.
 * ========================================================================== */

(function () {
'use strict';

/* ---------------------------------------------------------------- formatting */
function usd(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3).toLocaleString() + 'K';
  return '$' + Math.round(v).toLocaleString();
}
function int(v) { return Math.round(v).toLocaleString(); }
function pct(v) { return (v * 100).toFixed(1) + '%'; }

var FMT = {
  buyer_population: int, spend_per_unit: usd,
  sam_rate: pct, som_rate: pct,
  tam: usd, sam: usd, som: usd
};
var LABEL = {
  buyer_population: 'Eligible buyer population',
  spend_per_unit:   'Annualised spend per unit',
  sam_rate:         'Reachable penetration',
  som_rate:         '5-yr penetration'
};
var INPUT_KEYS = ['buyer_population', 'spend_per_unit', 'sam_rate', 'som_rate'];

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

/* -------------------------------------------------------------------- init */
function init() {
  var blob = document.getElementById('market-model');
  if (!blob) return;

  var REPORT_ID = blob.dataset.reportId || '';
  var API_BASE  = blob.dataset.apiBase  || '';
  var base, state, ops, notes, listeners, debounceTimer, pending;

  /* Auth header — same token store the rest of the app uses. */
  function _authHeaders(extra) {
    var h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    var tok = (typeof localStorage !== 'undefined') && localStorage.getItem('pe_token');
    if (tok) h['Authorization'] = 'Bearer ' + tok;
    return h;
  }

  try {
    base = JSON.parse(blob.textContent);
  } catch (e) {
    console.warn('market-model: JSON parse failed', e);
    return;
  }

  state     = Object.assign({}, base);
  ops       = [];
  notes     = [];
  listeners = [];
  pending   = null;

  /* -------------------------------------------------------------- derivation */
  function derive(s, opsList) {
    var o = opsList || ops;
    var v = Object.assign({}, s);
    INPUT_KEYS.forEach(function (k) {
      o.filter(function (x) { return x.target === k; }).forEach(function (x) {
        if (x.op === 'gate')  v[k] = v[k] * x.value;
        if (x.op === 'set')   v[k] = x.value;
        if (x.op === 'cap')   v[k] = Math.min(v[k], x.value);
        if (x.op === 'floor') v[k] = Math.max(v[k], x.value);
      });
    });
    v.tam = v.buyer_population * v.spend_per_unit;
    v.sam = v.tam * v.sam_rate;
    v.som = v.sam * v.som_rate;
    return v;
  }

  /* ------------------------------------------------------------ invariants */
  function problems(v) {
    var p = [];
    if (v.sam > v.tam + 1e-6) p.push('SAM exceeds TAM');
    if (v.som > v.sam + 1e-6) p.push('SOM exceeds SAM');
    if (!(v.tam > 0))         p.push('TAM is zero or negative');
    return p;
  }

  /* ----------------------------------------------------------------- paint */
  function paint() {
    var v = derive(state);
    Object.keys(FMT).forEach(function (k) {
      var els = document.querySelectorAll('[data-node="' + k + '"]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.tagName === 'INPUT') continue;
        var next = FMT[k](v[k]);
        if (el.textContent === next) continue;
        el.textContent = next;
        el.classList.remove('mv-flash');
        void el.offsetWidth;
        el.classList.add('mv-flash');
      }
    });
    paintBadges();
    paintGuard(v);
    paintDiff(derive(base, []), v);
    paintRecs(v);
    listeners.forEach(function (cb) { try { cb(v, ops.slice()); } catch (e) { console.error(e); } });
  }

  function paintBadges() {
    INPUT_KEYS.forEach(function (k) {
      var el = document.querySelector('[data-badge="' + k + '"]');
      if (!el) return;
      var touched = state[k] !== base[k] || ops.some(function (o) { return o.target === k; });
      el.textContent = touched ? 'you' : (el.dataset.original || 'assumed');
      el.className   = 'badge ' + (touched ? 'b-user' : 'b-assumed');
      el.style.background = touched ? 'var(--blue-lite)' : 'var(--bg-3)';
      el.style.color      = touched ? 'var(--blue)' : 'var(--text-3)';
    });
  }

  function paintGuard(v) {
    var g    = document.getElementById('mm-guard');
    var btns = document.querySelectorAll('[data-export-pdf]');
    var p    = problems(v);
    if (!g) return;
    if (p.length) {
      g.style.background = 'var(--red-bg)'; g.style.color = 'var(--red)';
      g.textContent = '✗ ' + p.join(' · ') + ' — adjust an input above to unlock export';
      for (var i = 0; i < btns.length; i++) btns[i].disabled = true;
    } else {
      g.style.background = 'var(--green-bg)'; g.style.color = 'var(--green)';
      g.textContent = '✓ Model consistent — export unlocked';
      for (var j = 0; j < btns.length; j++) btns[j].disabled = false;
    }
  }

  function paintDiff(b, v) {
    var panel = document.getElementById('mm-diff');
    if (!panel) return;
    var rows = [];
    ['tam', 'sam', 'som'].forEach(function (k) {
      if (Math.abs(v[k] - b[k]) < 1) return;
      var d = (v[k] - b[k]) / b[k] * 100;
      rows.push('<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:11px">' +
        '<span>' + k.toUpperCase() + '</span><span>' +
        usd(b[k]) + ' → ' + usd(v[k]) +
        ' <strong style="color:' + (d > 0 ? 'var(--green)' : 'var(--red)') + '">' +
        (d > 0 ? '+' : '') + d.toFixed(1) + '%</strong></span></div>');
    });
    panel.querySelector('.mm-diffrows').innerHTML = rows.join('');
    panel.hidden = rows.length === 0;
  }

  /* ---------------------------------------------- recommendations */
  var RECS = window.MEDLEVATE_RECS || [
    { id: 'funding', pick: function (v) {
        return v.som < 5e5 ? 'Non-dilutive only — SOM does not support outside capital'
             : v.som < 5e6 ? 'SBIR-first — capital-efficient build; a priced round is premature'
             : 'A priced seed round is defensible at this SOM'; } },
    { id: 'channel', pick: function (v) {
        return v.spend_per_unit < 2000  ? 'PI-direct sales — price sits under approval thresholds'
             : v.spend_per_unit < 20000 ? 'Core-facility bundling becomes the primary channel'
             : 'Institutional site licensing; expect 6–18mo procurement'; } },
    { id: 'investor', pick: function (v) {
        return v.som < 1e6 ? 'Institutional VC misaligned — check sizes exceed the entire SOM'
                           : 'SOM clears the floor for seed-stage institutional investors'; } }
  ];

  function paintRecs(v) {
    var panel = document.getElementById('mm-recs');
    if (!panel) return;
    var b = derive(base, []);
    var rows = RECS.filter(function (r) { return r.pick(v) !== r.pick(b); })
      .map(function (r) {
        return '<div style="padding:4px 0;font-size:11px;border-bottom:1px solid var(--border)">' +
          '<s style="color:var(--text-3)">' + esc(r.pick(b)) + '</s><br>→ <strong>' +
          esc(r.pick(v)) + '</strong></div>';
      });
    panel.querySelector('.mm-recrows').innerHTML = rows.join('');
    panel.hidden = rows.length === 0;
  }

  /* ----------------------------------------- natural language input */
  async function parseAssumption(text) {
    if (!REPORT_ID) throw new Error('No report ID — try reloading the report');
    var r = await fetch(API_BASE + '/alignment/reports/' + REPORT_ID + '/assumptions/parse', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ text: text, state: state, ops: ops })
    });
    if (!r.ok) throw new Error('parse failed: ' + r.status);
    return r.json();
  }

  function renderPreview(res, text) {
    var el = document.getElementById('mm-preview');
    if (!el) return;

    if (res.clarifying_question) {
      el.innerHTML = '<div style="padding:12px;background:var(--amber-bg);border:1px solid var(--border);border-left:3px solid var(--amber);margin-top:8px">' +
        '<p><strong>I need one number to make that change.</strong></p>' +
        '<p style="margin-top:6px;font-size:11.5px">' + esc(res.clarifying_question) + '</p>' +
        '<div style="margin-top:8px"><button type="button" id="mm-ask-ok" style="font-family:var(--display);font-size:11px;font-weight:700;background:transparent;color:var(--text-3);border:1px solid var(--border);padding:4px 10px;cursor:pointer;border-radius:2px">Got it</button></div></div>';
      document.getElementById('mm-ask-ok').onclick = function () {
        el.innerHTML = ''; document.getElementById('mm-nl').focus();
      };
      return;
    }

    var modelOps = res.ops.filter(function (o) { return o.op !== 'note'; });
    var noteOps  = res.ops.filter(function (o) { return o.op === 'note'; });
    pending = { modelOps: modelOps, noteOps: noteOps, text: text };

    var cur  = derive(state);
    var next = derive(state, ops.concat(modelOps));
    var VERB = { gate: 'Filter', set: 'Set', cap: 'Cap', floor: 'Floor' };
    var SYM  = { gate: '×', set: '=', cap: '≤', floor: '≥' };

    var html = '<div style="margin-top:12px;padding:14px;background:var(--bg-2);border:1px solid var(--border);border-radius:2px">' +
      '<div style="font-family:var(--display);font-size:12px;font-weight:700;margin-bottom:10px">Here\'s what I understood — edit anything that\'s wrong</div>';

    modelOps.forEach(function (o, i) {
      var before = cur[o.target];
      var after  = derive(state, ops.concat([o]))[o.target];
      var shown  = o.op === 'gate' ? (o.value * 100).toFixed(0) : o.value;
      html += '<div style="padding:8px 0;border-bottom:1px solid var(--border)">' +
        '<div style="display:flex;align-items:center;gap:8px;font-size:11.5px">' +
          '<span style="font-family:var(--display);font-size:10px;font-weight:700;text-transform:uppercase;background:var(--blue-lite);color:var(--blue);padding:2px 6px;border-radius:2px">' + VERB[o.op] + '</span>' +
          '<span>' + esc(LABEL[o.target] || o.target) + '</span>' +
          '<span style="color:var(--text-3)">' + SYM[o.op] + '</span>' +
          '<input type="number" data-op="' + i + '" value="' + shown + '" step="any" style="width:80px;font-family:var(--display);font-size:12px;font-weight:700;border:1px dashed var(--border);background:var(--bg);color:var(--text);padding:2px 6px;border-radius:2px">' +
          '<span style="color:var(--text-3)">' + (o.op === 'gate' ? '%' : (o.unit || '')) + '</span>' +
          '<span style="color:var(--text-4);font-size:10px">conf ' + Number(o.confidence).toFixed(2) + '</span>' +
        '</div>' +
        '<p style="font-size:10.5px;color:var(--text-3);margin-top:4px">“' + esc(o.quoted_span) + '”</p>' +
        '<p style="font-size:10.5px;color:var(--text-2);margin-top:2px">' + FMT[o.target](before) + ' → ' + FMT[o.target](after) +
          (Math.abs(after - before) < 1e-9 ? ' <span style="color:var(--text-4)">(no change)</span>' : '') +
        '</p></div>';
    });

    noteOps.forEach(function (o) {
      html += '<div style="padding:8px 0;border-bottom:1px solid var(--border)">' +
        '<div style="display:flex;align-items:center;gap:8px;font-size:11.5px">' +
          '<span style="font-family:var(--display);font-size:10px;font-weight:700;text-transform:uppercase;background:var(--bg-3);color:var(--text-3);padding:2px 6px;border-radius:2px">On record</span>' +
          '<span style="color:var(--text-3)">Not a market parameter — recorded, no effect on numbers</span>' +
        '</div>' +
        '<p style="font-size:10.5px;color:var(--text-3);margin-top:4px">“' + esc(o.quoted_span) + '”</p></div>';
    });

    if (modelOps.length) {
      var changed = RECS.filter(function (r) { return r.pick(cur) !== r.pick(next); }).length;
      html += '<div style="margin-top:8px">';
      ['tam', 'sam', 'som'].forEach(function (k) {
        var d = (next[k] - cur[k]) / cur[k] * 100;
        html += '<div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0"><span>' + k.toUpperCase() + '</span><span>' +
          usd(cur[k]) + ' → ' + usd(next[k]) +
          ' <strong style="color:' + (d > 0 ? 'var(--green)' : 'var(--red)') + '">' +
          (d > 0 ? '+' : '') + d.toFixed(1) + '%</strong></span></div>';
      });
      if (changed) html += '<div style="font-size:11px;color:var(--text-3);padding:3px 0">' + changed + ' recommendation' + (changed > 1 ? 's' : '') + ' would change</div>';
      html += '</div>';
    }

    html += '<div style="margin-top:10px;display:flex;gap:8px">' +
      '<button type="button" id="mm-discard" style="font-family:var(--display);font-size:11px;font-weight:700;background:transparent;color:var(--text-3);border:1px solid var(--border);padding:5px 12px;cursor:pointer;border-radius:2px">Discard</button>' +
      '<button type="button" id="mm-apply" style="font-family:var(--display);font-size:11px;font-weight:700;background:var(--blue);color:#fff;border:none;padding:5px 12px;cursor:pointer;border-radius:2px">Apply ' +
      (modelOps.length + noteOps.length) + '</button></div></div>';

    el.innerHTML = html;

    el.querySelectorAll('[data-op]').forEach(function (inp) {
      inp.addEventListener('input', function (e) {
        var o = pending.modelOps[+e.target.dataset.op];
        var raw = parseFloat(e.target.value);
        if (isNaN(raw)) return;
        o.value = o.op === 'gate' ? raw / 100 : raw;
        renderPreview({ ops: pending.modelOps.concat(pending.noteOps) }, pending.text);
      });
    });

    document.getElementById('mm-discard').onclick = function () { el.innerHTML = ''; pending = null; };
    document.getElementById('mm-apply').onclick = function () { applyPending(); };
  }

  async function applyPending() {
    if (!pending) return;
    var payload = { text: pending.text, ops: pending.modelOps.concat(pending.noteOps) };
    pending.modelOps.forEach(function (o) {
      o.id = o.id || 'o' + Math.random().toString(36).slice(2, 8);
      ops.push(o);
    });
    pending.noteOps.forEach(function (o) {
      o.id = o.id || 'n' + Math.random().toString(36).slice(2, 8);
      notes.push(o);
    });
    document.getElementById('mm-preview').innerHTML = '';
    pending = null;
    renderLedger();
    paint();
    try {
      await fetch(API_BASE + '/alignment/reports/' + REPORT_ID + '/assumptions/apply', {
        method: 'POST', headers: _authHeaders(),
        body: JSON.stringify(payload)
      });
    } catch (e) { console.warn('assumption not persisted', e); }
  }

  /* ----------------------------------------------------------------- ledger */
  function renderLedger() {
    var L = document.getElementById('mm-ledger');
    if (!L) return;
    L.innerHTML = ops.length ? ops.map(function (o) {
      var sym = o.op === 'gate'  ? '×' + o.value.toFixed(2)
              : o.op === 'cap'   ? '≤' + FMT[o.target](o.value)
              : o.op === 'floor' ? '≥' + FMT[o.target](o.value)
              : '=' + FMT[o.target](o.value);
      return '<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border);font-size:11px">' +
        '<span style="font-family:var(--display);font-weight:700;min-width:60px">' + sym + '</span>' +
        '<span style="flex:1"><strong>' + esc(o.label || o.op) + '</strong> — ' + esc(LABEL[o.target] || o.target) + '<br>' +
        '<span style="color:var(--text-3)">“' + esc(o.quoted_span) + '”</span></span>' +
        '<button type="button" data-del="' + o.id + '" style="font-family:var(--display);font-size:10px;font-weight:700;background:transparent;color:var(--text-4);border:1px solid var(--border);padding:2px 6px;cursor:pointer;border-radius:2px">remove</button></div>';
    }).join('') : '<p style="font-size:11px;color:var(--text-4);padding:6px 0">No assumptions added yet.</p>';

    L.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () {
        var i = ops.findIndex(function (o) { return o.id === b.dataset.del; });
        if (i > -1) ops.splice(i, 1);
        renderLedger(); paint();
        fetch(API_BASE + '/alignment/reports/' + REPORT_ID + '/assumptions/' + b.dataset.del,
          { method: 'DELETE', headers: _authHeaders() })
          .catch(function () {});
      };
    });

    var N = document.getElementById('mm-notes');
    if (N) {
      N.innerHTML = notes.length
        ? notes.map(function (n) {
            return '<div style="font-size:11px;padding:4px 0;border-bottom:1px solid var(--border);color:var(--text-3)">“' + esc(n.quoted_span) + '”</div>';
          }).join('')
        : '<p style="font-size:11px;color:var(--text-4);padding:4px 0">None.</p>';
    }
  }

  /* ----------------------------------------------------------------- wiring */
  document.querySelectorAll('[data-input]').forEach(function (el) {
    el.addEventListener('input', function (e) {
      var v = parseFloat(e.target.value);
      if (isNaN(v)) return;
      // data-input-scale="0.01" for percentage inputs (sam_rate, som_rate shown as %)
      var scale = parseFloat(e.target.dataset.inputScale || '1');
      state[e.target.dataset.input] = v * scale;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(paint, 120);
    });
  });

  var btnInterpret = document.getElementById('mm-interpret');
  if (btnInterpret) {
    btnInterpret.onclick = async function () {
      var ta   = document.getElementById('mm-nl');
      var text = ta.value.trim();
      if (!text) return;
      btnInterpret.disabled = true;
      btnInterpret.textContent = 'Reading…';
      try {
        renderPreview(await parseAssumption(text), text);
        ta.value = '';
      } catch (e) {
        document.getElementById('mm-preview').innerHTML =
          '<div style="padding:10px;background:var(--bg-2);border:1px solid var(--border);font-size:11.5px;color:var(--text-3)">' +
          'Could not interpret that right now. You can still edit the values directly above.</div>';
      } finally {
        btnInterpret.disabled = false;
        btnInterpret.textContent = 'Interpret';
      }
    };
  }

  var btnReset = document.getElementById('mm-reset');
  if (btnReset) {
    btnReset.onclick = function () {
      Object.assign(state, base);
      ops.length = 0; notes.length = 0;
      document.querySelectorAll('[data-input]').forEach(function (el) {
        var scale = parseFloat(el.dataset.inputScale || '1');
        el.value = scale !== 1 ? (base[el.dataset.input] / scale).toFixed(1) : base[el.dataset.input];
      });
      var p = document.getElementById('mm-preview'); if (p) p.innerHTML = '';
      renderLedger(); paint();
    };
  }

  /* ========================================================= PUBLIC INTERFACE */
  window.MedlevateModel = {
    reportId:    REPORT_ID,
    getValues:   function () { return derive(state); },
    getBase:     function () { return derive(base, []); },
    getInputs:   function () { return Object.assign({}, state); },
    getOps:      function () { return ops.slice(); },
    getNotes:    function () { return notes.slice(); },
    isEdited:    function () {
      return ops.length > 0 || notes.length > 0 ||
        INPUT_KEYS.some(function (k) { return state[k] !== base[k]; });
    },
    isValid:     function () { return problems(derive(state)).length === 0; },
    getProblems: function () { return problems(derive(state)); },
    format:      { usd: usd, int: int, pct: pct },
    onChange:    function (cb) { listeners.push(cb); },
    /* Inject persisted ops after async load (e.g. on page reload). */
    loadOps: function (savedOps) {
      (savedOps || []).forEach(function (o) {
        if (o.op === 'note') notes.push(o);
        else ops.push(o);
      });
      renderLedger();
      paint();
    },
    exportPayload: function () {
      var v = derive(state);
      return {
        report_id:   REPORT_ID,
        values:      v,
        formatted:   Object.keys(FMT).reduce(function (a, k) { a[k] = FMT[k](v[k]); return a; }, {}),
        inputs:      Object.assign({}, state),
        baseline:    derive(base, []),
        assumptions: ops.map(function (o) {
          return { op: o.op, target: o.target, value: o.value,
                   label: o.label, quoted_span: o.quoted_span };
        }),
        notes:  notes.map(function (n) { return n.quoted_span; }),
        edited: window.MedlevateModel.isEdited(),
        valid:  window.MedlevateModel.isValid()
      };
    }
  };

  /* ------------------------------------------------- load persisted assumptions
     Fires async so the initial paint is instant; saved ops arrive and re-render
     without blocking. No-ops silently if the endpoint returns empty or errors. */
  if (REPORT_ID) {
    fetch(API_BASE + '/alignment/reports/' + REPORT_ID + '/assumptions',
          { headers: _authHeaders() })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (saved) { if (saved && saved.length) window.MedlevateModel.loadOps(saved); })
      .catch(function () {});
  }

  /* ------------------------------------------------------ narrative staleness
     Paragraphs tagged [data-narrative][data-sensitive-to="tam,sam,..."] get
     the mm-stale class (amber left border + regenerate button) when the user
     moves any sensitive key >15% from its reference point.
     Reference = engine baseline until the section is regenerated; after regen
     it tracks from the values at the time of last regeneration (stored in
     data-regen-values) so stale doesn't immediately re-fire on fresh prose. */
  window.MedlevateModel.onChange(function(v) {
    var engineBase = window.MedlevateModel.getBase();
    document.querySelectorAll('[data-narrative]').forEach(function(el) {
      var keys = (el.dataset.sensitiveTo || '').split(',').filter(Boolean);
      var ref  = el.dataset.regenValues ? JSON.parse(el.dataset.regenValues) : engineBase;
      var stale = keys.some(function(k) {
        return ref[k] > 0 && Math.abs(v[k] - ref[k]) / ref[k] > 0.15;
      });
      el.classList.toggle('mm-stale', stale);
      var btn = el.querySelector('.mm-regen-btn');
      if (stale && !btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mm-regen-btn';
        btn.textContent = 'Regenerate this section';
        btn.onclick = async function() {
          // Capture prose text before the button pollutes textContent
          var clone = el.cloneNode(true);
          var cloneBtn = clone.querySelector('.mm-regen-btn');
          if (cloneBtn) cloneBtn.remove();
          var currentText = clone.textContent.trim();

          btn.disabled = true; btn.textContent = 'Regenerating…';
          try {
            var M = window.MedlevateModel;
            var resp = await fetch(
              API_BASE + '/alignment/reports/' + REPORT_ID + '/assumptions/regenerate-section',
              {
                method: 'POST',
                headers: _authHeaders(),
                body: JSON.stringify({
                  section:         el.dataset.narrative,
                  original_text:   currentText,
                  current_values:  M.getValues(),
                  baseline_values: M.getBase(),
                  assumptions:     M.getOps(),
                }),
              }
            );
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            var data = await resp.json();
            // Store regen-time values so staleness tracks from here
            el.dataset.regenValues = JSON.stringify(M.getValues());
            el.classList.remove('mm-stale');
            el.innerHTML = data.html;           // replaces button too — that's correct
          } catch (e) {
            console.error('regen failed', e);
            btn.disabled = false; btn.textContent = 'Regenerate this section';
          }
        };
        el.appendChild(btn);
      } else if (!stale && btn) {
        btn.remove();
      }
    });
  });

  renderLedger();
  paint();
}

/* Expose for app.html to call after report renders, and auto-init at load. */
window.initMedlevateModel = init;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
})();

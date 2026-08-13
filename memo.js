/* NVS daily memo — per-day notes + carried-forward checklist.
   memo-20260814d
   Depends on globals defined in index.html: db (firebase.database()), firebase.
   Defines window.initMemo(email) and window.nvsMemo.*

   The notes area is a plain <textarea> with NO key handling of its own, so a
   Japanese IME behaves exactly as it does anywhere else — pressing space/enter
   to pick a kanji candidate is never mistaken for an editing command. The only
   magic is that a finished "- xxx" line is lifted out into the day's checklist.
   Notes are plain text; there is no markdown. */
(function () {
  'use strict';

  var CSS = [
    '#memoWrap{display:flex;flex-direction:column}',
    '#memoBar{display:flex;align-items:center;gap:10px;background:var(--ink);color:var(--lcd);padding:1px 8px;flex:none}',
    '#memoBar .mtitle{font-weight:bold}',
    '#memoStat{margin-left:auto;color:var(--lcd2)}',
    '#memoUndo{cursor:pointer;text-decoration:underline dotted;color:var(--lcd)}',
    '#dayBar{display:flex;align-items:center;gap:6px;flex:none;padding:1px 6px;',
    '        background:var(--lcd2);border-bottom:1px solid var(--ink);user-select:none}',
    '#dayBar .nav{cursor:pointer;padding:0 6px;font-weight:bold}',
    '#dayBar .nav:hover{background:var(--ink);color:var(--lcd)}',
    '#dayBar .lbl{font-weight:bold;flex:1 1 auto;text-align:center}',
    '#dayBar .lbl.other{color:var(--ink2)}',
    '#dayBar .tdy{cursor:pointer;border:1px solid var(--ink2);padding:0 5px}',
    '#dayBar .tdy:hover{background:var(--ink);color:var(--lcd);border-color:var(--ink)}',
    '#taskList{flex:0 1 auto;overflow:auto;padding:2px 4px 3px;border-bottom:1px solid var(--ink2)}',
    '#taskList:empty{display:none;border:0}',
    '.tk{display:flex;align-items:flex-start;gap:5px;padding:0 2px;line-height:1.35}',
    '.tk:hover{background:var(--lcd2)}',
    '.tk.cur{background:var(--ink);color:var(--lcd)}',
    '.tk.cur .org,.tk.cur .go,.tk.cur .rm{color:var(--lcd2)}',
    '.tk.cur.done .tx,.tk.cur.done .ck{color:var(--lcd2)}',
    '.tk .ck{cursor:pointer;flex:none;width:1.2em;text-align:center}',
    '.tk .ck:hover{background:var(--ink);color:var(--lcd)}',
    '.tk .tx{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;cursor:text;white-space:pre-wrap}',
    '.tk .tx:focus{outline:0;background:var(--lcd2);color:var(--ink)}',
    '.tk .org{flex:none;color:var(--ink2)}',
    '.tk .org.new{opacity:.45}',
    '.tk .go,.tk .rm{cursor:pointer;flex:none;padding:0 3px;color:var(--ink2)}',
    '.tk .go:hover,.tk .rm:hover{background:var(--ink);color:var(--lcd)}',
    '.tk.done .tx{text-decoration:line-through;color:var(--ink2)}',
    '.tk.done .ck{color:var(--ink2)}',
    '#memoEd{flex:1 1 auto;min-height:60px;width:100%;border:0;outline:0;resize:none;',
    '        background:var(--lcd);color:var(--ink);padding:3px 8px;',
    '        font-family:var(--sheet);font-size:var(--fs);line-height:1.35;letter-spacing:0;',
    '        -webkit-font-smoothing:inherit}',
    '#memoEd::placeholder{color:var(--ink2)}'
  ].join('\n');

  var st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  // ---------- dates ----------
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  function p2(n) { return n < 10 ? '0' + n : '' + n; }
  function dstr(d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function today() { return dstr(new Date()); }
  function parseDay(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function shiftDay(s, n) { var d = parseDay(s); d.setDate(d.getDate() + n); return dstr(d); }
  function jp(s) { var p = String(s).split('-'); return p[0] + '/' + (+p[1]) + '/' + (+p[2]); }

  // ---------- state ----------
  var tasks = {};            // id -> {text, created, due, done, doneAt, by}
  var notes = {};            // 'YYYY-MM-DD' -> plain text
  var day = today();
  var me = '';
  var cursor = null;         // highlighted task (j/k move it, x toggles, d deletes)
  var trash = null, trashTimer = null;
  var saveTimer = null, typing = 0;
  var composing = false;     // true while the IME is mid-conversion
  // Two guards that make it impossible to overwrite a day's notes by accident:
  //   loaded — the nvs/notes snapshot has arrived, so we know the real text
  //   dirty  — the user has actually edited the day currently on screen
  // Without these, focusing the box before the snapshot lands left it empty and
  // the next save wrote that emptiness over the day. (Cost one day of notes.)
  var loaded = false, dirty = false;
  var wrap, dayLbl, list, ta, stat, undo, ready = false;

  function setStat(s) { if (stat) stat.textContent = s; }

  // ---------- shell ----------
  function build() {
    wrap = document.getElementById('memoWrap');
    if (!wrap) return false;
    wrap.innerHTML =
      '<div id="memoBar"><span class="mtitle">MEMO</span>' +
        '<span id="memoUndo" style="display:none"></span><span id="memoStat"></span></div>' +
      '<div id="dayBar">' +
        '<span class="nav" id="dPrev" title="previous day">‹</span>' +
        '<span class="lbl" id="dLbl"></span>' +
        '<span class="nav" id="dNext" title="next day">›</span>' +
        '<span class="tdy" id="dTdy" title="jump to today">today</span>' +
      '</div>' +
      '<div id="taskList"></div>' +
      '<textarea id="memoEd" spellcheck="false" ' +
        'placeholder="notes for the day — start a line with &quot;- &quot; to make it a task"></textarea>';
    dayLbl = document.getElementById('dLbl');
    list = document.getElementById('taskList');
    ta = document.getElementById('memoEd');
    stat = document.getElementById('memoStat');
    undo = document.getElementById('memoUndo');
    undo.onclick = undelete;
    document.getElementById('dPrev').onclick = function () { go(-1); };
    document.getElementById('dNext').onclick = function () { go(1); };
    document.getElementById('dTdy').onclick = function () { go(0, today()); };
    wireEditor();
    return true;
  }

  function go(n, to) {
    flush();
    day = to || shiftDay(day, n);
    setText(notes[day] || '');
    dirty = false;                           // the new day is showing what the server has
    renderAll();
  }

  // ---------- tasks ----------
  // Open tasks accumulate: a task shows on day D while it is open and due <= D.
  // A finished task stays on the day it was finished, struck out.
  function forDay(d) {
    var open = [], done = [];
    Object.keys(tasks).forEach(function (id) {
      var t = tasks[id];
      if (!t || !t.text) return;
      if (t.done) { if (t.doneAt === d) done.push([id, t]); }
      else if ((t.due || t.created) <= d) open.push([id, t]);
    });
    function by(a, b) {
      var x = (a[1].created || '') + '/' + (a[1].at || 0);
      var y = (b[1].created || '') + '/' + (b[1].at || 0);
      return x < y ? -1 : x > y ? 1 : 0;
    }
    open.sort(by); done.sort(by);
    return open.concat(done);
  }
  function ids() { return forDay(day).map(function (p) { return p[0]; }); }

  function addTask(txt, d) {
    var ref = db.ref('nvs/tasks').push();
    ref.set({
      text: txt, created: d, due: d, done: false,
      by: me, at: firebase.database.ServerValue.TIMESTAMP
    }).catch(function (e) { setStat('save failed: ' + (e && e.message)); });
    return ref.key;
  }
  function upTask(id, patch) {
    db.ref('nvs/tasks/' + id).update(patch)
      .catch(function (e) { setStat('save failed: ' + (e && e.message)); });
  }

  function moveCursor(n) {
    var l = ids();
    if (!l.length) { cursor = null; return; }
    var i = l.indexOf(cursor);
    i = (i < 0) ? (n > 0 ? 0 : l.length - 1) : Math.max(0, Math.min(l.length - 1, i + n));
    cursor = l[i];
    renderTasks();
    var el = list.querySelector('.tk.cur');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }
  // done is done — one keystroke, no follow-up prompt
  function toggle(id) {
    id = id || cursor || ids()[0];
    if (!id) return;
    cursor = id;
    var t = tasks[id];
    if (!t) return;
    upTask(id, t.done ? { done: false, doneAt: null } : { done: true, doneAt: day });
  }
  // delete for good, with a short window to take it back
  function removeTask(id) {
    id = id || cursor;
    if (!id || !tasks[id]) return;
    var l = ids(), i = l.indexOf(id);
    cursor = l[i + 1] || l[i - 1] || null;
    var t = tasks[id];
    trash = { text: t.text, created: t.created, due: t.due, done: !!t.done, doneAt: t.doneAt || null, by: t.by || me };
    db.ref('nvs/tasks/' + id).remove()
      .catch(function (e) { setStat('delete failed: ' + (e && e.message)); });
    undo.textContent = 'deleted “' + String(t.text).slice(0, 22) + '” — undo';
    undo.style.display = '';
    clearTimeout(trashTimer);
    trashTimer = setTimeout(function () { trash = null; undo.style.display = 'none'; }, 15000);
  }
  function undelete() {
    if (!trash) return;
    var t = trash;
    trash = null;
    clearTimeout(trashTimer);
    undo.style.display = 'none';
    var ref = db.ref('nvs/tasks').push();
    ref.set({
      text: t.text, created: t.created, due: t.due, done: t.done, doneAt: t.doneAt,
      by: t.by, at: firebase.database.ServerValue.TIMESTAMP
    }).catch(function (e) { setStat('restore failed: ' + (e && e.message)); });
    cursor = ref.key;
  }

  // Fire on mousedown, not click: if the notes area has focus, its blur handler
  // can rebuild these rows between mousedown and mouseup and lose the click.
  function onTap(el, fn) {
    el.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); fn(); });
    el.addEventListener('touchstart', function (e) { e.preventDefault(); fn(); }, { passive: false });
  }

  function renderTasks() {
    if (!list) return;
    var alive = ids();
    if (cursor && alive.indexOf(cursor) < 0) cursor = null;
    list.innerHTML = '';
    forDay(day).forEach(function (pair) {
      var id = pair[0], t = pair[1];
      var row = document.createElement('div');
      row.className = 'tk' + (t.done ? ' done' : '') + (cursor === id ? ' cur' : '');
      row.dataset.id = id;

      var ck = document.createElement('span');
      ck.className = 'ck';
      ck.textContent = t.done ? '☑' : '☐';
      ck.title = t.done ? 'reopen' : 'mark done';
      onTap(ck, function () { cursor = id; toggle(id); });
      row.appendChild(ck);

      // plain text, and no key handling — the IME needs to own every keystroke
      var tx = document.createElement('span');
      tx.className = 'tx';
      tx.textContent = t.text;
      tx.contentEditable = 'true';
      tx.spellcheck = false;
      tx.onfocus = function () { cursor = id; };
      tx.onblur = function () {
        var v = tx.textContent.replace(/\s+$/, '').replace(/^\s+/, '');
        if (v && v !== t.text) upTask(id, { text: v });
        else tx.textContent = t.text;
      };
      row.appendChild(tx);

      // an open task always carries the date it was raised, so its age is visible
      if (!t.done && t.created) {
        var org = document.createElement('span');
        org.className = 'org' + (t.created === day ? ' new' : '');
        org.textContent = '(' + jp(t.created) + ')';
        org.title = t.created === day ? 'raised today' : 'open since ' + jp(t.created);
        row.appendChild(org);
      }
      if (!t.done) {
        var gb = document.createElement('span');
        gb.className = 'go';
        gb.textContent = '→';
        gb.title = 'push to ' + jp(shiftDay(day, 1));
        onTap(gb, function () { upTask(id, { due: shiftDay(day, 1) }); });
        row.appendChild(gb);
      }
      var rm = document.createElement('span');
      rm.className = 'rm';
      rm.textContent = '×';
      rm.title = 'delete this task';
      onTap(rm, function () { removeTask(id); });
      row.appendChild(rm);

      list.appendChild(row);
    });
  }

  // ---------- notes ----------
  function setText(t) { if (ta) ta.value = (t == null ? '' : String(t)); }

  // Lift finished "- xxx" lines into the checklist. The line the caret sits on is
  // left alone (you may still be typing it) unless `all` is set, and nothing at
  // all happens mid-conversion, so the IME is never disturbed.
  function capture(all) {
    if (!ta || composing) return false;
    var val = ta.value;
    if (val.indexOf('-') < 0) return false;
    var caret = ta.selectionStart;
    var lines = val.split('\n');
    var starts = [0];
    for (var i = 0; i < val.length; i++) if (val.charAt(i) === '\n') starts.push(i + 1);
    var caretLine = 0;
    for (var j = 0; j < starts.length; j++) if (caret >= starts[j]) caretLine = j;

    var keep = [], grabbed = 0, removedBefore = 0;
    lines.forEach(function (l, k) {
      var m = /^\s*-\s+(.+?)\s*$/.exec(l);
      if (m && (all || k !== caretLine)) {
        addTask(m[1], day);
        grabbed++;
        if (starts[k] < caret) removedBefore += l.length + 1;
      } else keep.push(l);
    });
    if (!grabbed) return false;
    dirty = true;                            // the text really did change
    var next = keep.join('\n');
    ta.value = next;
    var c = Math.max(0, Math.min(next.length, caret - removedBefore));
    try { ta.setSelectionRange(c, c); } catch (e) {}
    return true;
  }

  function saveSoon() {
    typing = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  }
  function save() {
    clearTimeout(saveTimer);
    if (!ta) return;
    if (!loaded || !dirty) return;          // never write a day we never really showed
    var t = ta.value, d = day;
    if ((notes[d] || '') === t) return;
    notes[d] = t;
    setStat('…');
    db.ref('nvs/notes/' + d).set({
      text: t, by: me, at: firebase.database.ServerValue.TIMESTAMP
    }).then(function () { setStat('saved'); })
      .catch(function (e) { setStat('save failed: ' + (e && e.message)); });
  }
  function flush() { var grabbed = capture(true); save(); return grabbed; }

  function wireEditor() {
    // IME: never touch the field between compositionstart and compositionend
    ta.addEventListener('compositionstart', function () { composing = true; });
    ta.addEventListener('compositionend', function () {
      composing = false;
      dirty = true;
      saveSoon();
    });
    ta.addEventListener('input', function (e) {
      if (composing || (e && e.isComposing)) return;
      dirty = true;
      if (capture(false)) renderTasks();
      saveSoon();
    });
    ta.addEventListener('blur', function () {
      composing = false;
      if (flush()) renderTasks();
    });
    // deliberately no keydown handler: every key belongs to the IME / the browser
  }

  // ---------- render ----------
  function renderAll() {
    if (!wrap) return;
    var t = today();
    dayLbl.textContent = jp(day) + ' (' + WD[parseDay(day).getDay()] + ')' +
                         (day === t ? '' : day < t ? ' ◂' : ' ▸');
    dayLbl.className = 'lbl' + (day === t ? '' : ' other');
    renderTasks();
  }

  // ---------- boot ----------
  function init(email) {
    me = String(email || '').split('@')[0];
    if (ready) return;
    if (!build()) return;
    ready = true;

    db.ref('nvs/tasks').on('value', function (snap) {
      tasks = snap.val() || {};
      renderTasks();
    });
    db.ref('nvs/notes').on('value', function (snap) {
      var all = snap.val() || {};
      notes = {};
      Object.keys(all).forEach(function (d) { notes[d] = (all[d] && all[d].text) || ''; });
      var rec = all[day];
      if (rec && rec.at) {
        var w = new Date(rec.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        setStat((rec.by || '') + ' · ' + w);
      }
      loaded = true;
      // Fill the box whenever the user has not edited this day — even if it has
      // focus, because an empty focused box is exactly how notes used to be lost.
      // Once they have edited, never yank the text out from under them.
      if (!dirty && !composing) setText(notes[day] || '');
    });

    setText(notes[day] || '');
    dirty = false;
    renderAll();
    window.addEventListener('beforeunload', flush);
  }

  window.initMemo = init;
  window.nvsMemo = {
    go: function (n) { go(n); },
    today: function () { go(0, today()); },
    move: function (n) { moveCursor(n); },
    toggle: function () { toggle(); },
    remove: function () { removeTask(); },
    undelete: undelete,
    day: function () { return day; },
    editing: function () { return document.activeElement === ta; }
  };
})();

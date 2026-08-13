/* NVS daily memo — per-day markdown notes + carried-forward checklist.
   memo-20260814b
   Depends on globals defined in index.html: db (firebase.database()), firebase.
   Defines window.initMemo(email) and window.nvsMemo.go(n).

   Editing model: `lines` (an array of raw markdown source lines) is the truth.
   The DOM is only a projection of it — the line holding the caret is drawn with
   its markers visible (so its textContent === its source and the caret offset is
   exact); every other line is drawn clean. Anything that would edit across lines
   (Enter, Backspace at a line start, paste, multi-line selection) is applied to
   the model by hand, because letting the browser do it would lose the hidden
   markers and scramble the source. */
(function () {
  'use strict';

  var CSS = [
    '#memoWrap{display:flex;flex-direction:column}',
    '#memoBar{display:flex;align-items:center;gap:10px;background:var(--ink);color:var(--lcd);padding:1px 8px;flex:none}',
    '#memoBar .mtitle{font-weight:bold}',
    '#memoStat{margin-left:auto;color:var(--lcd2)}',
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
    '.tk.cur .org,.tk.cur .go{color:var(--lcd2)}',
    '.tk.cur.done .tx,.tk.cur.done .ck{color:var(--lcd2)}',
    '.tk .ck{cursor:pointer;flex:none;width:1.2em;text-align:center}',
    '.tk .ck:hover{background:var(--ink);color:var(--lcd)}',
    '.tk .tx{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;cursor:text}',
    '.tk .tx:focus{outline:0;background:var(--lcd2)}',
    '.tk .org{flex:none;color:var(--ink2)}',
    '.tk .org.new{opacity:.45}',
    '.tk .go{cursor:pointer;flex:none;padding:0 3px;color:var(--ink2)}',
    '.tk .go:hover{background:var(--ink);color:var(--lcd)}',
    '.tk.done .tx{text-decoration:line-through;color:var(--ink2)}',
    '.tk.done .ck{color:var(--ink2)}',
    '.tk .rm{cursor:pointer;flex:none;padding:0 3px;color:var(--ink2)}',
    '.tk .rm:hover{background:var(--ink);color:var(--lcd)}',
    '.tk.cur .rm{color:var(--lcd2)}',
    '#memoUndo{cursor:pointer;text-decoration:underline dotted;color:var(--lcd)}',
    '#memoEd{flex:1 1 auto;min-height:60px;overflow:auto;padding:3px 8px;outline:0;',
    '        white-space:pre-wrap;overflow-wrap:anywhere;cursor:text}',
    '#memoEd .ln{min-height:1.35em;line-height:1.35}',
    '#memoEd .ln.h1{font-size:1.5em;font-weight:bold;background:var(--ink);color:var(--lcd);padding:0 4px}',
    '#memoEd .ln.h2{font-size:1.25em;font-weight:bold;background:var(--ink2);color:var(--lcd);padding:0 4px}',
    '#memoEd .ln.h3{font-size:1.125em;font-weight:bold;border-bottom:1px solid var(--ink2)}',
    '#memoEd .ln.h4{font-weight:bold}',
    '#memoEd .ln.quote{padding-left:8px;border-left:3px solid var(--ink2);color:var(--ink2)}',
    '#memoEd .ln.rule{border-top:1px dashed var(--ink2)}',
    '#memoEd .ln.rule .mkhide{display:none}',
    '#memoEd .mk{color:var(--ink2);opacity:.5}',
    '#memoEd code{background:var(--ink);color:var(--lcd);padding:0 3px}',
    '#memoEd a{color:var(--ink);text-decoration:underline}',
    '#memoEd .hint{color:var(--ink2)}'
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

  // ---------- inline markdown — only *closed* markers render ----------
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function inline(sIn, keepMarks) {
    var h = esc(sIn);
    function mk(t) { return keepMarks ? '<span class="mk">' + t + '</span>' : ''; }
    h = h.replace(/`([^`\n]+)`/g, function (_, a) { return mk('`') + '<code>' + a + '</code>' + mk('`'); });
    h = h.replace(/\*\*([^*\n]+)\*\*/g, function (_, a) { return mk('**') + '<b>' + a + '</b>' + mk('**'); });
    h = h.replace(/~~([^~\n]+)~~/g, function (_, a) { return mk('~~') + '<del>' + a + '</del>' + mk('~~'); });
    h = h.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, function (_, pre, a) {
      return pre + mk('*') + '<i>' + a + '</i>' + mk('*');
    });
    h = h.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, function (_, t, u) {
      return keepMarks
        ? '<span class="mk">[</span>' + t + '<span class="mk">](' + esc(u) + ')</span>'
        : '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + t + '</a>';
    });
    return h;
  }
  // NOTE: every branch below keeps the line's textContent identical to its source
  // when caret===true, which is what makes exact caret restoration possible.
  function lineHtml(text, caret) {
    if (text === '') return '<br>';
    if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(text)) {
      return caret ? '<span class="mk">' + esc(text) + '</span>'
                   : '<span class="mkhide">' + esc(text) + '</span>';
    }
    var m = /^(#{1,4})(\s+)([\s\S]*)$/.exec(text);
    if (m) {
      return caret ? '<span class="mk">' + m[1] + m[2] + '</span>' + inline(m[3], true)
                   : inline(m[3], false);
    }
    var q = /^>(\s?)([\s\S]*)$/.exec(text);
    if (q) {
      return caret ? '<span class="mk">&gt;' + q[1] + '</span>' + inline(q[2], true)
                   : inline(q[2], false);
    }
    return inline(text, !!caret);
  }
  function lineClass(text) {
    var m = /^(#{1,4})\s+/.exec(text);
    if (m) return 'ln h' + m[1].length;
    if (/^>\s?/.test(text)) return 'ln quote';
    if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(text)) return 'ln rule';
    return 'ln';
  }

  // ---------- state ----------
  var tasks = {};            // id -> {text, created, due, done, doneAt, next, by}
  var notes = {};            // 'YYYY-MM-DD' -> source text
  var lines = [''];          // the editor's model for the day on screen
  var day = today();
  var me = '';
  var cursor = null;         // id of the highlighted task (keyboard: j/k, x toggles)
  var trash = null;          // the last deleted task, kept briefly so it can be undone
  var trashTimer = null;
  var saveTimer = null, typing = 0;
  var wrap, dayLbl, list, ed, stat, undo, ready = false;

  function setStat(s) { if (stat) stat.textContent = s; }
  function text() { return lines.join('\n'); }
  function setText(t) { lines = String(t == null ? '' : t).replace(/\r/g, '').split('\n'); }

  // ---------- shell ----------
  function build() {
    wrap = document.getElementById('memoWrap');
    if (!wrap) return false;
    wrap.innerHTML =
      '<div id="memoBar"><span class="mtitle">MEMO</span>' +
        '<span id="memoUndo" style="display:none"></span><span id="memoStat"></span></div>' +
      '<div id="dayBar">' +
        '<span class="nav" id="dPrev" title="previous day (←)">‹</span>' +
        '<span class="lbl" id="dLbl"></span>' +
        '<span class="nav" id="dNext" title="next day (→)">›</span>' +
        '<span class="tdy" id="dTdy" title="jump to today">today</span>' +
      '</div>' +
      '<div id="taskList"></div>' +
      '<div id="memoEd" contenteditable="true" spellcheck="false"></div>';
    dayLbl = document.getElementById('dLbl');
    list = document.getElementById('taskList');
    ed = document.getElementById('memoEd');
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

  // Fire on mousedown, not click: if the editor has focus, its blur handler can
  // rebuild these rows between mousedown and mouseup and the click would be lost.
  function onTap(el, fn) {
    el.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); fn(); });
    el.addEventListener('touchstart', function (e) { e.preventDefault(); fn(); }, { passive: false });
  }

  // ---------- keyboard task cursor: j/k move it, x toggles it ----------
  function ids() { return forDay(day).map(function (p) { return p[0]; }); }
  function moveCursor(n) {
    var list_ = ids();
    if (!list_.length) { cursor = null; return; }
    var i = list_.indexOf(cursor);
    i = (i < 0) ? (n > 0 ? 0 : list_.length - 1) : Math.max(0, Math.min(list_.length - 1, i + n));
    cursor = list_[i];
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
    var list_ = ids(), i = list_.indexOf(id);
    cursor = list_[i + 1] || list_[i - 1] || null;    // keep the highlight somewhere useful
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

  function renderTasks() {
    if (!list) return;
    var alive = ids();
    if (cursor && alive.indexOf(cursor) < 0) cursor = null;   // it moved off this day
    list.innerHTML = '';
    forDay(day).forEach(function (pair) {
      var id = pair[0], t = pair[1];
      var row = document.createElement('div');
      row.className = 'tk' + (t.done ? ' done' : '') + (cursor === id ? ' cur' : '');
      row.dataset.id = id;

      var ck = document.createElement('span');
      ck.className = 'ck';
      ck.textContent = t.done ? '☑' : '☐';
      ck.title = t.done ? 'reopen (x)' : 'mark done (x)';
      onTap(ck, function () { cursor = id; toggle(id); });
      row.appendChild(ck);

      var tx = document.createElement('span');
      tx.className = 'tx';
      tx.innerHTML = inline(t.text, false);
      tx.contentEditable = 'true';
      tx.spellcheck = false;
      tx.onblur = function () {
        var v = tx.textContent.trim();
        if (v && v !== t.text) upTask(id, { text: v });
        else tx.innerHTML = inline(t.text, false);
      };
      tx.onfocus = function () { if (cursor !== id) { cursor = id; } };
      tx.onkeydown = function (e) {
        if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault(); e.stopPropagation(); tx.blur(); go(e.key === 'ArrowLeft' ? -1 : 1); return;
        }
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); tx.blur(); }
        else if (e.key === 'Escape') { tx.innerHTML = inline(t.text, false); tx.blur(); }
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

  // ---------- editor: model <-> DOM ----------
  function posOf(node, off) {
    if (!node || !ed.contains(node)) return null;
    if (node === ed) {
      var k = Math.max(0, Math.min(off, ed.children.length - 1));
      return { line: k, off: 0 };
    }
    var ln = node;
    while (ln && ln.parentNode !== ed) ln = ln.parentNode;
    if (!ln) return null;
    var idx = [].indexOf.call(ed.children, ln);
    if (idx < 0) return null;
    var pos = 0, done = false;
    (function walk(n) {
      if (done) return;
      if (n === node && n.nodeType !== 3) {
        for (var i = 0; i < off && i < n.childNodes.length; i++) pos += (n.childNodes[i].textContent || '').length;
        done = true; return;
      }
      if (n.nodeType === 3) {
        if (n === node) { pos += off; done = true; return; }
        pos += n.nodeValue.length; return;
      }
      for (var j = 0; j < n.childNodes.length; j++) { walk(n.childNodes[j]); if (done) return; }
    })(ln);
    return { line: idx, off: pos };
  }
  function caretPos() {
    var s = window.getSelection();
    if (!s || !s.rangeCount) return null;
    return posOf(s.anchorNode, s.anchorOffset);
  }
  function selSpan() {
    var s = window.getSelection();
    if (!s || !s.rangeCount) return null;
    var a = posOf(s.anchorNode, s.anchorOffset), b = posOf(s.focusNode, s.focusOffset);
    if (!a || !b) return null;
    if (a.line > b.line || (a.line === b.line && a.off > b.off)) { var t = a; a = b; b = t; }
    return { a: a, b: b, collapsed: a.line === b.line && a.off === b.off };
  }
  function setCaret(line, off) {
    var ln = ed.children[line];
    if (!ln) return;
    var rest = off, target = null, tOff = 0, done = false;
    (function walk(n) {
      if (done) return;
      if (n.nodeType === 3) {
        var L = n.nodeValue.length;
        if (rest <= L) { target = n; tOff = rest; done = true; return; }
        rest -= L; return;
      }
      for (var i = 0; i < n.childNodes.length; i++) { walk(n.childNodes[i]); if (done) return; }
    })(ln);
    var r = document.createRange();
    if (target) { r.setStart(target, tOff); r.collapse(true); }
    else { r.selectNodeContents(ln); r.collapse(true); }
    var s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
  }
  function paint(caretLine) {
    if (!lines.length) lines = [''];
    var html = lines.map(function (l, i) {
      return '<div class="' + lineClass(l) + '">' + lineHtml(l, i === caretLine) + '</div>';
    }).join('');
    if (ed.innerHTML !== html) ed.innerHTML = html;
  }
  // the caret line is drawn with its markers, so its DOM text IS its source
  function syncCaretLine() {
    var c = caretPos();
    if (!c) return null;
    var ln = ed.children[c.line];
    if (ln) lines[c.line] = ln.textContent.replace(/​/g, '');
    return c;
  }
  function repaint(c) {
    paint(c ? c.line : -1);
    if (c) setCaret(c.line, Math.min(c.off, (lines[c.line] || '').length));
  }

  function replaceSpan(sp, insert) {
    var head = (lines[sp.a.line] || '').slice(0, sp.a.off);
    var tail = (lines[sp.b.line] || '').slice(sp.b.off);
    var parts = String(insert).replace(/\r/g, '').split('\n');
    parts[0] = head + parts[0];
    parts[parts.length - 1] = parts[parts.length - 1] + tail;
    var caretLine = sp.a.line + parts.length - 1;
    var caretOff = parts[parts.length - 1].length - tail.length;
    lines.splice(sp.a.line, sp.b.line - sp.a.line + 1);
    for (var i = parts.length - 1; i >= 0; i--) lines.splice(sp.a.line, 0, parts[i]);
    repaint({ line: caretLine, off: caretOff });
    saveSoon();
  }

  function newline() {
    var sp = selSpan();
    if (!sp) return;
    if (!sp.collapsed) { replaceSpan(sp, '\n'); return; }
    var c = sp.a;
    var cur = lines[c.line] === undefined ? '' : lines[c.line];
    var head = cur.slice(0, c.off), tail = cur.slice(c.off);
    var m = /^\s*-\s+(.+?)\s*$/.exec(head);
    if (m) {                                   // "- something" flies up into the checklist
      addTask(m[1], day);
      lines.splice(c.line, 1, tail);
      repaint({ line: c.line, off: 0 });
    } else {
      lines.splice(c.line, 1, head, tail);
      repaint({ line: c.line + 1, off: 0 });
    }
    saveSoon();
  }

  function backspace() {
    var sp = selSpan();
    if (!sp) return false;
    if (!sp.collapsed) { replaceSpan(sp, ''); return true; }
    if (sp.a.off > 0 || sp.a.line === 0) return false;      // let the browser do it
    var prev = sp.a.line - 1, at = (lines[prev] || '').length;
    lines[prev] = (lines[prev] || '') + (lines[sp.a.line] || '');
    lines.splice(sp.a.line, 1);
    repaint({ line: prev, off: at });
    saveSoon();
    return true;
  }
  function del() {
    var sp = selSpan();
    if (!sp) return false;
    if (!sp.collapsed) { replaceSpan(sp, ''); return true; }
    var cur = lines[sp.a.line] || '';
    if (sp.a.off < cur.length || sp.a.line >= lines.length - 1) return false;
    lines[sp.a.line] = cur + (lines[sp.a.line + 1] || '');
    lines.splice(sp.a.line + 1, 1);
    repaint({ line: sp.a.line, off: sp.a.off });
    saveSoon();
    return true;
  }

  // pull every "- xxx" line into the checklist (used on blur / day change)
  function capture() {
    var kept = [], grabbed = 0;
    lines.forEach(function (l) {
      var m = /^\s*-\s+(.+?)\s*$/.exec(l);
      if (m) { addTask(m[1], day); grabbed++; }
      else kept.push(l);
    });
    if (!grabbed) return false;
    lines = kept.length ? kept : [''];
    return true;
  }

  function saveSoon() {
    typing = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  }
  function save() {
    clearTimeout(saveTimer);
    var t = text(), d = day;
    if ((notes[d] || '') === t) return;
    notes[d] = t;
    setStat('…');
    db.ref('nvs/notes/' + d).set({
      text: t, by: me, at: firebase.database.ServerValue.TIMESTAMP
    }).then(function () { setStat('saved'); })
      .catch(function (e) { setStat('save failed: ' + (e && e.message)); });
  }
  // returns true when a "- xxx" line was lifted into the checklist
  function flush() { var grabbed = capture(); if (grabbed) paint(-1); save(); return grabbed; }

  function wireEditor() {
    ed.addEventListener('keydown', function (e) {
      // shift+←/→ walks the calendar even mid-sentence
      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault(); e.stopPropagation();
        go(e.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      e.stopPropagation();                    // sheet/day shortcuts never fire while typing
      if (e.key === 'Escape') { e.preventDefault(); flush(); ed.blur(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); newline(); return; }
      if (e.key === 'Backspace') { if (backspace()) e.preventDefault(); return; }
      if (e.key === 'Delete') { if (del()) e.preventDefault(); return; }
      if (e.key.length === 1) {               // typing over a multi-line selection
        var sp = selSpan();
        if (sp && !sp.collapsed && sp.a.line !== sp.b.line) { e.preventDefault(); replaceSpan(sp, e.key); }
      }
    });
    ed.addEventListener('paste', function (e) {
      e.preventDefault();
      var t = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
      var sp = selSpan();
      if (sp) replaceSpan(sp, t);
    });
    ed.addEventListener('input', function () {
      var c = syncCaretLine();                // only the caret line can have changed
      repaint(c);
      saveSoon();
    });
    ed.addEventListener('blur', function () {
      var grabbed = flush();
      paint(-1);                       // drop the marker hints now that we've left
      if (grabbed) renderTasks();      // only rebuild rows when something actually moved
    });
    ed.addEventListener('mouseup', function () { repaint(caretPos()); });
    ed.addEventListener('keyup', function (e) {
      if (/^(Arrow|Home|End|Page)/.test(e.key)) repaint(caretPos());
    });
  }

  // ---------- render ----------
  function renderAll() {
    if (!wrap) return;
    var t = today();
    dayLbl.textContent = jp(day) + ' (' + WD[parseDay(day).getDay()] + ')' +
                         (day === t ? '' : day < t ? ' ◂' : ' ▸');
    dayLbl.className = 'lbl' + (day === t ? '' : ' other');
    renderTasks();
    var editing = document.activeElement === ed;
    paint(-1);                          // always repaint: the day may have changed under us
    if (editing) setCaret(0, 0);        // keep the caret somewhere sane on the new day
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
      // never yank text out from under someone who is typing
      if (document.activeElement !== ed && Date.now() - typing > 1500) {
        setText(notes[day] || '');
        paint(-1);
      }
    });

    setText(notes[day] || '');
    renderAll();
    window.addEventListener('beforeunload', flush);
    // a tab left open overnight should still open on the real today
    window.addEventListener('focus', function () {
      if (day !== today() && !document.getElementById('memoEd').contains(document.activeElement)) {
        var wasToday = parseDay(day) < new Date();
        if (wasToday) renderAll();     // refresh the ◂/▸ marker at least
      }
    });
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
    editing: function () { return document.activeElement === ed; }
  };
})();

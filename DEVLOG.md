NVS VIEWER — DEV LOG
====================
Newest first. Each entry: what changed, and why it changed.
Live: https://nvs-viewer-production.up.railway.app/   Repo: yohei-art/nvs-viewer

Files
-----
  index.html   the whole viewer — sheet, tabs, header, settings, news banner
  memo.js      the memo pane — per-day notes plus the carried-forward checklist
  server.js    static file server + /api/ticker (quotes and headlines relay)
  DEVLOG.md    this file


2026-08-17  build-20260817-pane
------------------------------------------------
ADDED  Minimize / maximize for the two panes. The divider now carries two
       arrows: ◀ collapses the company side (memo takes the full width),
       ▶ collapses the memo (companies take the full width); the same
       arrow, pointing back the way the divider went, restores the split.
       The chosen mode is remembered locally and synced through nvs/ui so
       every device opens the same way. Dragging the divider is disabled
       while a pane is collapsed. Phones ignore the mode - the stacked
       layout always shows both.

2026-08-14  build-20260814-set / memo-20260814d
------------------------------------------------
FIXED  A day's notes could be wiped. If you clicked into the memo within about a
       second of loading — before the nvs/notes snapshot arrived — the listener
       refused to fill a focused box, so it stayed empty, and the next save wrote
       that emptiness over the day. Two guards now make it impossible: the memo
       never saves before the snapshot has arrived (`loaded`), and never saves a
       day you have not actually edited (`dirty`). Cost: 2026-08-14's notes.
CHANGE Status line is a one-shot banner. "updated …" clears itself after 7s;
       only "loading" stays up until it resolves.
CHANGE Status icons are 8-bit sprites (box-shadow pixel art in the palette)
       instead of the emoji ✅⏳❓✖, which looked far too modern.
CHANGE The ticker box no longer auto-capitalises — it mangled Japanese input.
       Uppercasing now happens only in request(), on the way to Excel.
CHANGE Clock reads `02:34 (JST) 12:34 (CDT)`; no seconds. The US abbreviation is
       worked out per date, so it says CDT in summer and CST in winter.
CHANGE Font / size / bold / screen colour moved into a `set` popover. The header
       is just: ticker box, set, status, user + clock.
CHANGE Dropped the "NVS Dashboard" title.
CHANGE The sheet is now a generic table: whatever heads/rows arrive get drawn,
       with no assumption about what any column means. Numbers right-align, text
       left-aligns. Drag any header's right edge to resize a column; widths are
       remembered locally and synced through nvs/ui.colw. Reset in settings.
CHANGE News feeds re-read every 3 min server-side, banner refreshes every 60s.
ADDED  This dev log, served at /DEVLOG.md and linked from settings.

2026-08-14  build-20260814-mvp
------------------------------------------------
FIXED  Closing a tab did not stick: nvs/status keeps its last event forever, so
       every load replayed `{code:3333, state:done}` and the handler treated it
       as fresh data — re-opening the tab you had just closed and stealing focus.
       The listener now ignores the first snapshot and reacts only to changes.
FIXED  The saved screen colour flashed default green on every load. It is now
       applied by an inline script in <head>, before the first frame.
ADDED  Boot splash: MVP drawn as real pixels on a canvas (7x9 glyphs, offset
       shadow, scanlines) with today's date and time. Fades after ~1.6s.
ADDED  Bottom news banner. USD/JPY plus NHK and Yahoo headlines, scrolling
       slowly, links clickable in the LCD colour, pauses on hover.
NOTE   Indices (NKY/TOPIX) are deliberately absent. Getting them meant scraping
       Yahoo Finance, which started returning 500s within minutes and is blocked
       from Railway outright — a ban risk not worth a banner. /api/ticker now
       uses only sources published to be polled: frankfurter.app for FX and the
       news RSS feeds. If indices are ever wanted, the clean route is a
       GOOGLEFINANCE() cell in the Nvs sheet served via the existing Apps Script.

2026-08-14  build-20260814-ime / memo-20260814c
------------------------------------------------
FIXED  Japanese input was broken in the memo: choosing a kanji candidate with
       space/enter produced a stray line break and a duplicated word. The editor
       was a contenteditable that intercepted keydown and repainted on every
       input event — the same events an IME fires mid-conversion. It is now a
       plain <textarea> with no key handling at all, plus compositionstart /
       compositionend guards so nothing touches the field mid-conversion.
REMOVED All markdown from the notes and task text, and every in-memo shortcut.
       Only the "- xxx" capture remains. memo.js went 25KB -> 15KB.

2026-08-14  build-20260814-del / memo-20260814b
------------------------------------------------
REMOVED The "next step" prompt. Ticking a task just marks it done.
ADDED  Delete a task for good: the × on the row, or `d` / `#` on the highlighted
       one. An undo chip sits in the MEMO bar for 15s (or press `u`).
CHANGE Open tasks always show the date they were raised, not only once carried.

2026-08-14  build-20260814-keys / memo-20260814a
------------------------------------------------
ADDED  Keyboard: `t` today, `j`/`k` move the task highlight, `x` toggles done,
       Esc leaves the memo. Nothing fires while a text field has focus.

2026-08-13  build-20260813-cal
------------------------------------------------
ADDED  The memo became a daily calendar. ‹ / › walk days; "- xxx" lines are
       captured into that day's checklist; open tasks accumulate forward with
       their origin date; → pushes a task to tomorrow.
ADDED  Screen colour picker; the whole palette is derived from one colour and
       flips to light-on-dark automatically.

2026-08-13  build-20260813-fix
------------------------------------------------
FIXED  A temporal-dead-zone ReferenceError (`let uiApplying` declared below its
       first use) aborted the script mid-initialisation. Closing a tab appeared
       to do nothing until reload, and the split divider could not be dragged,
       because the code that wired them never ran.

2026-08-13  build-20260813-sync / -md
------------------------------------------------
ADDED  Font, size, bold, closed tabs, active tab and pane width sync through
       Firebase (nvs/ui), so every device opens on the same screen.
ADDED  Memo pane as a resizable right-hand split.

2026-08-13  build-20260813-elisa / -uni / -fontmenu
------------------------------------------------
ADDED  Separate font / size / bold menus. Bitmap faces (PixelM+, えりさ 8dot,
       東雲 12dot, DotGothic) alongside the Mac system monospaces. Bitmap faces
       stay hard-aliased; outline faces get antialiasing.
ADDED  えりさ and 東雲 are stored as base64 in Firebase (nvs/fonts) and loaded at
       runtime with FontFace — the backend serves its own retro fonts.
CHANGE One dot grid for the entire UI, so the font menu re-zooms everything at
       once, the way the 200LX does.

2026-08-13  build-20260813-200lx
------------------------------------------------
CHANGE The whole look: HP 200LX / Lotus 1-2-3. LCD palette, inverse-video status
       line and column headers, zero radii, 1px row padding, keyboard-first.

earlier
------------------------------------------------
ADDED  Closable company tabs (hidden, never deleted; one click restores).
ADDED  Loading banner in the Google Sheet (D1) while Excel is fetching.
ADDED  Sheet C1 edit -> Apps Script trigger -> Firebase nvs/request -> PC agent.

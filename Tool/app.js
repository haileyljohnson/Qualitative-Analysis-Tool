// ---- State ----------------------------------------------------------
// `state` is just the transcript grid (columns + rows). Which video and
// which files-on-disk it's paired with are tracked separately below, so a
// saved project is a small { video, transcript } pointer, not a copy of
// the whole transcript.
let state = {
  columns: [
    { id: 'time', name: 'Time' },
    { id: 'speaker', name: 'Speaker' },
    { id: 'transcript', name: 'Transcript' },
    { id: 'behaviors', name: 'Behaviors' },
    { id: 'notes', name: 'Notes' },
  ],
  rows: [],
  merges: [], // [{ colId, anchorRowId, coveredRowIds: [...] }] — vertical cell merges
};
let nextId = 1;
const uid = (prefix) => `${prefix}${nextId++}`;

let activeFilters = new Map(); // colId -> Set of selected tags (OR within a column, AND across columns)
let lastFocusedRowId = null; // so "+ Row" inserts after wherever you're typing, not at the end

let currentVideoFileName = null;      // name of the loaded file in ./videos
let currentTranscriptFileName = null; // name of the loaded file in ./transcripts
let currentProjectFileName = null;    // name of the loaded file in ./projects


// ---- Elements ---------------------------------------------------------
const video = document.getElementById('video');
const videoInput = document.getElementById('videoInput');
const videoEmpty = document.getElementById('videoEmpty');
const videoEmptyText = document.getElementById('videoEmptyText');
const videoList = document.getElementById('videoList');
const videoControls = document.getElementById('videoControls');
const videoNameLabel = document.getElementById('videoNameLabel');
const videoSizeRange = document.getElementById('videoSizeRange');
const videoSeekBar = document.getElementById('videoSeekBar');
const playbackRateSelect = document.getElementById('playbackRateSelect');
const videoPanel = document.getElementById('videoPanel');
const tablePanel = document.getElementById('tablePanel');
const playStatus = document.getElementById('playStatus');
const timeDisplay = document.getElementById('timeDisplay');
const shortcutHints = document.getElementById('shortcutHints');
const gridHeadRow = document.getElementById('gridHeadRow');
const gridBody = document.getElementById('gridBody');
const tableScroll = document.querySelector('.tableScroll');
const btnBackToTop = document.getElementById('btnBackToTop');
const codingPanel = document.getElementById('codingPanel');
const codingColumnsList = document.getElementById('codingColumnsList');
const projectInput = document.getElementById('projectInput');
const transcriptStart = document.getElementById('transcriptStart');
const transcriptList = document.getElementById('transcriptList');
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsDialog = document.getElementById('settingsDialog');
const shortcutList = document.getElementById('shortcutList');
const shortcutMsg = document.getElementById('shortcutMsg');

// ---- Local file lists (served by server.py from ./videos and ./transcripts) --
async function fetchFileList(kind) {
  try {
    const res = await fetch(`/api/list?dir=${kind}`);
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    return []; // no server (e.g. index.html opened directly) — lists just stay empty
  }
}

let lastVideoList = [];
async function refreshVideoList() {
  lastVideoList = await fetchFileList('videos');
  videoList.innerHTML = '';
  lastVideoList.forEach((name) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = name;
    btn.onclick = () => activateVideo(name, `/videos/${encodeURIComponent(name)}`);
    li.appendChild(btn);
    videoList.appendChild(li);
  });
}

async function refreshTranscriptList() {
  const names = await fetchFileList('transcripts');
  transcriptList.innerHTML = '';
  names.forEach((name) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = name;
    btn.onclick = () => loadTranscriptFromServer(name);
    li.appendChild(btn);
    transcriptList.appendChild(li);
  });
  if (!names.length) transcriptStart.hidden = true;
}

// ---- Video loading ----------------------------------------------------
function resetVideoUI(promptText) {
  video.hidden = true;
  video.removeAttribute('src');
  videoControls.hidden = true;
  videoEmpty.hidden = false;
  videoEmptyText.textContent = promptText || 'Load a video to start transcribing.';
  refreshVideoList();
}

function activateVideo(fileName, src) {
  video.src = src;
  video.playbackRate = playbackRate;
  currentVideoFileName = fileName;
  lastAutoScrollRowId = null;
  videoEmpty.hidden = true;
  video.hidden = false;
  videoControls.hidden = false;
  videoNameLabel.textContent = fileName;
  renderShortcutHints();
}

// ---- Playback speed -------------------------------------------------------
let playbackRate = parseFloat(localStorage.getItem('qualtool.playbackRate')) || 1;
playbackRateSelect.value = String(playbackRate);
playbackRateSelect.onchange = () => {
  playbackRate = parseFloat(playbackRateSelect.value);
  localStorage.setItem('qualtool.playbackRate', String(playbackRate));
  video.playbackRate = playbackRate;
};

document.getElementById('btnOpenVideo').onclick = () => videoInput.click();
document.getElementById('btnSwapVideo').onclick = () => resetVideoUI();
videoInput.onchange = () => {
  const file = videoInput.files[0];
  if (!file) return;
  activateVideo(file.name, URL.createObjectURL(file));
};

function fmtTime(t) {
  const totalMs = Math.round(t * 1000);
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}
// Reverse of fmtTime, but lenient about how a timestamp got typed
// ("5:30", "1:02:03.5") since these cells are free-text, not enforced.
function parseTime(text) {
  const m = String(text || '').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = parseInt(m[2], 10);
  const s = parseInt(m[3], 10);
  const ms = m[4] ? parseInt(m[4].padEnd(3, '0'), 10) : 0;
  return h * 3600 + min * 60 + s + ms / 1000;
}
video.addEventListener('loadedmetadata', () => {
  videoSeekBar.max = String(video.duration || 0);
});
video.addEventListener('timeupdate', () => {
  timeDisplay.textContent = fmtTime(video.currentTime || 0);
  videoSeekBar.value = String(video.currentTime || 0);
  autoScrollTranscript();
});
video.addEventListener('play', () => { playStatus.textContent = 'Playing'; });
video.addEventListener('pause', () => { playStatus.textContent = 'Paused'; });
videoSeekBar.addEventListener('input', () => {
  video.currentTime = parseFloat(videoSeekBar.value);
});

// ---- Header height (video overlay positions itself just below it) -------
function updateHeaderHeightVar() {
  const h = document.querySelector('.siteHeader').getBoundingClientRect().height;
  document.documentElement.style.setProperty('--header-height', `${h}px`);
}
window.addEventListener('resize', updateHeaderHeightVar);

// ---- Video size ---------------------------------------------------------
let videoWidth = parseInt(localStorage.getItem('qualtool.videoWidth'), 10) || 380;
function updateVideoSizeMax() {
  const max = Math.max(220, window.innerWidth - 60); // leave room for the rail itself
  videoSizeRange.max = String(max);
  if (videoWidth > max) videoWidth = max;
}
function applyVideoWidth() {
  updateVideoSizeMax();
  document.documentElement.style.setProperty('--video-width', `${videoWidth}px`);
  videoSizeRange.value = String(videoWidth);
}
videoSizeRange.oninput = () => {
  videoWidth = parseInt(videoSizeRange.value, 10);
  localStorage.setItem('qualtool.videoWidth', String(videoWidth));
  applyVideoWidth();
};
window.addEventListener('resize', applyVideoWidth);

// ---- Video position (drag anywhere) --------------------------------------
let videoPos = null;
try { videoPos = JSON.parse(localStorage.getItem('qualtool.videoPos')); } catch (e) { /* ignore malformed storage */ }

function applyVideoPos() {
  videoPanel.style.left = videoPos ? `${videoPos.left}px` : '';
  videoPanel.style.top = videoPos ? `${videoPos.top}px` : '';
}
applyVideoPos();

document.getElementById('videoDragHandle').addEventListener('mousedown', (e) => {
  e.preventDefault();
  const startX = e.clientX;
  const startY = e.clientY;
  const rect = videoPanel.getBoundingClientRect();
  const startLeft = rect.left;
  const startTop = rect.top;
  document.body.style.userSelect = 'none';

  function onMove(moveEvent) {
    const left = Math.max(0, Math.min(window.innerWidth - 60, startLeft + (moveEvent.clientX - startX)));
    const top = Math.max(0, Math.min(window.innerHeight - 40, startTop + (moveEvent.clientY - startY)));
    videoPos = { left, top };
    applyVideoPos();
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.style.userSelect = '';
    localStorage.setItem('qualtool.videoPos', JSON.stringify(videoPos));
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
});

// ---- Transcript size (width/height popover) ------------------------------
const tableSizePopover = document.getElementById('tableSizePopover');
const tableWidthRange = document.getElementById('tableWidthRange');
const tableHeightRange = document.getElementById('tableHeightRange');
let tableWidth = parseInt(localStorage.getItem('qualtool.tableWidth'), 10) || null;
let tableHeight = parseInt(localStorage.getItem('qualtool.tableHeight'), 10) || null;

function applyTableSize() {
  document.documentElement.style.setProperty('--table-width', tableWidth ? `${tableWidth}px` : '100%');
  document.documentElement.style.setProperty('--table-height', tableHeight ? `${tableHeight}px` : '75vh');
  // Changing the table's own width reflows every auto-sized column, but a
  // frozen column's `left` is a plain inline style captured at the last
  // render — without recomputing it here it goes stale and the column
  // renders at the wrong horizontal position.
  applyFrozenColumns();
}
function updateTableSizeBounds() {
  tableWidthRange.max = String(Math.max(300, window.innerWidth - 40));
  tableHeightRange.max = String(Math.max(200, window.innerHeight - 100));
  tableWidthRange.value = String(tableWidth || tablePanel.getBoundingClientRect().width);
  tableHeightRange.value = String(tableHeight || tablePanel.getBoundingClientRect().height);
}
applyTableSize();

document.getElementById('btnTableSize').onclick = (e) => {
  const willShow = tableSizePopover.hidden;
  tableSizePopover.hidden = !willShow;
  document.getElementById('btnTableSize').setAttribute('aria-expanded', String(willShow));
  if (willShow) {
    updateTableSizeBounds();
    positionPopover(tableSizePopover, e.currentTarget);
  }
};
window.addEventListener('resize', () => {
  if (!tableSizePopover.hidden) positionPopover(tableSizePopover, document.getElementById('btnTableSize'));
});
tableWidthRange.oninput = () => {
  tableWidth = parseInt(tableWidthRange.value, 10);
  localStorage.setItem('qualtool.tableWidth', String(tableWidth));
  applyTableSize();
};
tableHeightRange.oninput = () => {
  tableHeight = parseInt(tableHeightRange.value, 10);
  localStorage.setItem('qualtool.tableHeight', String(tableHeight));
  applyTableSize();
};
document.getElementById('btnTableSizeReset').onclick = () => {
  tableWidth = null;
  tableHeight = null;
  localStorage.removeItem('qualtool.tableWidth');
  localStorage.removeItem('qualtool.tableHeight');
  applyTableSize();
  updateTableSizeBounds();
};

// ---- Rebindable shortcuts ------------------------------------------
// Bindings are stored as "combo strings" — modifiers in a fixed order plus
// a main key, e.g. "shift+w" or "ctrl+shift+arrowup". A plain "arrowup" is
// just the single-key case of the same format, so old bindings still work.
const DEFAULT_BINDINGS = { play: 'arrowup', rewind: 'arrowleft', forward: 'arrowright' };
const ACTION_LABELS = { play: 'Play / Pause', rewind: 'Rewind', forward: 'Fast-forward' };
const ACTION_HINTS = {
  play: 'hold to play, release to pause & rewind 0.5s',
  rewind: 'hold to rewind',
  forward: 'hold to fast-forward',
};
const MODIFIER_TOKENS = new Set(['ctrl', 'alt', 'shift', 'meta']);
const UNBINDABLE = new Set(['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'CapsLock', 'Escape']);
const RESERVED_COMBOS = new Set(['shift+arrowup', 'shift+arrowdown']); // used for moving between rows

function comboSatisfied(combo) {
  return !!combo && combo.split('+').every((tok) => heldTokens.has(tok));
}

// Always lowercased so Shift changing a letter's case (w -> W) doesn't turn
// into a different-looking binding — the shift modifier is tracked separately.
function keyToken(key) {
  const map = { Control: 'ctrl', Shift: 'shift', Alt: 'alt', Meta: 'meta', OS: 'meta' };
  if (map[key]) return map[key];
  return key.toLowerCase();
}

function comboFromEvent(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  if (e.metaKey) parts.push('meta');
  const main = keyToken(e.key);
  if (!MODIFIER_TOKENS.has(main)) parts.push(main);
  return parts.join('+');
}

function loadBindings() {
  try {
    const saved = JSON.parse(localStorage.getItem('qualtool.bindings'));
    if (saved && saved.play && saved.rewind && saved.forward) {
      // Light migration: old versions stored a raw single key (sometimes
      // uppercase if Shift was held without recording it as a modifier).
      // Lowercasing single characters keeps them working as a plain binding.
      const fix = (v) => (typeof v === 'string' && v.length === 1 ? v.toLowerCase() : v);
      return { play: fix(saved.play), rewind: fix(saved.rewind), forward: fix(saved.forward) };
    }
  } catch (e) { /* ignore malformed storage */ }
  return { ...DEFAULT_BINDINGS };
}
let bindings = loadBindings();
function saveBindings() {
  localStorage.setItem('qualtool.bindings', JSON.stringify(bindings));
}

function keyLabel(key) {
  const map = {
    arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', ' ': 'Space',
    ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', meta: 'Cmd/Win',
  };
  const lower = key.toLowerCase();
  if (map[lower]) return map[lower];
  return key.length === 1 ? key.toUpperCase() : key;
}
function comboLabel(combo) {
  return (combo || '').split('+').map(keyLabel).join(' + ');
}

function renderShortcutHints() {
  shortcutHints.innerHTML = '';
  ['play', 'rewind', 'forward'].forEach((action) => {
    const li = document.createElement('li');
    li.innerHTML = `<kbd>${comboLabel(bindings[action])}</kbd> <span>${ACTION_HINTS[action]}</span>`;
    shortcutHints.appendChild(li);
  });
}

let listeningFor = null;

function renderShortcutList() {
  shortcutList.innerHTML = '';
  ['play', 'rewind', 'forward'].forEach((action) => {
    const li = document.createElement('li');

    const labelWrap = document.createElement('div');
    labelWrap.className = 'shortcutRowLabel';
    labelWrap.innerHTML = `${ACTION_LABELS[action]}<small>${ACTION_HINTS[action]}</small>`;

    const right = document.createElement('div');
    right.className = 'shortcutRowRight';

    const badge = document.createElement('kbd');
    badge.textContent = comboLabel(bindings[action]);
    right.appendChild(badge);

    const btn = document.createElement('button');
    btn.className = 'btnGhost';
    btn.type = 'button';
    if (listeningFor === action) {
      btn.textContent = 'Press a key… (Esc to cancel)';
    } else {
      btn.textContent = 'Change';
      btn.onclick = () => {
        if (listeningFor) return;
        listeningFor = action;
        shortcutMsg.textContent = '';
        renderShortcutList();
      };
    }
    right.appendChild(btn);

    li.appendChild(labelWrap);
    li.appendChild(right);
    shortcutList.appendChild(li);
  });
}

function openSettings() {
  settingsOverlay.hidden = false;
  shortcutMsg.textContent = '';
  renderShortcutList();
  document.getElementById('btnCloseSettings').focus();
}
function closeSettings() {
  listeningFor = null;
  settingsOverlay.hidden = true;
  document.getElementById('btnSettings').focus();
}
document.getElementById('btnSettings').onclick = openSettings;
document.getElementById('btnSettingsInline').onclick = openSettings;
document.getElementById('btnCloseSettings').onclick = closeSettings;
document.getElementById('btnResetShortcuts').onclick = () => {
  bindings = { ...DEFAULT_BINDINGS };
  saveBindings();
  renderShortcutList();
  renderShortcutHints();
  shortcutMsg.textContent = 'Shortcuts reset to defaults.';
};
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

function trapFocus(e, dialogEl) {
  const focusables = dialogEl.querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"])');
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// ---- Columns dialog: set type / delete somewhere more deliberate than
// the small controls that used to live on each column header ------------
const columnsOverlay = document.getElementById('columnsOverlay');
const columnsDialog = document.getElementById('columnsDialog');
const columnMgmtList = document.getElementById('columnMgmtList');

function renderColumnMgmtList() {
  columnMgmtList.innerHTML = '';
  state.columns.forEach((col) => {
    const li = document.createElement('li');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'columnMgmtName';
    nameSpan.textContent = col.name;
    li.appendChild(nameSpan);

    const typeSelect = document.createElement('select');
    typeSelect.setAttribute('aria-label', `Type for column "${col.name}"`);
    [['text', 'Text'], ['codes', 'Codes']].forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      typeSelect.appendChild(opt);
    });
    typeSelect.value = col.type === 'codes' ? 'codes' : 'text';
    typeSelect.onchange = () => {
      pushUndo();
      col.type = typeSelect.value;
      render();
      renderColumnMgmtList();
    };
    li.appendChild(typeSelect);

    if (col.id !== 'time') {
      const delBtn = document.createElement('button');
      delBtn.className = 'btnGhost';
      delBtn.type = 'button';
      delBtn.textContent = 'Delete';
      delBtn.onclick = () => { deleteColumn(col); renderColumnMgmtList(); };
      li.appendChild(delBtn);
    }

    columnMgmtList.appendChild(li);
  });
}

function openColumnsDialog() {
  columnsOverlay.hidden = false;
  renderColumnMgmtList();
  document.getElementById('btnCloseColumns').focus();
}
function closeColumnsDialog() {
  columnsOverlay.hidden = true;
  document.getElementById('btnColumns').focus();
}
document.getElementById('btnColumns').onclick = openColumnsDialog;
document.getElementById('btnCloseColumns').onclick = closeColumnsDialog;
columnsOverlay.addEventListener('click', (e) => {
  if (e.target === columnsOverlay) closeColumnsDialog();
});

// ---- Hold-key video shortcuts ------------------------------------------
// ponytail: no reverse playback support in <video>, so rewind/FF are
// simulated by nudging currentTime on an interval while the key is held.
const SCRUB_STEP = 0.5;
const SCRUB_MS = 100;
let scrubTimer = null;
const heldTokens = new Set();   // every key token currently physically held (modifiers included)
const activeActions = new Set(); // which of play/rewind/forward are currently triggered

function isEditingCell() {
  const el = document.activeElement;
  return el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'SELECT');
}

// Real form controls (dropdowns, sliders, rename fields) still need their own
// arrow-key behavior — only transcript cells give it up to video shortcuts.
function isFormInput() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'SELECT');
}

function isGridCell(el) {
  return !!el && el.tagName === 'TD' && !!el.dataset.colId;
}

function placeCursorAtEnd(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// Moves focus to the same column in the row above/below, skipping over rows
// where that column is covered by a merge (no <td> of its own to focus).
function moveCellFocus(currentTd, rowDelta) {
  const colId = currentTd.dataset.colId;
  const rows = [...gridBody.querySelectorAll('tr')];
  let rowIdx = rows.indexOf(currentTd.closest('tr')) + rowDelta;
  while (rowIdx >= 0 && rowIdx < rows.length) {
    const targetTd = rows[rowIdx].querySelector(`td[data-col-id="${colId}"]`);
    if (targetTd) {
      targetTd.focus();
      if (targetTd.isContentEditable) placeCursorAtEnd(targetTd);
      return;
    }
    rowIdx += rowDelta;
  }
}
function startScrub(direction) {
  if (scrubTimer) return;
  scrubTimer = setInterval(() => {
    video.currentTime = Math.max(0, video.currentTime + direction * SCRUB_STEP);
  }, SCRUB_MS);
}
function stopScrub() {
  clearInterval(scrubTimer);
  scrubTimer = null;
}

function handleKeyDown(e) {
  // Track physically-held keys unconditionally, before any early returns
  // below, so modifier state stays accurate for multi-key combos even if a
  // modifier was pressed while e.g. a cell was focused.
  heldTokens.add(keyToken(e.key));

  // Capturing a new shortcut key (or key combo) inside the settings dialog.
  if (listeningFor) {
    e.preventDefault();
    if (e.key === 'Escape') { listeningFor = null; renderShortcutList(); return; }
    if (UNBINDABLE.has(e.key)) return; // pure modifier/Tab/CapsLock alone — keep listening for the real key
    const combo = comboFromEvent(e);
    if (RESERVED_COMBOS.has(combo)) {
      shortcutMsg.textContent = `"${comboLabel(combo)}" is reserved for moving between transcript rows.`;
      return;
    }
    const conflict = Object.entries(bindings).find(([act, k]) => act !== listeningFor && k === combo);
    if (conflict) {
      shortcutMsg.textContent = `"${comboLabel(combo)}" is already used for ${ACTION_LABELS[conflict[0]]}.`;
      return;
    }
    bindings[listeningFor] = combo;
    saveBindings();
    listeningFor = null;
    shortcutMsg.textContent = '';
    renderShortcutList();
    renderShortcutHints();
    return;
  }

  // Settings dialog open but idle: Escape closes it, Tab stays trapped inside.
  if (!settingsOverlay.hidden) {
    if (e.key === 'Escape') { closeSettings(); return; }
    if (e.key === 'Tab') trapFocus(e, settingsDialog);
    return;
  }

  // Columns dialog: same pattern.
  if (!columnsOverlay.hidden) {
    if (e.key === 'Escape') { closeColumnsDialog(); return; }
    if (e.key === 'Tab') trapFocus(e, columnsDialog);
    return;
  }

  // Undo/redo — skipped while actually typing in a cell so the browser's
  // own text-undo handles in-progress edits; ours takes over once you
  // click away (see the cell focus/blur handlers in renderBody).
  if (!isEditingCell() && (isUndoKey(e) || isRedoKey(e))) {
    e.preventDefault();
    if (isRedoKey(e)) redo(); else undo();
    return;
  }

  // Tab/Shift+Tab already move across cells in a row natively. Shift+Up/Down
  // move to the same column in the row above/below.
  if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && isGridCell(document.activeElement)) {
    e.preventDefault();
    moveCellFocus(document.activeElement, e.key === 'ArrowUp' ? -1 : 1);
    return;
  }

  if (isFormInput()) return;
  if (!video.src) return;

  // A binding can now be a chord (e.g. "shift+w"), so "satisfied" means
  // every key it names is currently held, not just the one in this event.
  let matched = false;
  ['play', 'rewind', 'forward'].forEach((action) => {
    if (!comboSatisfied(bindings[action])) return;
    matched = true;
    if (activeActions.has(action)) return; // already triggered — ignore OS key-repeat
    activeActions.add(action);
    if (action === 'play') video.play();
    else startScrub(action === 'rewind' ? -1 : 1);
  });
  if (matched) e.preventDefault();
}

function handleKeyUp(e) {
  heldTokens.delete(keyToken(e.key));

  // Releasing any key in a chord (not just the "main" one) should stop the
  // action — letting go of Shift while still holding W stops "Shift+W" too.
  ['play', 'rewind', 'forward'].forEach((action) => {
    if (!activeActions.has(action) || comboSatisfied(bindings[action])) return;
    activeActions.delete(action);
    if (action === 'play') {
      video.pause();
      video.currentTime = Math.max(0, video.currentTime - 0.5);
    } else {
      stopScrub();
    }
  });
}

window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);

// If focus leaves the window while a key is held (Alt-Tab, clicking another
// app), its keyup can be missed entirely — without this, that key would
// stay "stuck" held forever as far as the chord tracking is concerned.
window.addEventListener('blur', () => {
  heldTokens.clear();
  if (activeActions.has('play')) video.pause();
  if (activeActions.has('rewind') || activeActions.has('forward')) stopScrub();
  activeActions.clear();
});

// ---- Layout toggle ------------------------------------------------------
// ---- Cell merges (vertical, within a single column) ----------------------
// A merge covers the anchor row plus N rows immediately below it. Anchor
// and covered rows must stay contiguous in state.rows — if a row gets
// inserted or deleted in between, the merge is dropped automatically
// rather than silently covering the wrong row.
function cleanMerges() {
  state.merges = state.merges.filter((m) => {
    const anchorIdx = state.rows.findIndex((r) => r.id === m.anchorRowId);
    if (anchorIdx === -1 || !m.coveredRowIds.length) return false;
    for (let i = 0; i < m.coveredRowIds.length; i++) {
      const row = state.rows[anchorIdx + 1 + i];
      if (!row || row.id !== m.coveredRowIds[i]) return false;
    }
    return true;
  });
}
function findMerge(colId, rowId) {
  return state.merges.find((m) => m.colId === colId && (m.anchorRowId === rowId || m.coveredRowIds.includes(rowId)));
}
function isCoveredCell(colId, rowId) {
  return state.merges.some((m) => m.colId === colId && m.coveredRowIds.includes(rowId));
}
function mergeSpan(colId, rowId) {
  const m = state.merges.find((mm) => mm.colId === colId && mm.anchorRowId === rowId);
  return m ? 1 + m.coveredRowIds.length : 1;
}

let cellSelection = null; // { colId, rowIds: [...] } | null
let selectionAnchorRowId = null;
let draggedColId = null; // column currently being drag-reordered
let suppressNextFocusSync = false; // a click already set selection via mousedown; don't let the resulting focus event clobber it

function selectCell(colId, rowId, extend) {
  if (extend && cellSelection && cellSelection.colId === colId && selectionAnchorRowId) {
    const rows = state.rows;
    const startIdx = rows.findIndex((r) => r.id === selectionAnchorRowId);
    const endIdx = rows.findIndex((r) => r.id === rowId);
    const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
    cellSelection = { colId, rowIds: rows.slice(lo, hi + 1).map((r) => r.id) };
  } else {
    selectionAnchorRowId = rowId;
    cellSelection = { colId, rowIds: [rowId] };
  }
  updateSelectionHighlight();
  updateMergeButton();
}

function updateSelectionHighlight() {
  gridBody.querySelectorAll('td[data-col-id]').forEach((td) => {
    const tr = td.closest('tr');
    const match = cellSelection && td.dataset.colId === cellSelection.colId && tr && cellSelection.rowIds.includes(tr.dataset.rowId);
    td.classList.toggle('cellSelected', !!match);
  });
}

function updateMergeButton() {
  const btn = document.getElementById('btnMergeCells');
  if (cellSelection && cellSelection.rowIds.length >= 2) {
    btn.textContent = 'Merge Cells';
    btn.disabled = false;
    btn.onclick = doMerge;
    return;
  }
  const single = cellSelection && cellSelection.rowIds.length === 1 ? cellSelection : null;
  const merge = single && findMerge(single.colId, single.rowIds[0]);
  if (merge && merge.anchorRowId === single.rowIds[0]) {
    btn.textContent = 'Unmerge Cells';
    btn.disabled = false;
    btn.onclick = () => doUnmerge(merge);
  } else {
    btn.textContent = 'Merge Cells';
    btn.disabled = true;
    btn.onclick = null;
  }
}

function doMerge() {
  const { colId, rowIds } = cellSelection;
  if (rowIds.some((id) => findMerge(colId, id))) {
    alert('One of the selected cells is already part of a merge — unmerge it first.');
    return;
  }
  pushUndo();
  const texts = rowIds
    .map((id) => (state.rows.find((r) => r.id === id).cells[colId] || '').trim())
    .filter(Boolean);
  const anchorRowId = rowIds[0];
  state.rows.find((r) => r.id === anchorRowId).cells[colId] = texts.join(' ');
  rowIds.slice(1).forEach((id) => { state.rows.find((r) => r.id === id).cells[colId] = ''; });
  state.merges.push({ colId, anchorRowId, coveredRowIds: rowIds.slice(1) });
  render();
}

function doUnmerge(merge) {
  pushUndo();
  state.merges = state.merges.filter((m) => m !== merge);
  render();
}

// A deleted row can be the anchor or a covered member of a merge — hand the
// merged text down to the next row rather than silently dropping it.
function removeRow(rowId) {
  state.merges.forEach((m) => {
    if (m.anchorRowId === rowId) {
      const promoted = m.coveredRowIds.shift();
      if (promoted) {
        const oldAnchor = state.rows.find((r) => r.id === rowId);
        const newAnchor = state.rows.find((r) => r.id === promoted);
        newAnchor.cells[m.colId] = oldAnchor.cells[m.colId];
        m.anchorRowId = promoted;
      }
    } else {
      const idx = m.coveredRowIds.indexOf(rowId);
      if (idx !== -1) m.coveredRowIds.splice(idx, 1);
    }
  });
  state.merges = state.merges.filter((m) => m.coveredRowIds.length > 0);
  state.rows = state.rows.filter((r) => r.id !== rowId);
  if (lastFocusedRowId === rowId) lastFocusedRowId = null;
}

// ---- Grid rendering -----------------------------------------------------
function render() {
  cellSelection = null;
  selectionAnchorRowId = null;
  renderHead();
  renderBody();
  renderCodingPanel();
  applyFrozenColumns();
  updateUndoRedoButtons();
}

// ---- Undo / redo (rows, columns, cell text, merges — not view prefs like
// frozen/width/layout, which aren't "data" you'd expect Cmd/Ctrl+Z to touch) --
const MAX_UNDO = 50;
let undoStack = [];
let redoStack = [];
let pendingCellEdit = null; // captured on cell focus, committed on blur only if changed

function snapshotState() {
  return JSON.parse(JSON.stringify({ columns: state.columns, rows: state.rows, merges: state.merges }));
}
function commitUndoSnapshot(snapshot) {
  undoStack.push(snapshot);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons();
  markDirty();
}
function pushUndo() {
  commitUndoSnapshot(snapshotState());
}
function resetUndoHistory() {
  undoStack = [];
  redoStack = [];
  pendingCellEdit = null;
  isDirty = false;
  clearTimeout(autosaveTimer);
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshotState());
  state = undoStack.pop();
  render();
  flashSaveStatus('Undid last change.');
  markDirty();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshotState());
  state = redoStack.pop();
  render();
  flashSaveStatus('Redid last change.');
  markDirty();
}
function updateUndoRedoButtons() {
  const btnUndo = document.getElementById('btnUndo');
  const btnRedo = document.getElementById('btnRedo');
  if (btnUndo) btnUndo.disabled = !undoStack.length;
  if (btnRedo) btnRedo.disabled = !redoStack.length;
}
function isUndoKey(e) {
  return (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
}
function isRedoKey(e) {
  const mod = e.metaKey || e.ctrlKey;
  return mod && ((e.shiftKey && e.key.toLowerCase() === 'z') || (!e.shiftKey && e.key.toLowerCase() === 'y'));
}

// Pins user-chosen columns to the left edge of the grid while scrolling
// horizontally. Widths vary with content, so offsets are measured from the
// live DOM after render rather than assumed — each frozen column's `left`
// is the summed width of the frozen columns before it.
// ponytail: renderBody() always builds fresh <td>s from scratch (no reuse),
// so a newly-rendered cell never has .frozenCol/style.left in the first
// place — there's nothing to "unfreeze". Only touching actually-frozen
// columns turns this from an O(all columns × all rows) DOM walk (with a
// forced layout read per column) into O(frozen columns) — the previous
// version was doing that full walk on every render regardless of whether
// any column was even frozen, which is what made large transcripts feel slow.
function applyFrozenColumns() {
  const frozenCols = state.columns.filter((c) => c.frozen);
  if (!frozenCols.length) return;
  const rmHeadCell = gridHeadRow.querySelector('.rowActionCol');
  let offset = rmHeadCell ? rmHeadCell.getBoundingClientRect().width : 0;
  frozenCols.forEach((col) => {
    const headCell = gridHeadRow.querySelector(`[data-col-id="${col.id}"]`);
    const bodyCells = gridBody.querySelectorAll(`[data-col-id="${col.id}"]`);
    const allCells = headCell ? [headCell, ...bodyCells] : [...bodyCells];
    allCells.forEach((el) => {
      el.classList.add('frozenCol');
      el.style.left = `${offset}px`;
    });
    if (headCell) offset += headCell.getBoundingClientRect().width;
  });
}

// ---- Back-to-top overlay (targets the grid's own scroll region) ---------
tableScroll.addEventListener('scroll', () => {
  btnBackToTop.hidden = tableScroll.scrollTop < 300;
});
btnBackToTop.onclick = () => tableScroll.scrollTo({ top: 0, behavior: 'smooth' });

// Deletes a column, wired up from both the Columns dialog and (if ever
// needed again) anywhere else — one place owns the actual mutation.
function deleteColumn(col) {
  if (!confirm(`Delete column "${col.name}"?`)) return;
  pushUndo();
  state.columns = state.columns.filter((c) => c.id !== col.id);
  state.rows.forEach((r) => delete r.cells[col.id]);
  state.merges = state.merges.filter((m) => m.colId !== col.id);
  activeFilters.delete(col.id);
  render();
}

// Auto-sizes a column to fit its header text (measured, not guessed) plus
// room for the drag handle/freeze checkbox — sticks only until the user
// drags the column narrower/wider, at which point col.width takes over.
// Canvas text measurement instead of a hidden-span-in-the-DOM: the span
// approach requires a real layout pass (getBoundingClientRect forces one),
// which is cheap in isolation but was forcing a full-page reflow on every
// column of every render — brutal with a 1000+ row table already in the
// DOM. Canvas measureText never touches layout at all. Cached by name
// since a column's default width never changes unless it's renamed.
let measureCtx = null;
function measureTextWidth(text, font) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}
const columnWidthCache = new Map();
function defaultColumnWidth(col) {
  const upper = col.name.toUpperCase();
  if (columnWidthCache.has(upper)) return columnWidthCache.get(upper);
  const fontSize = 13;
  const textWidth = measureTextWidth(upper, `600 ${fontSize}px 'Fraunces', Georgia, serif`);
  const letterSpacing = fontSize * 0.03 * Math.max(0, upper.length - 1); // matches CSS letter-spacing: 0.03em
  const chrome = 60; // drag handle + freeze checkbox + gaps + cell padding
  const width = Math.max(70, Math.min(320, Math.round(textWidth + letterSpacing + chrome)));
  columnWidthCache.set(upper, width);
  return width;
}

function renderHead() {
  gridHeadRow.innerHTML = '';
  const rmHeadCell = document.createElement('th');
  rmHeadCell.className = 'rowActionCol';
  rmHeadCell.style.width = '40px'; // table-layout:fixed needs every column sized explicitly
  rmHeadCell.appendChild(Object.assign(document.createElement('span'), { className: 'visually-hidden', textContent: 'Row actions' }));
  gridHeadRow.appendChild(rmHeadCell);

  state.columns.forEach((col) => {
    const th = document.createElement('th');
    th.dataset.colId = col.id;
    if (col.type === 'codes') th.classList.add('codeColHeader');
    th.style.width = `${col.width || defaultColumnWidth(col)}px`;
    const wrap = document.createElement('div');
    wrap.className = 'colHead';

    const dragHandle = document.createElement('span');
    dragHandle.className = 'dragHandle';
    dragHandle.textContent = '⠿';
    dragHandle.title = 'Drag to reorder column';
    dragHandle.setAttribute('aria-hidden', 'true');
    dragHandle.draggable = true;
    dragHandle.addEventListener('dragstart', (e) => {
      draggedColId = col.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', col.id);
      th.classList.add('dragging');
    });
    dragHandle.addEventListener('dragend', () => {
      th.classList.remove('dragging');
      draggedColId = null;
    });
    wrap.appendChild(dragHandle);

    const freezeLabel = document.createElement('label');
    freezeLabel.className = 'freezeToggle';
    freezeLabel.title = 'Freeze this column while scrolling';
    const freezeCb = document.createElement('input');
    freezeCb.type = 'checkbox';
    freezeCb.checked = !!col.frozen;
    freezeCb.setAttribute('aria-label', `Freeze column "${col.name}"`);
    freezeCb.onchange = () => { col.frozen = freezeCb.checked; render(); };
    freezeLabel.appendChild(freezeCb);
    wrap.appendChild(freezeLabel);

    const nameInput = document.createElement('input');
    nameInput.value = col.name;
    nameInput.setAttribute('aria-label', `Rename column "${col.name}"`);
    nameInput.onchange = () => { pushUndo(); col.name = nameInput.value; renderCodingPanel(); };
    wrap.appendChild(nameInput);

    th.appendChild(wrap);

    const handle = document.createElement('span');
    handle.className = 'colResizeHandle';
    handle.setAttribute('aria-hidden', 'true');
    handle.addEventListener('mousedown', (e) => startColumnResize(e, col, th, handle));
    th.appendChild(handle);

    th.addEventListener('dragover', (e) => {
      if (!draggedColId || draggedColId === col.id) return;
      e.preventDefault(); // required to allow a drop
      th.classList.add('dragOver');
    });
    th.addEventListener('dragleave', () => th.classList.remove('dragOver'));
    th.addEventListener('drop', (e) => {
      e.preventDefault();
      th.classList.remove('dragOver');
      if (!draggedColId || draggedColId === col.id) return;
      reorderColumn(draggedColId, col.id);
    });

    gridHeadRow.appendChild(th);
  });
}

// Drops the dragged column immediately before the drop target, recomputing
// the target's index after removal so it works correctly in both directions.
function reorderColumn(draggedId, targetId) {
  const cols = state.columns;
  const fromIdx = cols.findIndex((c) => c.id === draggedId);
  if (fromIdx === -1) return;
  pushUndo();
  const [moved] = cols.splice(fromIdx, 1);
  const toIdx = cols.findIndex((c) => c.id === targetId);
  cols.splice(toIdx === -1 ? cols.length : toIdx, 0, moved);
  render();
}

// Drag a column header's right edge to resize it. table-layout: fixed means
// the header row's widths drive every cell below it, so only the <th> needs
// to be touched.
function startColumnResize(e, col, th, handle) {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = th.getBoundingClientRect().width;
  handle.classList.add('resizing');

  function onMove(moveEvent) {
    const width = Math.max(60, Math.round(startWidth + (moveEvent.clientX - startX)));
    col.width = width;
    th.style.width = `${width}px`;
    applyFrozenColumns();
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    handle.classList.remove('resizing');
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function renderBody() {
  cleanMerges();
  gridBody.innerHTML = '';
  state.rows.forEach((row, rowIndex) => {
    const tr = document.createElement('tr');
    tr.dataset.rowId = row.id;

    const rmTd = document.createElement('td');
    rmTd.className = 'rowActionCol';
    const rm = document.createElement('button');
    rm.className = 'rmBtn';
    rm.textContent = '✕';
    rm.setAttribute('aria-label', `Delete row ${rowIndex + 1}`);
    rm.title = 'Delete row';
    rm.onclick = () => { pushUndo(); removeRow(row.id); render(); };
    rmTd.appendChild(rm);
    tr.appendChild(rmTd);

    state.columns.forEach((col) => {
      if (isCoveredCell(col.id, row.id)) return; // covered by a merge anchored above

      const td = document.createElement('td');
      td.dataset.colId = col.id;
      td.setAttribute('aria-label', `${col.name}, row ${rowIndex + 1}`);
      if (col.id === 'time') {
        td.classList.add('timeCell');
        td.title = 'Double-click to jump the video here';
        td.addEventListener('dblclick', () => {
          const t = parseTime(td.textContent);
          if (t !== null && video.src) video.currentTime = t;
        });
      } else if (col.id !== 'time' && /time/i.test(col.name)) {
        // Sanity check: a column that LOOKS like a time column but didn't
        // get the special 'time' id (e.g. its header text isn't literally
        // "time") — double-click won't be wired up on it at all.
        td.title = col.name + ' (not recognized as the time column — double-click won’t seek)';
      }
      const span = mergeSpan(col.id, row.id);
      if (span > 1) td.rowSpan = span;

      td.addEventListener('mousedown', (e) => {
        suppressNextFocusSync = true;
        selectCell(col.id, row.id, e.shiftKey);
      });
      td.addEventListener('focus', () => {
        lastFocusedRowId = row.id;
        // A click already set selection via mousedown (above), including any
        // shift-click range extension — don't stomp on it. Any OTHER way of
        // landing here (Tab, Shift+Tab, the row-navigation hotkeys) should
        // move the highlight to just this cell.
        if (suppressNextFocusSync) suppressNextFocusSync = false;
        else selectCell(col.id, row.id, false);
      });

      if (col.type === 'codes') {
        renderCodeCell(td, row, col);
      } else {
        td.contentEditable = 'true';
        td.textContent = row.cells[col.id] || '';
        td.addEventListener('input', () => {
          row.cells[col.id] = td.textContent;
          // Cheap: just re-check which rows are visible. The coding panel's
          // own tag counts refresh once on blur (below), not per keystroke —
          // with many columns that full rescan is too costly to do live.
          if (activeFilters.has(col.id)) applyFilter();
        });
        td.addEventListener('focus', () => {
          pendingCellEdit = { snapshot: snapshotState(), before: row.cells[col.id] || '' };
        });
        td.addEventListener('blur', () => {
          if (pendingCellEdit && pendingCellEdit.before !== (row.cells[col.id] || '')) {
            commitUndoSnapshot(pendingCellEdit.snapshot);
            renderCodingPanel();
          }
          pendingCellEdit = null;
        });
      }
      tr.appendChild(td);
    });

    gridBody.appendChild(tr);
  });
  applyFilter();
  updateSelectionHighlight();
  updateMergeButton();
}

function newRow(cells = {}) {
  return { id: uid('r'), cells };
}

function findTimeColumnId() {
  const byId = state.columns.find((c) => c.id === 'time');
  if (byId) return byId.id;
  const byName = state.columns.find((c) => /time/i.test(c.name));
  if (byName) return byName.id;
  return state.columns[0] ? state.columns[0].id : null;
}

// Scrolls the transcript to whichever row's timestamp the video just passed,
// keeping it in view while playback runs — including while a cell is
// focused/being typed in, since scrolling doesn't touch the cursor or
// keystrokes the way the video hotkeys do.
let lastAutoScrollRowId = null;
function autoScrollTranscript() {
  if (video.paused) return;
  const timeColId = findTimeColumnId();
  if (!timeColId) return;
  const t = video.currentTime || 0;
  let active = null;
  let activeTime = -Infinity;
  state.rows.forEach((row) => {
    const rt = parseTime(row.cells[timeColId]);
    if (rt !== null && rt <= t && rt > activeTime) { active = row; activeTime = rt; }
  });
  if (!active || active.id === lastAutoScrollRowId) return;
  lastAutoScrollRowId = active.id;
  const tr = gridBody.querySelector(`tr[data-row-id="${active.id}"]`);
  if (tr) tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// Inserts right after whichever row you were last typing in, instead of
// always at the end of the transcript.
function insertRow(cells = {}) {
  const row = newRow(cells);
  const idx = state.rows.findIndex((r) => r.id === lastFocusedRowId);
  if (idx === -1) state.rows.push(row);
  else state.rows.splice(idx + 1, 0, row);
  lastFocusedRowId = row.id;
  return row;
}

document.getElementById('btnAddRow').onclick = () => {
  pushUndo();
  insertRow();
  render();
};

document.getElementById('btnInsertTimestamp').onclick = () => {
  pushUndo();
  const timeColId = findTimeColumnId();
  const row = insertRow(timeColId ? { [timeColId]: fmtTime(video.currentTime || 0) } : {});
  render();
  const tr = gridBody.querySelector(`tr[data-row-id="${row.id}"]`);
  const idx = state.columns.findIndex((c) => c.id === 'transcript');
  const focusIdx = idx >= 0 ? idx : 0;
  if (tr && tr.children[focusIdx]) tr.children[focusIdx].focus();
};

document.getElementById('btnAddCol').onclick = () => {
  const name = prompt('Column name (e.g. a code category like "Emotion" or "Topic"):');
  if (!name) return;
  pushUndo();
  const col = { id: uid('c'), name };
  state.columns.push(col);
  render();
};

// ---- Coding panel: filter + counts --------------------------------------
document.getElementById('btnToggleCoding').onclick = () => {
  const willShow = codingPanel.hidden;
  codingPanel.hidden = !willShow;
  document.getElementById('btnToggleCoding').setAttribute('aria-pressed', String(willShow));
};
document.getElementById('btnClearFilter').onclick = () => {
  activeFilters.clear();
  codingColumnsList.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
  codingColumnsList.querySelectorAll('details').forEach((d) => { d.open = false; });
  applyFilter();
  updateFilterSummary();
};

function splitTags(text) {
  return (text || '').split(',').map((t) => t.trim()).filter(Boolean);
}

// ---- Coding columns: chip display + Notion-style multi-select editor -----
// Cell values stay plain comma-separated strings (same as before, and what
// TSV/CSV/XLS export already expects) — only the editing UI changes. The
// list of "known" codes for a column isn't stored separately; it's derived
// live from whatever's already used anywhere in that column.
function allTagsForColumn(colId) {
  const set = new Set();
  state.rows.forEach((r) => splitTags(r.cells[colId]).forEach((t) => set.add(t)));
  return [...set].sort((a, b) => a.localeCompare(b));
}

function renderCodeCell(td, row, col) {
  td.classList.add('codeCell');
  td.tabIndex = 0;
  const tags = splitTags(row.cells[col.id]);
  const chipWrap = document.createElement('div');
  chipWrap.className = 'chipWrap';
  tags.forEach((tag) => {
    const chip = document.createElement('span');
    chip.className = 'tagChip';
    chip.textContent = tag;
    chipWrap.appendChild(chip);
  });
  const addBtn = document.createElement('span');
  addBtn.className = 'chipAddBtn';
  addBtn.textContent = tags.length ? '+' : '+ Add code';
  chipWrap.appendChild(addBtn);
  td.appendChild(chipWrap);

  const open = (e) => { e.preventDefault(); openCodeCellEditor(td, row, col); };
  td.addEventListener('click', open);
  td.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') open(e);
  });
}

let openCodeEditor = null;
let currentCodeEditorCommit = null;

function closeCodeCellEditor() {
  document.removeEventListener('mousedown', handleCodeEditorOutsideClick, true);
  if (!openCodeEditor) return;
  if (currentCodeEditorCommit) currentCodeEditorCommit();
  currentCodeEditorCommit = null;
  openCodeEditor.remove();
  openCodeEditor = null;
  render();
}
function handleCodeEditorOutsideClick(e) {
  // Catches clicks on non-focusable areas (focusout below won't fire for those).
  if (openCodeEditor && !openCodeEditor.contains(e.target)) closeCodeCellEditor();
}

function openCodeCellEditor(td, row, col) {
  if (openCodeEditor) closeCodeCellEditor();
  const preSnapshot = snapshotState();
  const selected = new Set(splitTags(row.cells[col.id]));
  let changed = false;

  const popover = document.createElement('div');
  popover.className = 'codePopover';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search or create a code…';
  popover.appendChild(input);
  const list = document.createElement('div');
  list.className = 'codeOptionList';
  popover.appendChild(list);

  function toggle(tag) {
    if (selected.has(tag)) selected.delete(tag); else selected.add(tag);
    changed = true;
    row.cells[col.id] = [...selected].join(', ');
    renderOptions();
  }

  function renderOptions() {
    list.innerHTML = '';
    const query = input.value.trim();
    const queryLower = query.toLowerCase();
    const all = allTagsForColumn(col.id);
    if (query && !all.some((t) => t.toLowerCase() === queryLower)) {
      const createRow = document.createElement('button');
      createRow.type = 'button';
      createRow.className = 'codeOptionRow codeOptionCreate';
      createRow.textContent = `+ Create "${query}"`;
      createRow.onclick = () => { toggle(query); input.value = ''; input.focus(); renderOptions(); };
      list.appendChild(createRow);
    }
    all.filter((t) => t.toLowerCase().includes(queryLower)).forEach((tag) => {
      const optBtn = document.createElement('button');
      optBtn.type = 'button';
      optBtn.className = 'codeOptionRow' + (selected.has(tag) ? ' codeOptionSelected' : '');
      optBtn.innerHTML = `<span class="codeOptionCheck">${selected.has(tag) ? '✓' : ''}</span>${tag}`;
      optBtn.onclick = () => toggle(tag);
      list.appendChild(optBtn);
    });
    if (!query && !all.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.style.margin = '4px 2px';
      empty.textContent = 'Type to create the first code.';
      list.appendChild(empty);
    }
  }

  input.addEventListener('input', renderOptions);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // don't let video shortcuts leak through while typing here
    if (e.key === 'Enter') {
      e.preventDefault();
      const query = input.value.trim();
      if (!query) return;
      const all = allTagsForColumn(col.id);
      const exact = all.find((t) => t.toLowerCase() === query.toLowerCase());
      toggle(exact || query);
      input.value = '';
    } else if (e.key === 'Escape') {
      closeCodeCellEditor();
    } else if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      // Moving to another row (even by hotkey) closes the popup — nothing
      // has to be chosen first.
      e.preventDefault();
      const rowId = td.closest('tr').dataset.rowId;
      const colId = td.dataset.colId;
      closeCodeCellEditor();
      const freshTd = gridBody.querySelector(`tr[data-row-id="${rowId}"] td[data-col-id="${colId}"]`);
      if (freshTd) moveCellFocus(freshTd, e.key === 'ArrowUp' ? -1 : 1);
    }
  });
  // Any focus change that leaves the popover entirely (Tab, clicking a
  // different cell, clicking another focusable control) closes it too.
  popover.addEventListener('focusout', (e) => {
    if (e.relatedTarget && popover.contains(e.relatedTarget)) return;
    closeCodeCellEditor();
  });

  renderOptions();
  document.body.appendChild(popover); // fixed + body-level so it can't be clipped by the grid's own scroll region
  positionPopover(popover, td);
  openCodeEditor = popover;
  currentCodeEditorCommit = () => { if (changed) commitUndoSnapshot(preSnapshot); };
  input.focus();
  document.addEventListener('mousedown', handleCodeEditorOutsideClick, true);
  tableScroll.addEventListener('scroll', closeCodeCellEditor, { once: true });
}

function positionPopover(popover, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const width = 220;
  let left = Math.min(rect.left, window.innerWidth - width - 10);
  left = Math.max(10, left);
  popover.style.left = `${left}px`;
  popover.style.top = `${rect.bottom + 4}px`;
  requestAnimationFrame(() => {
    const popRect = popover.getBoundingClientRect();
    if (popRect.bottom > window.innerHeight - 10) {
      popover.style.top = `${Math.max(10, rect.top - popRect.height - 4)}px`;
    }
  });
}

// One section per column that actually has any tags, each collapsible so a
// transcript with many coded columns doesn't turn this into an unreadable
// wall — auto-expanded if that column already has an active filter.
function renderCodingPanel() {
  codingColumnsList.innerHTML = '';
  state.columns.filter((c) => c.type === 'codes').forEach((col) => {
    const counts = new Map();
    state.rows.forEach((row) => {
      splitTags(row.cells[col.id]).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    });
    if (!counts.size) return;

    const selected = activeFilters.get(col.id);

    const details = document.createElement('details');
    details.className = 'codingColumnSection';
    details.open = !!(selected && selected.size);

    const summary = document.createElement('summary');
    summary.textContent = col.name + (selected && selected.size ? ` — ${selected.size} selected` : '');
    details.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'codeTagList';
    [...counts.entries()].sort((a, b) => b[1] - a[1]).forEach(([tag, count]) => {
      const label = document.createElement('label');
      label.className = 'codeTagRow';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!(selected && selected.has(tag));
      cb.onchange = () => toggleFilterTag(col.id, tag, cb.checked, details, summary, col.name);
      label.appendChild(cb);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'codeTagName';
      nameSpan.textContent = tag;
      label.appendChild(nameSpan);

      const countSpan = document.createElement('span');
      countSpan.className = 'codeTagCount';
      countSpan.textContent = count;
      label.appendChild(countSpan);

      list.appendChild(label);
    });
    details.appendChild(list);
    codingColumnsList.appendChild(details);
  });
  updateFilterSummary();
}

// Toggling a checkbox only needs to update the filter + row visibility +
// this one section's summary text — not rebuild the whole panel (which
// would reset scroll position every time you check a box).
function toggleFilterTag(colId, tag, isSelected, details, summary, colName) {
  if (!activeFilters.has(colId)) activeFilters.set(colId, new Set());
  const set = activeFilters.get(colId);
  if (isSelected) set.add(tag); else set.delete(tag);
  if (!set.size) activeFilters.delete(colId);
  summary.textContent = colName + (set.size ? ` — ${set.size} selected` : '');
  applyFilter();
  updateFilterSummary();
}

function updateFilterSummary() {
  const summaryEl = document.getElementById('filterSummary');
  if (!activeFilters.size) { summaryEl.textContent = ''; return; }
  const matching = state.rows.filter((row) => rowMatchesFilters(row)).length;
  summaryEl.textContent = `${matching} of ${state.rows.length} rows match`;
}

// AND across columns (to see overlap/co-occurrence between codes in
// different columns), OR within a column (multiple codes in the same
// column broaden that one column's match).
function rowMatchesFilters(row) {
  if (!activeFilters.size) return true;
  return [...activeFilters.entries()].every(([colId, tags]) => {
    const rowTags = splitTags(row.cells[colId]);
    return [...tags].some((tag) => rowTags.includes(tag));
  });
}

function applyFilter() {
  [...gridBody.children].forEach((tr) => {
    const row = state.rows.find((r) => r.id === tr.dataset.rowId);
    tr.classList.toggle('hiddenRow', !rowMatchesFilters(row));
  });
}

// ---- Delimited-text parsing (transcripts are tab-delimited by default; -----
// ---- comma/.csv still read for backward compatibility) --------------------
function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

function delimiterForFile(name) { return /\.csv$/i.test(name) ? ',' : '\t'; }

// Reads the header row of a transcript file and builds columns to match it,
// instead of forcing the app's default Time/Speaker/Transcript/... layout.
function trimTrailingBlankHeaders(headerNames) {
  // Spreadsheet exports (Excel/Numbers "Save As CSV") often pad rows with
  // extra empty trailing columns — without this, each one becomes its own
  // empty "Column" in the grid.
  let lastNonEmpty = -1;
  headerNames.forEach((h, i) => { if ((h || '').trim()) lastNonEmpty = i; });
  return headerNames.slice(0, lastNonEmpty + 1);
}

function delimitedToState(text, delimiter) {
  const table = parseDelimited(text, delimiter);
  if (!table.length) return { columns: state.columns.map((c) => ({ ...c })), rows: [] };

  const headerNames = trimTrailingBlankHeaders(table[0]);
  if (!headerNames.length) return { columns: state.columns.map((c) => ({ ...c })), rows: [] };

  let usedTimeId = false;
  const columns = headerNames.map((name) => {
    const trimmed = name.trim() || 'Column';
    const isTime = !usedTimeId && /time/i.test(trimmed);
    if (isTime) usedTimeId = true;
    return { id: isTime ? 'time' : uid('c'), name: trimmed };
  });
  const rows = table.slice(1).map((cells) => {
    const row = newRow();
    columns.forEach((col, i) => { row.cells[col.id] = (cells[i] || '').trim(); });
    return row;
  });
  return { columns, rows };
}

function escapeField(v, delimiter) {
  const s = String(v ?? '');
  return s.includes(delimiter) || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}
function stateToDelimited(delimiter) {
  const header = state.columns.map((c) => escapeField(c.name, delimiter)).join(delimiter);
  const lines = state.rows.map((row) =>
    state.columns.map((c) => escapeField(row.cells[c.id], delimiter)).join(delimiter)
  );
  return [header, ...lines].join('\n');
}

// ---- Excel-compatible format (.xls) --------------------------------------
// A real .xlsx is a zip of XML parts — too much to hand-roll for a local
// tool. Excel (and this app, via DOMParser) will happily read an HTML
// <table> saved with an .xls extension, and HTML rowspan maps directly
// onto real Excel merged cells — no zip/XML writer needed either way.
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function isXlsFile(name) { return /\.xls$/i.test(name); }

function stateToXls() {
  cleanMerges();
  const headCells = state.columns.map((c) => `<th>${escapeHtml(c.name)}</th>`).join('');
  const bodyRows = state.rows.map((row) => {
    const cells = state.columns.map((col) => {
      if (isCoveredCell(col.id, row.id)) return '';
      const span = mergeSpan(col.id, row.id);
      const spanAttr = span > 1 ? ` rowspan="${span}"` : '';
      const text = escapeHtml(row.cells[col.id] || '').replace(/\n/g, '<br>');
      return `<td${spanAttr}>${text}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8">`
    + `<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>`
    + `<x:Name>Transcript</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>`
    + `</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>`
    + `<body><table border="1"><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table></body></html>`;
}

// stateToXls() writes newlines as <br> (HTML has no other way to hard-break
// within a cell) — textContent alone would silently drop them on the way back.
function cellText(el) {
  [...el.querySelectorAll('br')].forEach((br) => br.replaceWith('\n'));
  return el.textContent;
}

function xlsToState(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return { columns: state.columns.map((c) => ({ ...c })), rows: [], merges: [] };

  const headEls = [...table.querySelectorAll('thead th, thead td')];
  const rawHeaderCells = headEls.length ? headEls : [...(table.rows[0] ? table.rows[0].cells : [])];
  let lastNonEmpty = -1;
  rawHeaderCells.forEach((cell, i) => { if ((cell.textContent || '').trim()) lastNonEmpty = i; });
  if (lastNonEmpty === -1) return { columns: state.columns.map((c) => ({ ...c })), rows: [], merges: [] };
  const headerCells = rawHeaderCells.slice(0, lastNonEmpty + 1);

  let usedTimeId = false;
  const columns = headerCells.map((cell) => {
    const trimmed = (cell.textContent || '').trim() || 'Column';
    const isTime = !usedTimeId && /time/i.test(trimmed);
    if (isTime) usedTimeId = true;
    return { id: isTime ? 'time' : uid('c'), name: trimmed };
  });

  const bodyEl = table.tBodies[0];
  const bodyTrs = bodyEl ? [...bodyEl.rows] : [...table.rows].slice(1);

  const rows = [];
  const merges = [];
  const pending = columns.map(() => null); // { rowsLeft, anchorRowId } per column index

  bodyTrs.forEach((tr) => {
    const row = newRow();
    rows.push(row);
    let cellPtr = 0;
    columns.forEach((col, colIdx) => {
      if (pending[colIdx] && pending[colIdx].rowsLeft > 0) {
        let m = merges.find((mm) => mm.anchorRowId === pending[colIdx].anchorRowId && mm.colId === col.id);
        if (!m) { m = { colId: col.id, anchorRowId: pending[colIdx].anchorRowId, coveredRowIds: [] }; merges.push(m); }
        m.coveredRowIds.push(row.id);
        pending[colIdx].rowsLeft--;
        if (pending[colIdx].rowsLeft === 0) pending[colIdx] = null;
        row.cells[col.id] = '';
        return;
      }
      const cellEl = tr.cells[cellPtr]; cellPtr++;
      row.cells[col.id] = cellEl ? cellText(cellEl).trim() : '';
      const span = cellEl ? (parseInt(cellEl.getAttribute('rowspan'), 10) || 1) : 1;
      if (span > 1) pending[colIdx] = { rowsLeft: span - 1, anchorRowId: row.id };
    });
  });

  return { columns, rows, merges };
}

// ---- Real .xlsx import/export ---------------------------------------------
// A real .xlsx is a zip of XML parts. Reading hand-parses the zip's central
// directory (a small, well-defined binary format) and leans on native browser
// APIs for the hard parts: DecompressionStream for DEFLATE, DOMParser for the
// worksheet XML. Writing builds the same zip/XML structure back (see
// stateToXlsxBlob below) so a file opened as real .xlsx is saved as real
// .xlsx, not silently swapped to another format.
function isXlsxFile(name) { return /\.xlsx$/i.test(name); }

function parseZipCentralDirectory(bytes, dv) {
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('not a valid .xlsx file (no zip directory found)');
  const entryCount = dv.getUint16(eocdOffset + 10, true);
  let cdOffset = dv.getUint32(eocdOffset + 16, true);
  const entries = [];
  for (let i = 0; i < entryCount; i++) {
    if (dv.getUint32(cdOffset, true) !== 0x02014b50) break;
    const compMethod = dv.getUint16(cdOffset + 10, true);
    const compSize = dv.getUint32(cdOffset + 20, true);
    const nameLen = dv.getUint16(cdOffset + 28, true);
    const extraLen = dv.getUint16(cdOffset + 30, true);
    const commentLen = dv.getUint16(cdOffset + 32, true);
    const localHeaderOffset = dv.getUint32(cdOffset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
    entries.push({ name, compMethod, compSize, localHeaderOffset });
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function extractZipEntry(bytes, dv, entry) {
  const lfNameLen = dv.getUint16(entry.localHeaderOffset + 26, true);
  const lfExtraLen = dv.getUint16(entry.localHeaderOffset + 28, true);
  const dataStart = entry.localHeaderOffset + 30 + lfNameLen + lfExtraLen;
  const compData = bytes.subarray(dataStart, dataStart + entry.compSize);
  if (entry.compMethod === 0) return compData; // stored, no compression
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('this browser can’t decompress .xlsx files — try Chrome or Safari 16.4+, or save as .xls/.csv instead');
  }
  const stream = new Blob([compData]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function colLetterToIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

async function xlsxToState(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  const entries = parseZipCentralDirectory(bytes, dv);

  const sheetEntry = entries.find((e) => /^xl\/worksheets\/sheet1\.xml$/i.test(e.name))
    || entries.find((e) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.name));
  if (!sheetEntry) throw new Error('no worksheet found inside this .xlsx file');

  let sharedStrings = [];
  const sharedStringsEntry = entries.find((e) => e.name === 'xl/sharedStrings.xml');
  if (sharedStringsEntry) {
    const xml = new TextDecoder().decode(await extractZipEntry(bytes, dv, sharedStringsEntry));
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    sharedStrings = [...doc.getElementsByTagName('si')].map((si) => si.textContent || '');
  }

  const sheetXml = new TextDecoder().decode(await extractZipEntry(bytes, dv, sheetEntry));
  const doc = new DOMParser().parseFromString(sheetXml, 'text/xml');

  const grid = [];
  [...doc.getElementsByTagName('row')].forEach((rowEl) => {
    const rowIdx = parseInt(rowEl.getAttribute('r'), 10) - 1;
    grid[rowIdx] = grid[rowIdx] || [];
    [...rowEl.children].forEach((cellEl) => {
      const ref = cellEl.getAttribute('r') || '';
      const colIdx = colLetterToIndex(ref.replace(/\d+/g, ''));
      if (colIdx < 0) return;
      const type = cellEl.getAttribute('t');
      const vEl = cellEl.querySelector('v');
      let text = '';
      if (type === 's' && vEl) text = sharedStrings[parseInt(vEl.textContent, 10)] || '';
      else if (type === 'inlineStr') text = cellEl.querySelector('t')?.textContent || '';
      else if (vEl) text = vEl.textContent || '';
      grid[rowIdx][colIdx] = text;
    });
  });

  const maxCol = Math.max(0, ...grid.filter(Boolean).map((r) => r.length - 1));
  const rawHeader = (grid[0] || []).slice(0, maxCol + 1).map((v) => v || '');
  const headerNames = trimTrailingBlankHeaders(rawHeader);
  if (!headerNames.length) return { columns: state.columns.map((c) => ({ ...c })), rows: [], merges: [] };

  let usedTimeId = false;
  const columns = headerNames.map((name) => {
    const trimmed = (name || '').trim() || 'Column';
    const isTime = !usedTimeId && /time/i.test(trimmed);
    if (isTime) usedTimeId = true;
    return { id: isTime ? 'time' : uid('c'), name: trimmed };
  });

  const rows = grid.slice(1).map((cells) => {
    const row = newRow();
    columns.forEach((col, i) => { row.cells[col.id] = ((cells || [])[i] || '').toString().trim(); });
    return row;
  });

  // Only vertical (single-column) merges map onto our data model — a real
  // horizontal Excel merge is silently skipped rather than misrepresented.
  const merges = [];
  [...doc.getElementsByTagName('mergeCell')].forEach((mc) => {
    const [start, end] = (mc.getAttribute('ref') || '').split(':');
    if (!start || !end) return;
    const startCol = start.replace(/\d+/g, '');
    const endCol = end.replace(/\d+/g, '');
    if (startCol !== endCol) return;
    const colIdx = colLetterToIndex(startCol);
    if (colIdx >= columns.length) return;
    const startRow = parseInt(start.replace(/[A-Z]+/g, ''), 10) - 1 - 1; // -1 for 0-index, -1 for header row
    const endRow = parseInt(end.replace(/[A-Z]+/g, ''), 10) - 1 - 1;
    if (startRow < 0 || endRow <= startRow || endRow >= rows.length) return;
    merges.push({
      colId: columns[colIdx].id,
      anchorRowId: rows[startRow].id,
      coveredRowIds: rows.slice(startRow + 1, endRow + 1).map((r) => r.id),
    });
  });

  return { columns, rows, merges };
}

// ---- Real .xlsx writer ----------------------------------------------------
// If you opened a genuine .xlsx, saving should hand you back a genuine
// .xlsx — not an HTML file wearing its extension. Mirrors the reader above:
// a hand-rolled ZIP container (the format is small and well-defined) plus
// minimal-but-valid OOXML parts, using CompressionStream for DEFLATE (the
// write-side counterpart to the DecompressionStream used for reading) so
// no compression algorithm has to be hand-written either.
function colIndexToLetter(idx) {
  let n = idx + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function xmlEscape(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Builds a standard PKZIP archive (local file headers + central directory +
// end-of-central-directory record) from a list of { name, data } parts.
async function buildZip(files) {
  const encoder = new TextEncoder();
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const rawData = file.data;
    const compData = await deflateRaw(rawData);
    const crc = crc32(rawData);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0, true);
    local.setUint16(8, 8, true); // method: deflate
    local.setUint16(10, 0, true);
    local.setUint16(12, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, compData.length, true);
    local.setUint32(22, rawData.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    localChunks.push(new Uint8Array(local.buffer), nameBytes, compData);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0, true);
    central.setUint16(10, 8, true);
    central.setUint16(12, 0, true);
    central.setUint16(14, 0, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, compData.length, true);
    central.setUint32(24, rawData.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint16(30, 0, true);
    central.setUint16(32, 0, true);
    central.setUint16(34, 0, true);
    central.setUint16(36, 0, true);
    central.setUint32(38, 0, true);
    central.setUint32(42, offset, true);
    centralChunks.push(new Uint8Array(central.buffer), nameBytes);

    offset += 30 + nameBytes.length + compData.length;
  }

  const centralStart = offset;
  const centralSize = centralChunks.reduce((sum, c) => sum + c.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, centralStart, true);
  eocd.setUint16(20, 0, true);

  return new Blob([...localChunks, ...centralChunks, new Uint8Array(eocd.buffer)]);
}

async function stateToXlsxBlob() {
  cleanMerges();

  const sharedStrings = [];
  const stringIndex = new Map();
  function sharedStringIndex(text) {
    if (stringIndex.has(text)) return stringIndex.get(text);
    const idx = sharedStrings.length;
    sharedStrings.push(text);
    stringIndex.set(text, idx);
    return idx;
  }

  const headerCellsXml = state.columns.map((col, colIdx) => {
    const ref = `${colIndexToLetter(colIdx)}1`;
    return `<c r="${ref}" t="s"><v>${sharedStringIndex(col.name)}</v></c>`;
  }).join('');

  const bodyRowsXml = state.rows.map((row, rowIdx) => {
    const excelRow = rowIdx + 2; // row 1 is the header
    const cellsXml = state.columns.map((col, colIdx) => {
      if (isCoveredCell(col.id, row.id)) return '';
      const text = row.cells[col.id] || '';
      if (!text) return '';
      const ref = `${colIndexToLetter(colIdx)}${excelRow}`;
      return `<c r="${ref}" t="s"><v>${sharedStringIndex(text)}</v></c>`;
    }).join('');
    return `<row r="${excelRow}">${cellsXml}</row>`;
  }).join('');

  const mergeCellsXml = state.merges.map((m) => {
    const colIdx = state.columns.findIndex((c) => c.id === m.colId);
    const anchorRowIdx = state.rows.findIndex((r) => r.id === m.anchorRowId);
    if (colIdx === -1 || anchorRowIdx === -1) return '';
    const colLetter = colIndexToLetter(colIdx);
    const startRow = anchorRowIdx + 2;
    const endRow = startRow + m.coveredRowIds.length;
    return `<mergeCell ref="${colLetter}${startRow}:${colLetter}${endRow}"/>`;
  }).filter(Boolean).join('');

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetData><row r="1">${headerCellsXml}</row>${bodyRowsXml}</sheetData>`
    + (mergeCellsXml ? `<mergeCells count="${state.merges.length}">${mergeCellsXml}</mergeCells>` : '')
    + `</worksheet>`;

  const sstXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">`
    + sharedStrings.map((s) => `<si><t xml:space="preserve">${xmlEscape(s)}</t></si>`).join('')
    + `</sst>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    + `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>`
    + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
    + `</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
    + `</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheets><sheet name="Transcript" sheetId="1" r:id="rId1"/></sheets>`
    + `</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`
    + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`
    + `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + `</Relationships>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>`
    + `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>`
    + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>`
    + `</styleSheet>`;

  const enc = new TextEncoder();
  return buildZip([
    { name: '[Content_Types].xml', data: enc.encode(contentTypesXml) },
    { name: '_rels/.rels', data: enc.encode(rootRelsXml) },
    { name: 'xl/workbook.xml', data: enc.encode(workbookXml) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(workbookRelsXml) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheetXml) },
    { name: 'xl/sharedStrings.xml', data: enc.encode(sstXml) },
    { name: 'xl/styles.xml', data: enc.encode(stylesXml) },
  ]);
}

// Loading a transcript file directly (from the folder list or "Open") just
// replaces the grid — it carries no video reference by itself. `source` is
// a File or a fetch Response — both support .text()/.arrayBuffer().
//
// A ".xlsx" name is ambiguous: it might be a real binary Excel file, or it
// might be our own HTML-based save reusing the filename you originally
// opened (Save Transcript writes to whatever name is already loaded). So
// this sniffs the actual bytes rather than trusting the extension alone —
// real xlsx files are zip archives and always start with "PK".
async function parseTranscriptSource(name, source) {
  if (isXlsxFile(name)) {
    const buf = await source.arrayBuffer();
    const head = new Uint8Array(buf.slice(0, 2));
    const isRealZip = head[0] === 0x50 && head[1] === 0x4b; // "PK"
    if (isRealZip) return xlsxToState(buf);
    // Recovery path: a file saved by an older, buggy version of this app
    // could be plain tab-delimited text wearing an .xlsx name, not a real
    // zip — this lets those old files still open correctly.
    return delimitedToState(new TextDecoder().decode(buf), '\t');
  }
  if (isXlsFile(name)) return xlsToState(await source.text());
  return delimitedToState(await source.text(), delimiterForFile(name));
}

async function applyTranscriptContent(name, source) {
  const loaded = await parseTranscriptSource(name, source);
  state = { columns: loaded.columns, rows: loaded.rows, merges: loaded.merges || [] };
  currentTranscriptFileName = name;
  currentProjectFileName = null;
  activeFilters.clear();
  resetUndoHistory();
  render();
  transcriptStart.hidden = true;
}

async function loadTranscriptFromServer(name) {
  try {
    const res = await fetch(`/transcripts/${encodeURIComponent(name)}`);
    await applyTranscriptContent(name, res);
  } catch (e) {
    alert(`Couldn't open "${name}": ${e.message}`);
  }
}

// Loading a project (.json) — either our new lightweight { videoFileName,
// transcriptFileName } pointer, or an old-style file that still embeds the
// full transcript inline. Either way, also try to auto-load the paired
// video if it's already sitting in the videos folder.
async function applyProjectJson(name, text) {
  const parsed = JSON.parse(text);
  currentProjectFileName = name;

  if (parsed.columns && parsed.rows) {
    // Legacy full project: transcript content was embedded directly.
    state = { columns: parsed.columns, rows: parsed.rows, merges: parsed.merges || [] };
    currentTranscriptFileName = null;
    resetUndoHistory();
  } else if (parsed.transcriptFileName) {
    try {
      const res = await fetch(`/transcripts/${encodeURIComponent(parsed.transcriptFileName)}`);
      if (!res.ok) throw new Error('transcript file not found');
      await applyTranscriptContent(parsed.transcriptFileName, res);
      currentProjectFileName = name; // applyTranscriptContent above clears this; restore it
      // Column type/width/frozen aren't stored in the transcript file itself —
      // match the project's saved values back onto the freshly-loaded columns
      // by name. Anything renamed/added/removed in the transcript since this
      // project was last saved is just skipped, not an error.
      if (Array.isArray(parsed.columns)) {
        parsed.columns.forEach((saved) => {
          const col = state.columns.find((c) => c.name === saved.name);
          if (!col) return;
          col.type = saved.type === 'codes' ? 'codes' : 'text';
          if (saved.width) col.width = saved.width;
          col.frozen = !!saved.frozen;
        });
      }
    } catch (e) {
      alert(`Couldn't load the linked transcript "${parsed.transcriptFileName}". Make sure the app was started via "Start Qualitative Analysis.command" and the file is still in the transcripts folder.`);
      return;
    }
  }
  activeFilters.clear();
  render();
  transcriptStart.hidden = true;

  currentVideoFileName = parsed.videoFileName || null;
  if (!currentVideoFileName) return;
  // Always refresh from the server rather than trusting whatever lastVideoList
  // happened to hold — trusting a possibly-stale/empty list here was exactly
  // the kind of thing that could make this work or fail depending on what
  // you'd done earlier in the session, for no reason a user could see.
  await refreshVideoList();
  if (lastVideoList.includes(currentVideoFileName)) {
    activateVideo(currentVideoFileName, `/videos/${encodeURIComponent(currentVideoFileName)}`);
  } else {
    resetVideoUI(`This project references "${currentVideoFileName}" — load it again to continue.`);
  }
}

document.getElementById('btnDismissTranscriptStart').onclick = () => { transcriptStart.hidden = true; };

// ---- Saving to disk via the local server --------------------------------
async function saveToServer(dir, name, content) {
  const res = await fetch(`/api/save?dir=${dir}&name=${encodeURIComponent(name)}`, {
    method: 'POST',
    body: content,
  });
  if (!res.ok) throw new Error(`save failed (${res.status})`);
  return res.json();
}

let saveStatusTimer = null;
function flashSaveStatus(msg) {
  const el = document.getElementById('saveStatus');
  el.textContent = msg;
  clearTimeout(saveStatusTimer);
  saveStatusTimer = setTimeout(() => { el.textContent = ''; }, 4000);
}

function suggestName(defaultName) {
  const name = prompt('File name:', defaultName);
  return name ? name.trim() : null;
}

async function transcriptFileContent(name) {
  if (isXlsxFile(name)) return stateToXlsxBlob(); // a real .xlsx you opened stays a real .xlsx
  return isXlsFile(name) ? stateToXls() : stateToDelimited(delimiterForFile(name));
}
// Column type/width/frozen only ever lived in memory — the transcript file
// itself is just names + row data. Saving it in the project means it
// survives a reload instead of having to re-mark every codes column, redo
// every resize, and re-freeze every column by hand. Always the CURRENT
// columns, so re-saving keeps it in sync.
function buildProjectPayload() {
  return JSON.stringify({
    videoFileName: currentVideoFileName,
    transcriptFileName: currentTranscriptFileName,
    columns: state.columns.map((c) => ({
      name: c.name,
      type: c.type === 'codes' ? 'codes' : 'text',
      width: c.width || null,
      frozen: !!c.frozen,
    })),
  }, null, 2);
}

document.getElementById('btnSaveTranscript').onclick = async () => {
  let name = currentTranscriptFileName;
  if (!name) {
    name = suggestName('transcript.xls');
    if (!name) return;
    if (!/\.(xlsx|xls|tsv|csv)$/i.test(name)) name += '.xls';
  }
  try {
    await saveToServer('transcripts', name, await transcriptFileContent(name));
    currentTranscriptFileName = name;
    refreshTranscriptList();
    flashSaveStatus(`Saved "${name}" to transcripts folder.`);
    isDirty = false;
    clearTimeout(autosaveTimer);
  } catch (e) {
    alert('Could not save to the transcripts folder. Make sure the app was started via "Start Qualitative Analysis.command".');
  }
};

document.getElementById('btnSaveProject').onclick = async () => {
  if (!currentTranscriptFileName) {
    alert('Save the transcript first — a project just links a saved transcript file with a video.');
    return;
  }
  let name = currentProjectFileName;
  if (!name) {
    name = suggestName('project.json');
    if (!name) return;
    if (!/\.json$/i.test(name)) name += '.json';
  }
  try {
    await saveToServer('projects', name, buildProjectPayload());
    currentProjectFileName = name;
    flashSaveStatus(`Saved "${name}" to projects folder.`);
  } catch (e) {
    alert('Could not save to the projects folder. Make sure the app was started via "Start Qualitative Analysis.command".');
  }
};

// ---- Autosave -------------------------------------------------------------
// Only ever writes to a file that's already been explicitly saved/opened —
// autosave should never invent a filename or prompt. Debounced so a burst
// of typing produces one save, not one per keystroke; the interval is a
// fallback in case the debounce never gets a quiet moment.
const AUTOSAVE_DEBOUNCE_MS = 4000;
const AUTOSAVE_INTERVAL_MS = 60000;
let isDirty = false;
let autosaveTimer = null;

function markDirty() {
  isDirty = true;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(runAutosave, AUTOSAVE_DEBOUNCE_MS);
}

async function runAutosave() {
  if (!isDirty || !currentTranscriptFileName) return;
  try {
    await saveToServer('transcripts', currentTranscriptFileName, await transcriptFileContent(currentTranscriptFileName));
    if (currentProjectFileName) await saveToServer('projects', currentProjectFileName, buildProjectPayload());
    isDirty = false;
    flashSaveStatus(`Autosaved "${currentTranscriptFileName}".`);
  } catch (e) {
    // Leave isDirty true and quietly retry on the next interval tick —
    // autosave failing shouldn't interrupt anyone with an alert.
  }
}
setInterval(runAutosave, AUTOSAVE_INTERVAL_MS);

// Best-effort flush on tab close, and warn if a save might not have landed.
// Real .xlsx content has to be built asynchronously (CompressionStream),
// and beforeunload can't reliably wait for that — so the beacon-based
// flush only covers the synchronous formats; .xlsx just relies on the
// browser's "leave anyway?" prompt giving you a chance to save properly.
window.addEventListener('beforeunload', (e) => {
  if (!isDirty || !currentTranscriptFileName) return;
  if (!isXlsxFile(currentTranscriptFileName)) {
    const content = isXlsFile(currentTranscriptFileName)
      ? stateToXls()
      : stateToDelimited(delimiterForFile(currentTranscriptFileName));
    navigator.sendBeacon(
      `/api/save?dir=transcripts&name=${encodeURIComponent(currentTranscriptFileName)}`,
      new Blob([content])
    );
  }
  e.preventDefault();
  e.returnValue = '';
});

document.getElementById('btnOpenProject').onclick = () => projectInput.click();
document.getElementById('btnOpenProject2').onclick = () => projectInput.click();
projectInput.onchange = async () => {
  const file = projectInput.files[0];
  if (!file) return;
  try {
    if (/\.json$/i.test(file.name)) await applyProjectJson(file.name, await file.text());
    else await applyTranscriptContent(file.name, file); // File supports .text()/.arrayBuffer() directly
  } catch (e) {
    alert(`Couldn't open "${file.name}": ${e.message}`);
  }
};

// ---- Export a standalone copy (browser download, not saved to a folder) --
// Guarded: this button is currently commented out in index.html, and one
// missing element here would otherwise throw and halt every script line
// after it (including Undo/Redo wiring and the initial render below).
const btnExportCopy = document.getElementById('btnExportCopy');
if (btnExportCopy) {
  btnExportCopy.onclick = () => {
    const blob = new Blob([stateToXls()], { type: 'application/vnd.ms-excel' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = currentTranscriptFileName
      ? currentTranscriptFileName.replace(/\.(tsv|csv)$/i, '.xls')
      : 'transcript.xls';
    a.click();
  };
}

document.getElementById('btnUndo').onclick = undo;
document.getElementById('btnRedo').onclick = redo;

// ---- Init -------------------------------------------------------------
state.rows.push(newRow());
updateHeaderHeightVar();
applyVideoWidth();
renderShortcutHints();
render();
refreshVideoList();
refreshTranscriptList();

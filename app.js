(function () {
  'use strict';

  // ======================= Persistence =======================

  const STORAGE_KEY = 'farkleAppState_v1';
  const DEFAULT_COLOR_PRESETS = ['Blue', 'Red', 'Black', 'Green', 'Yellow', 'White'];

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn('Could not read saved state', e);
    }
    return null;
  }

  function defaultState() {
    return {
      rules: Object.assign({}, FarkleEngine.DEFAULT_RULES),
      colors: DEFAULT_COLOR_PRESETS.map((name) => ({ name, profile: null })),
      game: null,
    };
  }

  let state = loadState() || defaultState();
  // Merge in any new default rule keys from a later app version.
  state.rules = Object.assign({}, FarkleEngine.DEFAULT_RULES, state.rules);

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // ======================= Small utilities =======================

  const $ = (id) => document.getElementById(id);

  function hsvToCss(profile) {
    if (!profile) return '#666';
    const h = (profile.hue / 179) * 360;
    const s = profile.lowSat ? Math.min(profile.sat / 255, 0.25) : profile.sat / 255;
    const v = profile.val / 255;
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let [r, g, b] = [0, 0, 0];
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const to255 = (n) => Math.round((n + m) * 255);
    return `rgb(${to255(r)},${to255(g)},${to255(b)})`;
  }

  function findColor(name) {
    return state.colors.find((c) => c.name === name);
  }

  function showView(id) {
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    $(id).classList.remove('hidden');
  }

  // ======================= Camera helpers =======================

  let currentStream = null;

  async function startCamera(videoEl) {
    stopCamera();
    const constraints = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    currentStream = stream;
    videoEl.srcObject = stream;
    await videoEl.play();
  }

  function stopCamera() {
    if (currentStream) {
      currentStream.getTracks().forEach((t) => t.stop());
      currentStream = null;
    }
  }

  // ======================= Home / Scoreboard =======================

  function renderHome() {
    const hasGame = !!state.game && !state.game.gameOver;
    $('home-no-game').classList.toggle('hidden', hasGame || (state.game && state.game.gameOver));
    $('home-game').classList.toggle('hidden', !hasGame);
    $('home-game-over').classList.toggle('hidden', !(state.game && state.game.gameOver));

    if (state.game && state.game.gameOver) {
      $('winner-text').textContent = state.game.winnerName
        ? `🏆 ${state.game.winnerName} wins!`
        : 'Game over!';
      return;
    }
    if (!hasGame) return;

    const g = state.game;
    const board = $('scoreboard');
    board.innerHTML = '';
    g.players.forEach((p, i) => {
      const color = findColor(p.color);
      const row = document.createElement('div');
      row.className = 'player-row' + (i === g.currentPlayerIndex ? ' active' : '');
      row.innerHTML = `
        <span class="color-dot" style="background:${hsvToCss(color && color.profile)}"></span>
        <span class="player-name">${p.name}
          <span class="player-badge">${p.onBoard ? 'on the board' : `needs ${state.rules.minToGetOnBoard}+ to start scoring`}</span>
        </span>
        <span class="player-total">${p.total}</span>
      `;
      board.appendChild(row);
    });

    $('turn-score').textContent = g.turnScore;
    $('dice-remaining').textContent = g.diceRemaining;

    const finalBanner = $('final-round-banner');
    if (g.finalRound) {
      finalBanner.classList.remove('hidden');
      finalBanner.textContent = `Final round! ${g.players[g.finalRound.triggeredByIndex].name} reached ${state.rules.winningScore}. Everyone else gets one more turn.`;
    } else {
      finalBanner.classList.add('hidden');
    }

    const activePlayer = g.players[g.currentPlayerIndex];
    $('btn-roll').textContent = `Roll ${activePlayer.name}'s Dice`;
    const canBank = g.turnScore > 0 && (activePlayer.onBoard || g.turnScore >= state.rules.minToGetOnBoard);
    $('btn-bank').disabled = !canBank;
  }

  function startNewTurn(g) {
    g.turnScore = 0;
    g.diceRemaining = 6;
  }

  function advanceTurn() {
    const g = state.game;
    if (g.finalRound) {
      g.finalRound.turnsLeft -= 1;
      if (g.finalRound.turnsLeft <= 0) {
        endGame();
        return;
      }
    }
    g.currentPlayerIndex = (g.currentPlayerIndex + 1) % g.players.length;
    startNewTurn(g);
  }

  function endGame() {
    const g = state.game;
    let best = g.players[0];
    for (const p of g.players) if (p.total > best.total) best = p;
    g.gameOver = true;
    g.winnerName = best.name;
    save();
  }

  function bankScore() {
    const g = state.game;
    const p = g.players[g.currentPlayerIndex];
    if (g.turnScore <= 0) return;
    if (!p.onBoard && g.turnScore < state.rules.minToGetOnBoard) {
      alert(`${p.name} needs at least ${state.rules.minToGetOnBoard} points in a single turn to get on the board.`);
      return;
    }
    p.total += g.turnScore;
    p.onBoard = true;

    if (p.total >= state.rules.winningScore && !g.finalRound) {
      if (state.rules.finalRoundOnWin) {
        g.finalRound = { triggeredByIndex: g.currentPlayerIndex, turnsLeft: g.players.length - 1 };
        advanceTurn();
      } else {
        endGame();
        return;
      }
    } else {
      advanceTurn();
    }
    save();
    renderHome();
  }

  function declareFarkle() {
    const g = state.game;
    const p = g.players[g.currentPlayerIndex];
    advanceTurn();
    save();
    renderHome();
    showResult({
      headline: `💥 Farkle — ${p.name} loses the turn`,
      breakdown: [],
      total: 0,
      note: 'Turn score reset to 0.',
    });
  }

  // ======================= New game setup =======================

  function renderNewGameSetup() {
    const list = $('color-picker-list');
    list.innerHTML = '';
    state.colors.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'color-pick-row';
      const calibrated = !!c.profile;
      row.innerHTML = `
        <input type="checkbox" data-color="${c.name}" ${calibrated ? '' : 'disabled'} />
        <span class="color-dot" style="background:${hsvToCss(c.profile)}"></span>
        <span>${c.name}</span>
        <span class="status ${calibrated ? 'ok' : ''}">${calibrated ? 'Ready' : 'Needs calibration'}</span>
      `;
      list.appendChild(row);
    });
    updateStartButtonState();
  }

  function updateStartButtonState() {
    const checked = Array.from(document.querySelectorAll('#color-picker-list input:checked'));
    $('btn-start-game').disabled = checked.length < 2;
  }

  function startGame() {
    const checked = Array.from(document.querySelectorAll('#color-picker-list input:checked')).map(
      (el) => el.dataset.color
    );
    if (checked.length < 2) return;
    state.game = {
      players: checked.map((color) => ({ color, name: color, total: 0, onBoard: false })),
      currentPlayerIndex: 0,
      turnScore: 0,
      diceRemaining: 6,
      finalRound: null,
      gameOver: false,
      winnerName: null,
    };
    save();
    showView('view-home');
    renderHome();
  }

  // ======================= Capture / Roll flow =======================

  let captureCtx = {
    activeColor: null,
    diceToRoll: 6,
    detections: [], // { color, value, bbox, manual }
    tab: 'camera',
  };

  function openCapture() {
    const g = state.game;
    const player = g.players[g.currentPlayerIndex];
    captureCtx = { activeColor: player.color, diceToRoll: g.diceRemaining, detections: [], tab: 'camera' };
    $('capture-title').textContent = `Roll ${g.diceRemaining} ${player.name} dice`;
    switchCaptureTab('camera');
    $('camera-live').classList.remove('hidden');
    $('camera-review').classList.add('hidden');
    $('camera-error').classList.add('hidden');
    showView('view-capture');
    startCamera($('video')).catch((err) => {
      console.warn(err);
      $('camera-error').textContent =
        'Could not access the camera (needs HTTPS and camera permission). Use the Manual tab instead.';
      $('camera-error').classList.remove('hidden');
    });
  }

  function closeCapture() {
    stopCamera();
    showView('view-home');
  }

  function switchCaptureTab(tab) {
    captureCtx.tab = tab;
    $('tab-camera-btn').classList.toggle('active', tab === 'camera');
    $('tab-manual-btn').classList.toggle('active', tab === 'manual');
    $('camera-live').classList.toggle('hidden', tab !== 'camera');
    $('camera-review').classList.add('hidden');
    $('manual-entry').classList.toggle('hidden', tab !== 'manual');
    if (tab === 'camera') {
      $('camera-live').classList.remove('hidden');
      startCamera($('video')).catch(() => {});
    } else {
      stopCamera();
      renderManualDice();
    }
  }

  function renderManualDice() {
    const wrap = $('manual-dice');
    wrap.innerHTML = '';
    for (let i = 0; i < captureCtx.diceToRoll; i++) {
      const btn = document.createElement('button');
      btn.className = 'manual-die';
      btn.textContent = '1';
      btn.dataset.value = '1';
      btn.addEventListener('click', () => {
        const v = (parseInt(btn.dataset.value, 10) % 6) + 1;
        btn.dataset.value = String(v);
        btn.textContent = String(v);
      });
      wrap.appendChild(btn);
    }
  }

  function takePhoto() {
    const video = $('video');
    const canvas = $('canvas-still');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    stopCamera();

    $('camera-live').classList.add('hidden');
    $('camera-review').classList.remove('hidden');

    runDetection(canvas);
  }

  function runDetection(canvas) {
    const profiles = state.colors.filter((c) => c.profile).map((c) => c.profile);
    let results = [];
    if (window.cvReady && window.cv && window.cv.Mat) {
      try {
        results = DiceVision.analyzeFrame(window.cv, canvas, profiles);
      } catch (e) {
        console.error('Detection failed', e);
      }
    } else {
      alert('Image recognition is still loading — give it a few seconds and retake, or switch to the Manual tab.');
    }
    captureCtx.detections = results.map((r) => ({ ...r, manual: false }));
    drawOverlay(canvas);
    renderChips();
  }

  function drawOverlay(stillCanvas) {
    const overlay = $('canvas-overlay');
    overlay.width = stillCanvas.width;
    overlay.height = stillCanvas.height;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.lineWidth = Math.max(3, stillCanvas.width * 0.006);
    ctx.font = `${Math.round(stillCanvas.width * 0.035)}px sans-serif`;
    captureCtx.detections.forEach((d) => {
      if (!d.bbox) return;
      const isActive = d.color === captureCtx.activeColor;
      ctx.strokeStyle = isActive ? '#4f8cff' : 'rgba(255,255,255,0.4)';
      ctx.strokeRect(d.bbox.x, d.bbox.y, d.bbox.width, d.bbox.height);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillText(String(d.value), d.bbox.x + 4, d.bbox.y + 20);
    });
  }

  function renderChips() {
    const activeChips = $('detected-chips');
    const ignoredChips = $('ignored-chips');
    activeChips.innerHTML = '';
    ignoredChips.innerHTML = '';

    const active = captureCtx.detections.filter((d) => d.color === captureCtx.activeColor);
    const ignored = captureCtx.detections.filter((d) => d.color !== captureCtx.activeColor);

    active.forEach((d, idx) => activeChips.appendChild(buildChip(d, idx, true)));
    $('ignored-chips-wrap').classList.toggle('hidden', ignored.length === 0);
    ignored.forEach((d) => {
      const chip = document.createElement('div');
      chip.className = 'die-chip ignored';
      chip.innerHTML = `<span class="color-dot" style="background:${hsvToCss(findColor(d.color) && findColor(d.color).profile)}"></span><span class="val">${d.value}</span>`;
      ignoredChips.appendChild(chip);
    });

    $('btn-confirm-camera').disabled = active.length === 0;
  }

  function buildChip(detection) {
    const chip = document.createElement('div');
    chip.className = 'die-chip';
    const color = findColor(detection.color);
    chip.innerHTML = `
      <span class="color-dot" style="background:${hsvToCss(color && color.profile)}"></span>
      <button class="dec">−</button>
      <span class="val">${detection.value}</span>
      <button class="inc">+</button>
      <button class="rm">✕</button>
    `;
    chip.querySelector('.dec').addEventListener('click', () => {
      detection.value = Math.max(1, detection.value - 1);
      renderChips();
      drawOverlay($('canvas-still'));
    });
    chip.querySelector('.inc').addEventListener('click', () => {
      detection.value = Math.min(6, detection.value + 1);
      renderChips();
      drawOverlay($('canvas-still'));
    });
    chip.querySelector('.rm').addEventListener('click', () => {
      const idx = captureCtx.detections.indexOf(detection);
      if (idx >= 0) captureCtx.detections.splice(idx, 1);
      renderChips();
      drawOverlay($('canvas-still'));
    });
    return chip;
  }

  function addMissedDie() {
    captureCtx.detections.push({ color: captureCtx.activeColor, value: 1, bbox: null, manual: true });
    renderChips();
  }

  function confirmCameraRoll() {
    const values = captureCtx.detections.filter((d) => d.color === captureCtx.activeColor).map((d) => d.value);
    finishRoll(values);
  }

  function confirmManualRoll() {
    const values = Array.from(document.querySelectorAll('#manual-dice .manual-die')).map((btn) =>
      parseInt(btn.dataset.value, 10)
    );
    finishRoll(values);
  }

  function finishRoll(values) {
    if (!values.length) return;
    const g = state.game;
    const p = g.players[g.currentPlayerIndex];
    const result = FarkleEngine.scoreRoll(values, state.rules);

    showView('view-home'); // underneath the result overlay; keeps state fresh when they continue

    if (result.farkle) {
      advanceTurn();
      save();
      renderHome();
      showResult({
        headline: `💥 Farkle — ${p.name} loses the turn`,
        breakdown: [],
        total: 0,
        note: `Rolled: ${values.join(', ')}. Turn score reset to 0.`,
      });
      return;
    }

    g.turnScore += result.score;
    if (result.hotDice) {
      g.diceRemaining = 6;
    } else {
      g.diceRemaining = result.leftoverCount;
    }
    save();
    renderHome();

    showResult({
      headline: result.hotDice ? '🔥 Hot dice! Roll all 6 again' : 'Nice roll!',
      breakdown: result.breakdown,
      total: result.score,
      note: result.hotDice
        ? `Turn score so far: ${g.turnScore}. All dice scored — roll again or bank.`
        : `Turn score so far: ${g.turnScore}. ${g.diceRemaining} dice left to roll, or bank now.`,
    });
  }

  function showResult({ headline, breakdown, total, note }) {
    $('result-headline').textContent = headline;
    const bd = $('result-breakdown');
    bd.innerHTML = '';
    breakdown.forEach((b) => {
      const row = document.createElement('div');
      const label = b.face ? `${b.type} (${b.face}s)` : b.type.replace(/-/g, ' ');
      row.innerHTML = `<span>${label}</span><span>${b.points}</span>`;
      bd.appendChild(row);
    });
    $('result-total').textContent = breakdown.length ? `+${total} points` : '+0 points';
    $('result-note').textContent = note;
    showView('view-result');
  }

  function continueFromResult() {
    showView('view-home');
    renderHome();
  }

  // ======================= Calibration =======================

  let calibratingColorName = null;
  let pendingProfile = null;

  function openCalibration(colorName) {
    calibratingColorName = colorName;
    pendingProfile = null;
    $('calibrate-title').textContent = `Calibrate ${colorName}`;
    $('cal-preview').classList.add('hidden');
    $('cal-error').classList.add('hidden');
    showView('view-calibrate');
    startCamera($('video-cal')).catch((err) => {
      console.warn(err);
      $('cal-error').textContent = 'Could not access the camera (needs HTTPS and camera permission).';
      $('cal-error').classList.remove('hidden');
    });
  }

  function sampleColor() {
    const video = $('video-cal');
    const canvas = $('canvas-hidden');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (!(window.cvReady && window.cv && window.cv.Mat)) {
      alert('Still loading the vision library — try again in a second.');
      return;
    }
    const src = window.cv.imread(canvas);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = Math.min(canvas.width, canvas.height) * 0.18;
    pendingProfile = DiceVision.sampleColorProfile(window.cv, src, cx, cy, radius, calibratingColorName);
    src.delete();

    if (!pendingProfile) {
      alert('Could not sample a color there — try again.');
      return;
    }
    $('cal-swatch').style.background = hsvToCss(pendingProfile);
    $('cal-preview').classList.remove('hidden');
  }

  function saveCalibration() {
    const c = findColor(calibratingColorName);
    if (c && pendingProfile) {
      c.profile = pendingProfile;
      save();
    }
    stopCamera();
    showView('view-settings');
    renderSettings();
  }

  function retryCalibration() {
    $('cal-preview').classList.add('hidden');
    startCamera($('video-cal')).catch(() => {});
  }

  // ======================= Settings =======================

  const RULE_FIELDS = [
    { key: 'singleOne', label: 'Single 1', type: 'number', help: 'Points for one lone 1.' },
    { key: 'singleFive', label: 'Single 5', type: 'number', help: 'Points for one lone 5.' },
    { key: 'threeOnesValue', label: 'Three 1s', type: 'number' },
    { key: 'tripleOtherMultiplier', label: 'Triple multiplier', type: 'number', help: 'Three of N (2–6) scores N × this.' },
    { key: 'fourKindMode', label: 'Four/five/six of a kind', type: 'select', options: [['flat', 'Flat values'], ['double', 'Double the triple each extra die']] },
    { key: 'fourKindFlat', label: 'Four of a kind (flat)', type: 'number' },
    { key: 'fiveKindFlat', label: 'Five of a kind (flat)', type: 'number' },
    { key: 'sixKindFlat', label: 'Six of a kind (flat)', type: 'number' },
    { key: 'straightEnabled', label: 'Straight (1-2-3-4-5-6) counts', type: 'checkbox' },
    { key: 'straightValue', label: 'Straight value', type: 'number' },
    { key: 'threePairEnabled', label: 'Three pairs counts', type: 'checkbox' },
    { key: 'threePairValue', label: 'Three pairs value', type: 'number' },
    { key: 'twoTripletsEnabled', label: 'Two triplets counts', type: 'checkbox' },
    { key: 'twoTripletsValue', label: 'Two triplets value', type: 'number' },
    { key: 'minToGetOnBoard', label: 'Minimum to get on the board', type: 'number', help: 'Points needed in one turn before you can bank for the first time.' },
    { key: 'winningScore', label: 'Winning score', type: 'number' },
    { key: 'finalRoundOnWin', label: 'Give everyone a final turn when someone wins', type: 'checkbox' },
  ];

  function renderSettings() {
    renderSettingsColors();
    renderRulesForm();
  }

  function renderSettingsColors() {
    const list = $('settings-colors-list');
    list.innerHTML = '';
    state.colors.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'settings-color-row';
      row.innerHTML = `
        <span class="color-dot" style="background:${hsvToCss(c.profile)}"></span>
        <input type="text" value="${c.name}" data-orig="${c.name}" />
        <button class="mini-btn cal">${c.profile ? 'Recalibrate' : 'Calibrate'}</button>
        <button class="mini-btn danger del">Delete</button>
      `;
      row.querySelector('input').addEventListener('change', (e) => {
        const newName = e.target.value.trim();
        const orig = e.target.dataset.orig;
        if (!newName || newName === orig) {
          e.target.value = orig;
          return;
        }
        renameColor(orig, newName);
      });
      row.querySelector('.cal').addEventListener('click', () => openCalibration(c.name));
      row.querySelector('.del').addEventListener('click', () => deleteColor(c.name));
      list.appendChild(row);
    });
  }

  function renameColor(oldName, newName) {
    const c = findColor(oldName);
    if (!c) return;
    c.name = newName;
    if (state.game) {
      state.game.players.forEach((p) => {
        if (p.color === oldName) {
          p.color = newName;
          if (p.name === oldName) p.name = newName;
        }
      });
    }
    save();
    renderSettingsColors();
  }

  function deleteColor(name) {
    if (state.game && state.game.players.some((p) => p.color === name)) {
      alert('Cannot delete a color that is in the current game. End the game first.');
      return;
    }
    if (!confirm(`Delete the "${name}" color profile?`)) return;
    state.colors = state.colors.filter((c) => c.name !== name);
    save();
    renderSettingsColors();
  }

  function addColor() {
    const name = prompt('Name this dice color (e.g. "Purple", "Teal"):');
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed || findColor(trimmed)) {
      alert('Please enter a unique color name.');
      return;
    }
    state.colors.push({ name: trimmed, profile: null });
    save();
    renderSettingsColors();
  }

  function renderRulesForm() {
    const form = $('rules-form');
    form.innerHTML = '';
    RULE_FIELDS.forEach((f) => {
      const item = document.createElement('div');
      const val = state.rules[f.key];
      if (f.type === 'checkbox') {
        item.className = 'rule-item checkbox';
        item.innerHTML = `<input type="checkbox" id="rule-${f.key}" ${val ? 'checked' : ''}/><label for="rule-${f.key}">${f.label}</label>`;
        item.querySelector('input').addEventListener('change', (e) => {
          state.rules[f.key] = e.target.checked;
          save();
        });
      } else if (f.type === 'select') {
        item.className = 'rule-item';
        const options = f.options.map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('');
        item.innerHTML = `<label>${f.label}</label><select id="rule-${f.key}">${options}</select>`;
        item.querySelector('select').addEventListener('change', (e) => {
          state.rules[f.key] = e.target.value;
          save();
        });
      } else {
        item.className = 'rule-item';
        item.innerHTML = `<label>${f.label}</label><input type="number" id="rule-${f.key}" value="${val}" />${f.help ? `<div class="rule-help">${f.help}</div>` : ''}`;
        item.querySelector('input').addEventListener('change', (e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) {
            state.rules[f.key] = n;
            save();
          }
        });
      }
      form.appendChild(item);
    });
  }

  function resetRules() {
    if (!confirm('Restore default house rules?')) return;
    state.rules = Object.assign({}, FarkleEngine.DEFAULT_RULES);
    save();
    renderRulesForm();
  }

  function eraseAll() {
    if (!confirm('This deletes all colors, calibration, rules, and the current game. Continue?')) return;
    state = defaultState();
    save();
    showView('view-home');
    renderHome();
  }

  // ======================= Wiring =======================

  function init() {
    renderHome();

    $('btn-open-settings').addEventListener('click', () => {
      renderSettings();
      showView('view-settings');
    });
    $('btn-settings-back').addEventListener('click', () => {
      showView('view-home');
      renderHome();
    });

    $('btn-new-game').addEventListener('click', () => {
      renderNewGameSetup();
      showView('view-newgame');
    });
    $('btn-play-again').addEventListener('click', () => {
      state.game = null;
      save();
      renderNewGameSetup();
      showView('view-newgame');
    });
    $('btn-newgame-back').addEventListener('click', () => showView('view-home'));
    $('btn-manage-colors').addEventListener('click', () => {
      renderSettings();
      showView('view-settings');
    });
    $('color-picker-list').addEventListener('change', updateStartButtonState);
    $('btn-start-game').addEventListener('click', startGame);

    $('btn-roll').addEventListener('click', openCapture);
    $('btn-bank').addEventListener('click', bankScore);
    $('btn-farkle').addEventListener('click', () => {
      if (confirm('Declare this roll a Farkle? This ends the turn and loses unbanked points.')) declareFarkle();
    });
    $('btn-end-game').addEventListener('click', () => {
      if (confirm('End the current game?')) {
        state.game = null;
        save();
        renderHome();
      }
    });

    $('btn-capture-close').addEventListener('click', closeCapture);
    $('tab-camera-btn').addEventListener('click', () => switchCaptureTab('camera'));
    $('tab-manual-btn').addEventListener('click', () => switchCaptureTab('manual'));
    $('btn-take-photo').addEventListener('click', takePhoto);
    $('btn-retake').addEventListener('click', () => {
      $('camera-review').classList.add('hidden');
      $('camera-live').classList.remove('hidden');
      startCamera($('video')).catch(() => {});
    });
    $('btn-add-die').addEventListener('click', addMissedDie);
    $('btn-confirm-camera').addEventListener('click', confirmCameraRoll);
    $('btn-confirm-manual').addEventListener('click', confirmManualRoll);

    $('btn-result-continue').addEventListener('click', continueFromResult);

    $('btn-calibrate-close').addEventListener('click', () => {
      stopCamera();
      showView('view-settings');
      renderSettings();
    });
    $('btn-sample-color').addEventListener('click', sampleColor);
    $('btn-cal-retry').addEventListener('click', retryCalibration);
    $('btn-cal-save').addEventListener('click', saveCalibration);

    $('btn-add-color').addEventListener('click', addColor);
    $('btn-reset-rules').addEventListener('click', resetRules);
    $('btn-erase-all').addEventListener('click', eraseAll);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    }
  }

  window.cvReady = false;
  window.__cvScriptLoaded = function () {
    // Standard OpenCV.js readiness hook: the script itself loads quickly,
    // but its WASM runtime finishes initializing a moment later.
    if (window.cv && typeof window.cv.then === 'function') {
      // Some OpenCV.js builds export a Promise instead of a ready-made object.
      window.cv.then((resolved) => {
        window.cv = resolved;
        window.cvReady = true;
      });
    } else if (window.cv) {
      window.cv['onRuntimeInitialized'] = () => {
        window.cvReady = true;
      };
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();

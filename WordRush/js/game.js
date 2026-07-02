import { AudioEngine } from "./audio.js";
import { BGM_TRACKS } from "./audio-tracks.js";
import {
  APP_TITLE,
  DEFAULT_GAME_SETTINGS,
  DEFAULT_PREFERENCES,
  PLAY_COUNTS_STORAGE_KEY,
  PREFERENCES_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  THEME_STORAGE_KEY
} from "./config.js";
import { LEVELS, LEVEL_MAP } from "./levels.js";
import { loadWords } from "./words.js";

const RUN_TIME = 60;
const MAX_LANES = 3;
const STORAGE_PREFIX = "vocab-sprint-best-";
const OLD_THEME_STORAGE_KEY = "vocab-sprint-theme";
const CARD_START_Y = 14;
const FALL_REFERENCE_DISTANCE = 394;
const FALL_SPEED_MULTIPLIER = 0.5;
const STREAK_SPEED_BONUS = 0.95;
const CARD_FADE_IN_TIME = 0.18;
const CARD_FADE_OUT_TIME = 0.24;
const ANSWER_REVEAL_TIME = 1.12;
const LANE_KEY_LAYOUTS = {
  1: [["a", "s", "d"]],
  2: [
    ["a", "s", "d"],
    ["j", "k", "l"]
  ],
  3: [
    ["a", "s", "d"],
    ["f", "g", "h"],
    ["j", "k", "l"]
  ]
};

export class VocabSprintGame {
  constructor() {
    this.canvas = document.getElementById("gameCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.ui = {
      phase: document.getElementById("phaseLabel"),
      level: document.getElementById("levelSelect"),
      levelButton: document.getElementById("levelButton"),
      levelButtonLabel: document.getElementById("levelButtonLabel"),
      levelButtonMeta: document.getElementById("levelButtonMeta"),
      levelPicker: document.getElementById("levelPicker"),
      levelMenu: document.getElementById("levelMenu"),
      laneCount: document.getElementById("laneCountSelect"),
      levelLabel: document.getElementById("levelLabel"),
      soundButton: document.getElementById("soundButton"),
      soundOnIcon: document.querySelector(".sound-on-icon"),
      soundOffIcon: document.querySelector(".sound-off-icon"),
      soundPanel: document.getElementById("soundPanel"),
      bgmEnabled: document.getElementById("bgmEnabledInput"),
      bgmVolume: document.getElementById("bgmVolumeInput"),
      bgmVolumeValue: document.getElementById("bgmVolumeValue"),
      bgmTrack: document.getElementById("bgmTrackSelect"),
      sfxEnabled: document.getElementById("sfxEnabledInput"),
      sfxVolume: document.getElementById("sfxVolumeInput"),
      sfxVolumeValue: document.getElementById("sfxVolumeValue"),
      themeButton: document.getElementById("themeButton"),
      themeLightIcon: document.querySelector(".theme-light-icon"),
      themeDarkIcon: document.querySelector(".theme-dark-icon"),
      pauseButton: document.getElementById("pauseButton"),
      pauseIcon: document.querySelector(".pause-icon"),
      playIcon: document.querySelector(".play-icon"),
      backButton: document.getElementById("backButton"),
      gameShell: document.querySelector(".game-shell"),
      answers: document.getElementById("answers"),
      overlay: document.getElementById("overlay"),
      overlayTitle: document.getElementById("overlayTitle"),
      overlayCopy: document.getElementById("overlayCopy"),
      overlayScroll: document.querySelector(".overlay-scroll"),
      titleDetails: document.getElementById("titleDetails"),
      currentLevel: document.getElementById("currentLevelValue"),
      currentLane: document.getElementById("currentLaneValue"),
      reviewList: document.getElementById("reviewList"),
      startButton: document.getElementById("startButton"),
      overlayBackButton: document.getElementById("overlayBackButton"),
      time: document.getElementById("timeValue"),
      elapsed: document.getElementById("elapsedValue"),
      timeBar: document.getElementById("timeBar"),
      score: document.getElementById("scoreValue"),
      best: document.getElementById("bestValue"),
      streak: document.getElementById("streakValue"),
      correct: document.getElementById("correctValue"),
      wrong: document.getElementById("wrongValue"),
      miss: document.getElementById("missValue"),
      accuracy: document.getElementById("accuracyValue"),
      wordCount: document.getElementById("wordCountValue"),
      feed: document.getElementById("feed")
    };

    const preferences = this.readPreferences();
    const configuredLevelId = LEVEL_MAP.has(DEFAULT_PREFERENCES.levelId) ? DEFAULT_PREFERENCES.levelId : this.ui.level.value;
    const initialLevelId = LEVEL_MAP.has(preferences.levelId) ? preferences.levelId : configuredLevelId;
    const initialLaneCount = this.clampLaneCount(preferences.laneCount);
    this.ui.level.value = initialLevelId;
    this.ui.laneCount.value = String(initialLaneCount);

    this.state = {
      phase: "loading",
      levelId: initialLevelId,
      laneCount: initialLaneCount,
      words: [],
      lanes: [],
      score: 0,
      best: 0,
      streak: 0,
      correct: 0,
      wrong: 0,
      miss: 0,
      timeLeft: RUN_TIME,
      elapsed: 0,
      lastTime: 0,
      feedback: [],
      review: new Map(),
      recent: [],
      effects: [],
      wordBag: [],
      settings: this.readSettings(),
      playCounts: this.readPlayCounts(),
      theme: this.readTheme(),
      levelMenuOpen: false,
      soundPanelOpen: false,
      rngSeed: 1,
      loadError: ""
    };

    this.loadToken = 0;
    this.resizeObserver = null;
    this.audio = new AudioEngine(() => this.state.settings, BGM_TRACKS);
  }

  async init() {
    this.applyTheme(this.state.theme);
    this.state.laneCount = this.clampLaneCount(this.ui.laneCount.value);
    this.state.lastTime = performance.now();
    this.resizeCanvas();
    this.populateBgmTracks();
    this.saveSettings();
    this.syncSettingsInputs();
    this.renderLevelPicker();
    this.renderFeed();
    this.renderAnswerButtons();
    this.updateUi();
    this.drawBoard();
    this.observeCanvasSize();
    this.attachEvents();
    requestAnimationFrame((now) => this.gameLoop(now));
    await this.loadLevel(this.state.levelId);
  }

  activeLevel() {
    return LEVEL_MAP.get(this.state.levelId) || LEVEL_MAP.values().next().value;
  }

  clampLaneCount(value) {
    return Math.max(1, Math.min(MAX_LANES, Number(value) || DEFAULT_PREFERENCES.laneCount));
  }

  activeLaneCount() {
    return this.clampLaneCount(this.state.laneCount);
  }

  clampNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, number));
  }

  clampDecimalSetting(value, fallback, min, max) {
    return Math.round(this.clampNumber(value, fallback, min, max) * 1000) / 1000;
  }

  normalizeSettings(settings = {}) {
    return {
      ...DEFAULT_GAME_SETTINGS,
      correctTimeBonus: this.clampDecimalSetting(DEFAULT_GAME_SETTINGS.correctTimeBonus, 0.1, 0, 20),
      streakTimeMultiplier: this.clampDecimalSetting(DEFAULT_GAME_SETTINGS.streakTimeMultiplier, 0.01, 0, 5),
      wrongTimePenalty: this.clampDecimalSetting(DEFAULT_GAME_SETTINGS.wrongTimePenalty, 0.7, 0, 20),
      bgmEnabled: settings.bgmEnabled !== false,
      sfxEnabled: settings.sfxEnabled !== false,
      bgmVolume: this.clampNumber(settings.bgmVolume, DEFAULT_GAME_SETTINGS.bgmVolume, 0, 1),
      sfxVolume: this.clampNumber(settings.sfxVolume, DEFAULT_GAME_SETTINGS.sfxVolume, 0, 1),
      bgmTrack: settings.bgmTrack || DEFAULT_GAME_SETTINGS.bgmTrack
    };
  }

  readSettings() {
    try {
      return this.normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}"));
    } catch {
      return this.normalizeSettings();
    }
  }

  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
        bgmEnabled: this.state.settings.bgmEnabled,
        sfxEnabled: this.state.settings.sfxEnabled,
        bgmVolume: this.state.settings.bgmVolume,
        sfxVolume: this.state.settings.sfxVolume,
        bgmTrack: this.state.settings.bgmTrack
      }));
    } catch {
      // Ignore storage failures in private or locked-down contexts.
    }
  }

  readPreferences() {
    try {
      const stored = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) || "{}");
      return {
        ...DEFAULT_PREFERENCES,
        ...(stored && typeof stored === "object" ? stored : {})
      };
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }

  savePreferences() {
    try {
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
        levelId: this.state.levelId,
        laneCount: this.activeLaneCount()
      }));
    } catch {
      // Ignore storage failures in private or locked-down contexts.
    }
  }

  readPlayCounts() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PLAY_COUNTS_STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  savePlayCounts() {
    try {
      localStorage.setItem(PLAY_COUNTS_STORAGE_KEY, JSON.stringify(this.state.playCounts));
    } catch {
      // Ignore storage failures in private or locked-down contexts.
    }
  }

  createSeed() {
    let seed = (Date.now() ^ Math.floor(performance.now() * 1000) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    if (globalThis.crypto?.getRandomValues) {
      const values = new Uint32Array(2);
      globalThis.crypto.getRandomValues(values);
      seed = (seed ^ values[0] ^ Math.imul(values[1], 2654435761)) >>> 0;
    }
    return seed || 1;
  }

  nextRandom() {
    this.state.rngSeed = (Math.imul(this.state.rngSeed, 1664525) + 1013904223) >>> 0;
    return this.state.rngSeed / 4294967296;
  }

  randInt(min, max) {
    return Math.floor(this.nextRandom() * (max - min + 1)) + min;
  }

  shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this.randInt(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  bestKey() {
    return `${STORAGE_PREFIX}${this.state.levelId}-lanes-${this.activeLaneCount()}`;
  }

  readBest() {
    try {
      return Number(localStorage.getItem(this.bestKey()) || "0");
    } catch {
      return 0;
    }
  }

  saveBest() {
    this.state.best = Math.max(this.state.best, this.state.score);
    try {
      localStorage.setItem(this.bestKey(), String(this.state.best));
    } catch {
      // Local storage can be unavailable in private or locked-down contexts.
    }
  }

  readTheme() {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem(OLD_THEME_STORAGE_KEY);
      return stored === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  }

  applyTheme(theme) {
    const nextTheme = theme === "light" ? "light" : "dark";
    this.state.theme = nextTheme;
    document.body.dataset.theme = nextTheme;
    const isLight = nextTheme === "light";
    if (this.ui.themeButton) {
      this.ui.themeButton.title = isLight ? "ダークモード" : "ライトモード";
      this.ui.themeButton.setAttribute("aria-label", this.ui.themeButton.title);
    }
    this.ui.themeLightIcon?.classList.toggle("hidden", isLight);
    this.ui.themeDarkIcon?.classList.toggle("hidden", !isLight);
  }

  toggleTheme() {
    const nextTheme = this.state.theme === "light" ? "dark" : "light";
    this.applyTheme(nextTheme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Ignore storage failures in private or locked-down contexts.
    }
    this.drawBoard();
  }

  formatPercent(value) {
    return `${Math.round(this.clampNumber(value, 0, 0, 1) * 100)}%`;
  }

  formatPlayTime(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(total / 60);
    return `${minutes}:${String(total % 60).padStart(2, "0")}`;
  }

  playCountFor(levelId) {
    return Math.max(0, Number(this.state.playCounts[levelId]) || 0);
  }

  incrementPlayCount(levelId) {
    this.state.playCounts[levelId] = this.playCountFor(levelId) + 1;
    this.savePlayCounts();
    this.renderLevelPicker();
  }

  populateBgmTracks() {
    this.ui.bgmTrack.innerHTML = "";

    const random = document.createElement("option");
    random.value = "random";
    random.textContent = "ランダム再生";
    this.ui.bgmTrack.appendChild(random);

    for (const track of BGM_TRACKS) {
      const option = document.createElement("option");
      option.value = track.id;
      option.textContent = track.label;
      this.ui.bgmTrack.appendChild(option);
    }

    if (!BGM_TRACKS.some((track) => track.id === this.state.settings.bgmTrack)) {
      this.state.settings.bgmTrack = "random";
      this.saveSettings();
    }
  }

  syncSettingsInputs() {
    const settings = this.state.settings;
    this.ui.bgmEnabled.checked = settings.bgmEnabled;
    this.ui.sfxEnabled.checked = settings.sfxEnabled;
    this.ui.bgmVolume.value = String(settings.bgmVolume);
    this.ui.sfxVolume.value = String(settings.sfxVolume);
    this.ui.bgmVolumeValue.textContent = this.formatPercent(settings.bgmVolume);
    this.ui.sfxVolumeValue.textContent = this.formatPercent(settings.sfxVolume);
    this.ui.bgmTrack.value = settings.bgmTrack;
  }

  applySettingsFromInputs() {
    const next = this.normalizeSettings({
      ...this.state.settings,
      bgmEnabled: this.ui.bgmEnabled.checked,
      sfxEnabled: this.ui.sfxEnabled.checked,
      bgmVolume: this.ui.bgmVolume.value,
      sfxVolume: this.ui.sfxVolume.value,
      bgmTrack: this.ui.bgmTrack.value
    });
    this.state.settings = next;
    this.syncSettingsInputs();
    this.saveSettings();
    this.audio.applySettings(() => this.state.phase);
    this.updateUi();
  }

  renderLevelPicker() {
    const level = this.activeLevel();
    this.ui.levelButtonLabel.textContent = level.label;
    this.ui.levelButtonMeta.textContent = `${this.playCountFor(level.id)}回`;
    this.ui.levelMenu.innerHTML = "";

    for (const item of LEVELS) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "level-option";
      option.dataset.level = item.id;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", item.id === this.state.levelId ? "true" : "false");
      option.classList.toggle("active", item.id === this.state.levelId);

      const name = document.createElement("span");
      name.className = "level-option-name";
      name.textContent = item.label;

      const count = document.createElement("span");
      count.className = "level-option-count";
      count.textContent = `${this.playCountFor(item.id)}回`;

      option.append(name, count);
      option.addEventListener("click", () => this.selectLevel(item.id));
      this.ui.levelMenu.appendChild(option);
    }
  }

  positionLevelMenu() {
    if (!this.state.levelMenuOpen) {
      return;
    }
    const margin = 8;
    const gap = 7;
    const rect = this.ui.levelButton.getBoundingClientRect();
    const viewportWidth = globalThis.innerWidth || document.documentElement.clientWidth || 390;
    const viewportHeight = globalThis.innerHeight || document.documentElement.clientHeight || 720;
    const width = Math.min(Math.max(rect.width, 260), viewportWidth - margin * 2);
    const left = Math.max(margin, Math.min(rect.left, viewportWidth - width - margin));
    const belowTop = rect.bottom + gap;
    const belowHeight = viewportHeight - belowTop - margin;
    const aboveHeight = rect.top - gap - margin;
    const useAbove = belowHeight < 180 && aboveHeight > belowHeight;
    const maxHeight = Math.max(160, Math.min(430, useAbove ? aboveHeight : belowHeight));
    const top = useAbove ? Math.max(margin, rect.top - gap - maxHeight) : belowTop;

    this.ui.levelMenu.style.setProperty("--level-menu-left", `${left}px`);
    this.ui.levelMenu.style.setProperty("--level-menu-top", `${top}px`);
    this.ui.levelMenu.style.setProperty("--level-menu-width", `${width}px`);
    this.ui.levelMenu.style.setProperty("--level-menu-max-height", `${maxHeight}px`);
  }

  portalLevelMenu() {
    if (this.ui.levelMenu.parentElement !== document.body) {
      document.body.appendChild(this.ui.levelMenu);
    }
  }

  restoreLevelMenu() {
    if (this.ui.levelPicker && this.ui.levelMenu.parentElement !== this.ui.levelPicker) {
      this.ui.levelPicker.appendChild(this.ui.levelMenu);
    }
  }

  setLevelMenuOpen(isOpen) {
    this.state.levelMenuOpen = Boolean(isOpen);
    if (this.state.levelMenuOpen) {
      this.portalLevelMenu();
    }
    this.ui.levelButton.setAttribute("aria-expanded", String(this.state.levelMenuOpen));
    this.ui.levelMenu.classList.toggle("floating", this.state.levelMenuOpen);
    this.ui.levelMenu.classList.toggle("hidden", !this.state.levelMenuOpen);
    if (this.state.levelMenuOpen) {
      this.positionLevelMenu();
      requestAnimationFrame(() => this.positionLevelMenu());
    } else {
      this.restoreLevelMenu();
    }
  }

  toggleLevelMenu() {
    if (this.ui.levelButton.disabled) {
      return;
    }
    this.setSoundPanelOpen(false);
    this.setLevelMenuOpen(!this.state.levelMenuOpen);
  }

  selectLevel(levelId) {
    if (!LEVEL_MAP.has(levelId)) {
      return;
    }
    this.ui.level.value = levelId;
    this.setLevelMenuOpen(false);
    this.state.levelId = levelId;
    this.savePreferences();
    if (this.state.phase === "ready" || this.state.phase === "over" || this.state.phase === "error") {
      this.loadLevel(levelId, { resultMode: this.state.phase === "over" });
    } else {
      this.renderLevelPicker();
      this.updateTitleDetails();
    }
  }

  setSoundPanelOpen(isOpen) {
    this.state.soundPanelOpen = Boolean(isOpen);
    this.ui.soundButton.setAttribute("aria-expanded", String(this.state.soundPanelOpen));
    this.ui.soundPanel.classList.toggle("hidden", !this.state.soundPanelOpen);
  }

  toggleSoundPanel() {
    this.setLevelMenuOpen(false);
    this.setSoundPanelOpen(!this.state.soundPanelOpen);
  }

  updateTitleDetails() {
    const level = this.activeLevel();
    this.ui.currentLevel.textContent = `${level.label}（${this.playCountFor(level.id)}回プレイ）`;
    this.ui.currentLane.textContent = `${this.activeLaneCount()}レーン`;
  }

  cssVar(name, fallback) {
    return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
  }

  async loadLevel(levelId, options = {}) {
    const level = LEVEL_MAP.get(levelId);
    if (!level) {
      return;
    }
    const stayOnResult = Boolean(options.resultMode);

    const token = ++this.loadToken;
    this.audio.stopBgm();
    this.state.phase = "loading";
    this.state.levelId = levelId;
    this.ui.level.value = levelId;
    this.state.words = [];
    this.state.lanes = [];
    this.state.effects = [];
    this.state.loadError = "";
    this.savePreferences();
    this.renderLevelPicker();
    this.showOverlay(stayOnResult ? "Result" : APP_TITLE, "Loading", stayOnResult ? "Restart" : "Start", {
      showTitleDetails: true,
      obscureBoard: !stayOnResult,
      resultMode: stayOnResult,
      titleMode: !stayOnResult
    });
    this.updateUi();
    this.drawBoard();

    try {
      const words = await loadWords(level);
      if (token !== this.loadToken) {
        return;
      }
      this.state.words = words;
      this.state.phase = stayOnResult ? "over" : "ready";
      this.state.best = this.readBest();
      this.state.timeLeft = stayOnResult ? 0 : RUN_TIME;
      this.state.elapsed = 0;
      if (!stayOnResult) {
        this.state.feedback = [];
        this.state.review = new Map();
      }
      this.state.recent = [];
      this.resetWordBag();
      this.makeLanes();
      this.renderFeed();
      if (stayOnResult) {
        this.showResultOverlay();
      } else {
        this.showTitleOverlay();
      }
      this.updateUi();
      this.renderAnswerButtons();
      this.drawBoard();
    } catch (error) {
      if (token !== this.loadToken) {
        return;
      }
      this.state.phase = "error";
      this.state.loadError = error instanceof Error ? error.message : String(error);
      this.showOverlay("読み込みエラー", "ローカルサーバーで開いてください", "Start", { showTitleDetails: false });
      this.updateUi();
      this.renderAnswerButtons();
      this.drawBoard();
    }
  }

  resizeCanvas() {
    const oldSize = this.canvas.width && this.canvas.height ? this.canvasSize() : null;
    const box = this.canvas.getBoundingClientRect();
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    this.canvas.width = Math.max(1, Math.floor(box.width * ratio));
    this.canvas.height = Math.max(1, Math.floor(box.height * ratio));
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const newSize = this.canvasSize();
    if (oldSize && this.state.phase === "playing") {
      this.preserveFallProgress(oldSize, newSize);
    }
  }

  observeCanvasSize() {
    if (!globalThis.ResizeObserver) {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas();
      this.drawBoard();
    });
    this.resizeObserver.observe(this.canvas);
  }

  canvasSize() {
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    return {
      width: this.canvas.width / ratio,
      height: this.canvas.height / ratio
    };
  }

  cardSizeForLane(laneWidth) {
    const lanes = this.activeLaneCount();
    const cardGap = laneWidth < 130 ? 8 : laneWidth < 180 ? 14 : 24;
    const maxCardWidth = lanes === 1 ? 420 : lanes === 2 ? 340 : 282;
    return {
      width: Math.max(58, Math.min(laneWidth - cardGap, maxCardWidth)),
      height: lanes === 1 ? 88 : lanes === 2 ? 78 : laneWidth < 130 ? 76 : 70
    };
  }

  missLineY(size = this.canvasSize()) {
    const laneWidth = size.width / this.activeLaneCount();
    const cardHeight = this.cardSizeForLane(laneWidth).height;
    const bottomInset = Math.max(18, Math.min(46, size.height * 0.08));
    return Math.max(CARD_START_Y + 40, size.height - bottomInset - cardHeight);
  }

  guideLineY(size = this.canvasSize()) {
    const laneWidth = size.width / this.activeLaneCount();
    return this.missLineY(size) + this.cardSizeForLane(laneWidth).height;
  }

  fallDistance(size = this.canvasSize()) {
    return Math.max(1, this.missLineY(size) - CARD_START_Y);
  }

  fallHeightScale(size = this.canvasSize()) {
    return this.fallDistance(size) / FALL_REFERENCE_DISTANCE;
  }

  preserveFallProgress(oldSize, newSize) {
    const oldMiss = this.missLineY(oldSize);
    const newMiss = this.missLineY(newSize);
    for (const lane of this.state.lanes) {
      if (!lane || lane.locked) {
        continue;
      }
      const startY = lane.startY ?? lane.y;
      const oldRange = Math.max(1, oldMiss - startY);
      const progress = Math.max(0, Math.min(1.25, (lane.y - startY) / oldRange));
      lane.y = startY + (newMiss - startY) * progress;
    }
  }

  recentWindowSize() {
    const words = this.state.words.length;
    if (words <= 3) {
      return Math.max(0, words - 1);
    }
    return Math.min(24, Math.max(9, this.activeLaneCount() * 5, Math.floor(words * 0.12)));
  }

  resetWordBag() {
    this.state.wordBag = this.shuffle(this.state.words);
  }

  chooseWord(excludedWords = []) {
    const words = this.state.words;
    if (!words.length) {
      return null;
    }
    if (words.length === 1) {
      return words[0];
    }

    if (!this.state.wordBag.length) {
      this.resetWordBag();
    }

    const blocked = new Set([
      ...this.state.recent,
      ...excludedWords.filter(Boolean)
    ]);
    const deferred = [];
    let candidate = null;
    const tries = Math.max(words.length, this.state.wordBag.length);

    for (let i = 0; i < tries; i += 1) {
      const next = this.state.wordBag.shift();
      if (!next) {
        if (!this.state.wordBag.length) {
          this.resetWordBag();
        }
        continue;
      }
      if (!blocked.has(next.english)) {
        candidate = next;
        break;
      }
      deferred.push(next);
    }

    if (!candidate) {
      candidate = deferred.shift() || this.state.wordBag.shift() || words[this.randInt(0, words.length - 1)];
    }

    this.state.wordBag.push(...deferred);
    this.state.recent.push(candidate.english);
    this.state.recent = this.state.recent.slice(-this.recentWindowSize());
    return candidate;
  }

  makeOptions(correct) {
    const pool = this.state.words
      .filter((entry) => entry.japanese !== correct)
      .map((entry) => entry.japanese);
    const choices = [correct];
    while (choices.length < 3 && pool.length) {
      const pick = pool.splice(this.randInt(0, pool.length - 1), 1)[0];
      if (!choices.includes(pick)) {
        choices.push(pick);
      }
    }
    return this.shuffle(choices);
  }

  spawnLane(index, startAbove) {
    if (!this.state.words.length) {
      return;
    }
    const activeWords = this.state.lanes
      .filter((lane) => lane && lane.index !== index)
      .map((lane) => lane.word?.english)
      .filter(Boolean);
    const word = this.chooseWord(activeWords);
    if (!word) {
      return;
    }
    const options = this.makeOptions(word.japanese);
    const startY = CARD_START_Y + (startAbove ? this.randInt(0, 20) : this.randInt(0, 12));
    this.state.lanes[index] = {
      index,
      word,
      options,
      y: startY,
      startY,
      age: 0,
      fadeOut: 0,
      fadeDuration: 0,
      fadeKind: "",
      shake: 0,
      flash: "",
      flashTime: 0,
      locked: false
    };
  }

  makeLanes() {
    this.state.lanes = [];
    if (!this.state.words.length) {
      return;
    }
    for (let i = 0; i < this.activeLaneCount(); i += 1) {
      this.spawnLane(i, true);
      this.state.lanes[i].y += i * 18;
      this.state.lanes[i].startY = this.state.lanes[i].y;
    }
  }

  addFeed(text) {
    this.state.feedback.unshift(text);
    this.state.feedback = this.state.feedback.slice(0, 8);
    this.renderFeed();
  }

  renderFeed() {
    this.ui.feed.innerHTML = "";
    const lines = this.state.feedback.length ? this.state.feedback : ["Ready"];
    for (const text of lines) {
      const p = document.createElement("p");
      p.textContent = text;
      this.ui.feed.appendChild(p);
    }
  }

  addReview(word, picked, reason) {
    const existing = this.state.review.get(word.english);
    if (existing) {
      existing.count += 1;
      existing.reason = reason;
      existing.lastPicked = picked;
      return;
    }
    this.state.review.set(word.english, {
      english: word.english,
      japanese: word.japanese,
      lastPicked: picked,
      reason,
      count: 1
    });
  }

  showAnswerReveal(laneIndex, lane) {
    const size = this.canvasSize();
    this.state.effects.push({
      type: "reveal",
      lane: laneIndex,
      text: lane.word.japanese,
      y: Math.max(92, Math.min(size.height - 124, lane.y + 32)),
      life: ANSWER_REVEAL_TIME,
      maxLife: ANSWER_REVEAL_TIME,
      color: "#f0ce6c"
    });
  }

  startLaneFade(lane, kind, duration = CARD_FADE_OUT_TIME) {
    lane.fadeKind = kind;
    lane.fadeDuration = duration;
    lane.fadeOut = duration;
  }

  cardMetrics(lane, laneWidth) {
    const laneX = lane.index * laneWidth;
    const { width: cardWidth, height: cardHeight } = this.cardSizeForLane(laneWidth);
    const x = laneX + (laneWidth - cardWidth) / 2 + (lane.shake ? Math.sin(performance.now() / 28) * lane.shake : 0);
    return { x, y: lane.y, width: cardWidth, height: cardHeight };
  }

  addCardParticles(laneIndex, lane, kind) {
    const size = this.canvasSize();
    const laneWidth = size.width / this.activeLaneCount();
    const card = this.cardMetrics(lane, laneWidth);
    const count = kind === "correct" ? 24 : kind === "wrong" ? 20 : 18;
    const colors = kind === "correct"
      ? ["#8fc35d", "#f0ce6c", "#61bfd1"]
      : kind === "wrong"
        ? ["#df6557", "#f0ce6c", "#f1f4ee"]
        : ["#f0ce6c", "#a7b3ad", "#61bfd1"];
    const shapes = kind === "correct"
      ? ["spark", "diamond", "ring", "dot"]
      : kind === "wrong"
        ? ["spark", "shard", "dot", "ring"]
        : ["shard", "ring", "dot"];

    for (let i = 0; i < count; i += 1) {
      const angle = this.nextRandom() * Math.PI * 2;
      const speed = (kind === "correct" ? 42 : 34) + this.nextRandom() * 48;
      const edgeBias = i % 2 === 0 ? -0.42 : 0.42;
      const x = card.x + card.width * (0.5 + edgeBias * this.nextRandom());
      const y = card.y + card.height * (0.25 + this.nextRandom() * 0.55);
      const life = 0.44 + this.nextRandom() * 0.26;
      this.state.effects.push({
        type: "particle",
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (kind === "correct" ? 24 : 4),
        gravity: kind === "miss" ? 28 : 18,
        radius: 2 + this.nextRandom() * 2.8,
        shape: shapes[this.randInt(0, shapes.length - 1)],
        angle: this.nextRandom() * Math.PI * 2,
        spin: (this.nextRandom() - 0.5) * 8,
        color: colors[this.randInt(0, colors.length - 1)],
        life,
        maxLife: life
      });
    }
  }

  renderReviewList() {
    this.ui.reviewList.innerHTML = "";
    if (!this.state.review.size) {
      const empty = document.createElement("div");
      empty.className = "review-title";
      empty.textContent = "復習なし";
      this.ui.reviewList.appendChild(empty);
      return;
    }

    const title = document.createElement("div");
    title.className = "review-title";
    title.textContent = "復習リスト";
    this.ui.reviewList.appendChild(title);

    for (const item of this.state.review.values()) {
      const row = document.createElement("div");
      row.className = "review-item";
      const english = document.createElement("strong");
      english.className = "review-word";
      english.textContent = item.count > 1 ? `${item.english} x${item.count}` : item.english;
      const japanese = document.createElement("span");
      japanese.className = "review-meaning";
      japanese.textContent = item.japanese;
      const links = document.createElement("span");
      links.className = "review-links";
      const encoded = encodeURIComponent(item.english);
      const eijiro = document.createElement("a");
      eijiro.href = `https://eow.alc.co.jp/search?q=${encoded}`;
      eijiro.target = "_blank";
      eijiro.rel = "noopener noreferrer";
      eijiro.textContent = "英辞郎";
      const youglish = document.createElement("a");
      youglish.href = `https://youglish.com/pronounce/${encoded}/english`;
      youglish.target = "_blank";
      youglish.rel = "noopener noreferrer";
      youglish.textContent = "YouGlish";
      links.append(eijiro, youglish);
      row.append(english, japanese, links);
      this.ui.reviewList.appendChild(row);
    }
  }

  modeLabel() {
    return `${this.activeLevel().label} / ${this.activeLaneCount()}レーン`;
  }

  answerTextSizeClass(text) {
    const score = Array.from(text || "").reduce((total, character) => {
      return total + (/^[\x00-\x7F]$/.test(character) ? 0.55 : 1);
    }, 0);
    const lanes = this.activeLaneCount();
    const longAt = lanes === 1 ? 14 : lanes === 2 ? 10 : 7.5;
    const veryLongAt = lanes === 1 ? 20 : lanes === 2 ? 14 : 10.5;
    if (score >= veryLongAt) {
      return "text-very-long";
    }
    if (score >= longAt) {
      return "text-long";
    }
    return "";
  }

  renderAnswerButtons() {
    this.ui.answers.innerHTML = "";
    this.ui.answers.style.setProperty("--lane-count", String(this.activeLaneCount()));
    const laneKeys = this.laneKeys();
    for (let laneIndex = 0; laneIndex < this.activeLaneCount(); laneIndex += 1) {
      const lane = this.state.lanes[laneIndex];
      const panel = document.createElement("section");
      panel.className = "lane-panel";
      panel.setAttribute("aria-label", `Lane ${laneIndex + 1}`);

      const title = document.createElement("div");
      title.className = "lane-title";
      const left = document.createElement("span");
      left.textContent = `Lane ${laneIndex + 1}`;
      const right = document.createElement("span");
      right.textContent = laneKeys[laneIndex].join(" ");
      title.append(left, right);
      panel.appendChild(title);

      for (let optionIndex = 0; optionIndex < 3; optionIndex += 1) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "answer-button";
        button.dataset.lane = String(laneIndex);
        button.dataset.option = String(optionIndex);
        button.disabled = this.state.phase !== "playing" || Boolean(lane?.locked);
        if (lane && lane.flashTime > 0) {
          const isCorrect = lane.options[optionIndex] === lane.word.japanese;
          if (lane.flash === "correct" && isCorrect) {
            button.classList.add("correct");
          } else if (lane.flash === "wrong" && isCorrect) {
            button.classList.add("correct");
          } else if (lane.flash === "wrong" && !isCorrect) {
            button.classList.add("wrong");
          }
        }

        const key = document.createElement("span");
        key.className = "key";
        key.textContent = laneKeys[laneIndex][optionIndex];
        const word = document.createElement("span");
        word.className = "word";
        const optionText = lane ? lane.options[optionIndex] : "";
        const sizeClass = this.answerTextSizeClass(optionText);
        if (sizeClass) {
          word.classList.add(sizeClass);
        }
        word.textContent = optionText;
        button.append(key, word);
        button.addEventListener("click", () => this.answer(laneIndex, optionIndex));
        panel.appendChild(button);
      }
      this.ui.answers.appendChild(panel);
    }
  }

  startGame() {
    if (!this.state.words.length || this.state.phase === "loading" || this.state.phase === "error") {
      return;
    }
    this.audio.init();
    this.state.rngSeed = this.createSeed();
    this.state.phase = "playing";
    this.state.laneCount = this.clampLaneCount(this.ui.laneCount.value);
    this.savePreferences();
    this.incrementPlayCount(this.state.levelId);
    this.state.score = 0;
    this.state.best = this.readBest();
    this.state.streak = 0;
    this.state.correct = 0;
    this.state.wrong = 0;
    this.state.miss = 0;
    this.state.timeLeft = RUN_TIME;
    this.state.elapsed = 0;
    this.state.feedback = [];
    this.state.review = new Map();
    this.state.effects = [];
    this.state.recent = [];
    this.resetWordBag();
    this.state.lastTime = performance.now();
    this.makeLanes();
    this.setLevelMenuOpen(false);
    this.setSoundPanelOpen(false);
    this.hideOverlay();
    this.addFeed(`${this.modeLabel()} / Start`);
    this.audio.playSfx("start");
    this.audio.startBgm(() => this.state.phase, { restart: true });
    this.updateUi();
    this.renderAnswerButtons();
  }

  finishGame() {
    if (this.state.phase === "over") {
      return;
    }
    this.state.phase = "over";
    this.audio.fadeOutBgm(1200);
    this.saveBest();
    this.showResultOverlay({ fadeIn: true });
    this.addFeed(`Finish: ${this.state.score}`);
    this.audio.playSfx("finish");
    this.updateUi();
    this.renderAnswerButtons();
  }

  returnToTitle() {
    this.audio.stopBgm();
    this.state.phase = this.state.words.length ? "ready" : "loading";
    this.state.laneCount = this.clampLaneCount(this.ui.laneCount.value);
    this.state.score = 0;
    this.state.best = this.readBest();
    this.state.streak = 0;
    this.state.correct = 0;
    this.state.wrong = 0;
    this.state.miss = 0;
    this.state.timeLeft = RUN_TIME;
    this.state.elapsed = 0;
    this.state.feedback = [];
    this.state.review = new Map();
    this.state.effects = [];
    this.state.recent = [];
    this.resetWordBag();
    this.state.lastTime = performance.now();
    this.makeLanes();
    this.renderFeed();
    this.setSoundPanelOpen(false);
    this.showTitleOverlay();
    this.updateUi();
    this.renderAnswerButtons();
    this.drawBoard();
  }

  pauseGame() {
    if (this.state.phase === "playing") {
      this.state.phase = "paused";
      this.audio.stopBgm();
      this.showOverlay("Paused", `Score ${this.state.score}`, "Resume", {
        showTitleDetails: true,
        obscureBoard: true,
        pauseMode: true
      });
    } else if (this.state.phase === "paused") {
      this.state.phase = "playing";
      this.state.lastTime = performance.now();
      this.hideOverlay();
      this.audio.startBgm(() => this.state.phase);
    }
    this.updateUi();
    this.renderAnswerButtons();
  }

  speedNow() {
    const level = this.activeLevel();
    const progressionBonus = Math.min(42, this.state.correct * 0.42);
    const streakBonus = Math.min(22, this.state.streak * STREAK_SPEED_BONUS);
    const ramp = level.baseSpeed + this.state.elapsed * level.accel + progressionBonus + streakBonus;
    return ramp * this.fallHeightScale() * FALL_SPEED_MULTIPLIER;
  }

  formatTimeDelta(delta) {
    const sign = delta >= 0 ? "+" : "-";
    const value = Math.abs(delta).toFixed(3).replace(/\.?0+$/, "");
    return `${sign}${value}s`;
  }

  adjustTime(delta) {
    this.state.timeLeft = Math.max(0, this.state.timeLeft + delta);
    if (this.state.phase === "playing" && this.state.timeLeft <= 0) {
      this.finishGame();
      return false;
    }
    return true;
  }

  answer(laneIndex, optionIndex) {
    if (this.state.phase !== "playing") {
      return;
    }
    const lane = this.state.lanes[laneIndex];
    if (!lane || lane.locked) {
      return;
    }

    const picked = lane.options[optionIndex];
    if (picked === lane.word.japanese) {
      lane.locked = true;
      lane.flash = "correct";
      lane.flashTime = 0.18;
      this.state.correct += 1;
      this.state.streak += 1;
      const size = this.canvasSize();
      const bottomBonus = Math.max(0, Math.round((1 - lane.y / (size.height - 92)) * 40));
      const gain = 100 + this.activeLevel().bonus + bottomBonus + Math.min(90, this.state.streak * 3);
      const timeBonus = this.state.settings.correctTimeBonus
        + this.state.streak * this.state.settings.streakTimeMultiplier;
      this.state.score += gain;
      this.adjustTime(timeBonus);
      this.startLaneFade(lane, "correct", CARD_FADE_OUT_TIME);
      this.addCardParticles(laneIndex, lane, "correct");
      this.audio.playSfx("correct");
      this.state.effects.push({ lane: laneIndex, text: `+${gain}`, y: lane.y, life: 0.7, color: "#8fc35d" });
      this.state.effects.push({ lane: laneIndex, text: this.formatTimeDelta(timeBonus), y: lane.y + 24, life: 0.7, color: "#f0ce6c" });
      this.addFeed(`${lane.word.english} = ${lane.word.japanese} / ${this.formatTimeDelta(timeBonus)}`);
      setTimeout(() => {
        if (this.state.phase === "playing") {
          this.spawnLane(laneIndex, true);
          this.renderAnswerButtons();
        }
      }, CARD_FADE_OUT_TIME * 1000);
    } else {
      lane.locked = true;
      this.state.wrong += 1;
      this.state.streak = 0;
      this.state.score = Math.max(0, this.state.score - 20);
      lane.shake = 8;
      lane.flash = "wrong";
      lane.flashTime = 0.22;
      this.addReview(lane.word, picked, "wrong");
      this.showAnswerReveal(laneIndex, lane);
      this.startLaneFade(lane, "wrong", CARD_FADE_OUT_TIME + 0.08);
      this.addCardParticles(laneIndex, lane, "wrong");
      this.audio.playSfx("wrong");
      const penalty = this.state.settings.wrongTimePenalty;
      this.state.effects.push({ lane: laneIndex, text: `-20 ${this.formatTimeDelta(-penalty)}`, y: lane.y, life: 0.55, color: "#df6557" });
      this.addFeed(`${lane.word.english}: 正解は ${lane.word.japanese} / ${this.formatTimeDelta(-penalty)}`);
      this.adjustTime(-penalty);
      setTimeout(() => {
        if (this.state.phase === "playing") {
          this.spawnLane(laneIndex, true);
          this.renderAnswerButtons();
        }
      }, (CARD_FADE_OUT_TIME + 0.08) * 1000);
    }
    this.updateUi();
    this.renderAnswerButtons();
  }

  missLane(laneIndex) {
    const lane = this.state.lanes[laneIndex];
    if (!lane || lane.locked) {
      return;
    }
    lane.locked = true;
    lane.flash = "wrong";
    lane.flashTime = 0.22;
    this.state.miss += 1;
    this.state.streak = 0;
    this.state.score = Math.max(0, this.state.score - 35);
    this.addReview(lane.word, null, "miss");
    this.showAnswerReveal(laneIndex, lane);
    this.startLaneFade(lane, "miss", ANSWER_REVEAL_TIME);
    this.addCardParticles(laneIndex, lane, "miss");
    this.audio.playSfx("miss");
    const penalty = this.state.settings.wrongTimePenalty;
    this.state.effects.push({ lane: laneIndex, text: `MISS ${this.formatTimeDelta(-penalty)}`, y: this.guideLineY(this.canvasSize()) - 16, life: 0.65, color: "#e0b34e" });
    this.addFeed(`${lane.word.english} = ${lane.word.japanese} / ${this.formatTimeDelta(-penalty)}`);
    this.adjustTime(-penalty);
    setTimeout(() => {
      if (this.state.phase === "playing" && this.state.lanes[laneIndex] === lane) {
        this.spawnLane(laneIndex, true);
        this.renderAnswerButtons();
      }
    }, ANSWER_REVEAL_TIME * 1000);
    this.updateUi();
    this.renderAnswerButtons();
  }

  updateGame(dt) {
    if (this.state.phase !== "playing") {
      return;
    }
    this.state.elapsed += dt;
    this.state.timeLeft -= dt;
    if (this.state.timeLeft <= 0) {
      this.state.timeLeft = 0;
      this.finishGame();
      return;
    }

    const size = this.canvasSize();
    const speed = this.speedNow();
    for (let i = 0; i < this.state.lanes.length; i += 1) {
      const lane = this.state.lanes[i];
      lane.age += dt;
      lane.fadeOut = Math.max(0, lane.fadeOut - dt);
      lane.shake = Math.max(0, lane.shake - 38 * dt);
      lane.flashTime = Math.max(0, lane.flashTime - dt);
      if (lane.locked) {
        continue;
      }
      lane.y += speed * dt;
      if (lane.y > this.missLineY(size)) {
        this.missLane(i);
      }
    }

    for (const effect of this.state.effects) {
      effect.life -= dt;
      if (effect.type === "particle") {
        effect.x += effect.vx * dt;
        effect.y += effect.vy * dt;
        effect.vy += (effect.gravity || 0) * dt;
        effect.angle += (effect.spin || 0) * dt;
      } else {
        effect.y -= 26 * dt;
      }
    }
    this.state.effects = this.state.effects.filter((effect) => effect.life > 0);
  }

  drawLaneFlow(x, laneWidth, height, laneIndex, flow, now) {
    this.ctx.save();
    this.ctx.globalCompositeOperation = "source-over";
    this.ctx.fillStyle = flow.shade;
    this.ctx.fillRect(x, 0, laneWidth, height);

    const phase = now * 0.00112 + laneIndex * 0.9;
    const slowPhase = now * 0.00078 + laneIndex * 1.35;
    const verticalDrift = Math.sin(phase * 1.18) * height * 0.24;
    const transparent = "rgba(255, 255, 255, 0)";
    const diagonal = this.ctx.createLinearGradient(
      x + laneWidth * (0.08 + Math.sin(phase) * 0.3),
      -height * 0.34 + verticalDrift,
      x + laneWidth * (1.12 + Math.cos(slowPhase) * 0.32),
      height * 1.28 + Math.cos(phase * 0.8) * height * 0.2
    );
    diagonal.addColorStop(0, transparent);
    diagonal.addColorStop(0.22, flow.coolMid);
    diagonal.addColorStop(0.48, flow.warmMid);
    diagonal.addColorStop(0.72, flow.greenSoft);
    diagonal.addColorStop(1, flow.coolSoft);
    this.ctx.fillStyle = diagonal;
    this.ctx.fillRect(x, 0, laneWidth, height);

    const cross = this.ctx.createLinearGradient(
      x + laneWidth * (0.9 + Math.sin(slowPhase * 0.8) * 0.28),
      height * (1.08 + Math.cos(phase) * 0.12),
      x + laneWidth * (0.1 + Math.cos(slowPhase) * 0.24),
      -height * 0.18
    );
    cross.addColorStop(0, transparent);
    cross.addColorStop(0.34, flow.warmSoft);
    cross.addColorStop(0.58, flow.coolStrong);
    cross.addColorStop(1, flow.coolSoft);
    this.ctx.fillStyle = cross;
    this.ctx.fillRect(x, 0, laneWidth, height);

    for (let blob = 0; blob < 3; blob += 1) {
      const blobPhase = phase + slowPhase * 0.65 + blob * Math.PI * 0.72;
      const cx = x + laneWidth * (0.5 + Math.sin(blobPhase * 1.17) * 0.52);
      const cy = height * (0.5 + Math.cos(blobPhase * 0.93) * 0.5);
      const radius = Math.max(laneWidth * (1.1 + blob * 0.2), height * (0.42 + blob * 0.08));
      const glow = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      glow.addColorStop(0, blob % 2 ? flow.warmMid : flow.coolStrong);
      glow.addColorStop(0.42, blob % 2 ? flow.greenSoft : flow.coolMid);
      glow.addColorStop(1, transparent);
      this.ctx.fillStyle = glow;
      this.ctx.fillRect(x, 0, laneWidth, height);
    }

    const veil = this.ctx.createLinearGradient(x, 0, x, height);
    veil.addColorStop(0, flow.finish);
    veil.addColorStop(0.52, transparent);
    veil.addColorStop(1, flow.finish);
    this.ctx.fillStyle = veil;
    this.ctx.fillRect(x, 0, laneWidth, height);

    this.ctx.restore();
  }

  drawBoard() {
    const size = this.canvasSize();
    const canvasBg = this.cssVar("--canvas-bg", "#0c1113");
    const laneBgA = this.cssVar("--lane-bg-a", "#101719");
    const laneBgB = this.cssVar("--lane-bg-b", "#151d20");
    const laneLine = this.cssVar("--lane-line", "rgba(97, 191, 209, 0.22)");
    const missLine = this.cssVar("--miss-line", "rgba(224, 179, 78, 0.16)");
    const boardLabel = this.cssVar("--board-label", "rgba(241, 244, 238, 0.16)");
    const edgeLine = this.cssVar("--edge-line", "rgba(97, 191, 209, 0.28)");
    const flow = {
      coolSoft: this.cssVar("--lane-flow-cool-soft", "rgba(97, 191, 209, 0.05)"),
      coolMid: this.cssVar("--lane-flow-cool-mid", "rgba(97, 191, 209, 0.1)"),
      coolStrong: this.cssVar("--lane-flow-cool-strong", "rgba(97, 191, 209, 0.14)"),
      warmSoft: this.cssVar("--lane-flow-warm-soft", "rgba(240, 206, 108, 0.04)"),
      warmMid: this.cssVar("--lane-flow-warm-mid", "rgba(240, 206, 108, 0.075)"),
      greenSoft: this.cssVar("--lane-flow-green-soft", "rgba(143, 195, 93, 0.075)"),
      shade: this.cssVar("--lane-flow-shade", "rgba(0, 0, 0, 0.22)"),
      finish: this.cssVar("--lane-flow-finish", "rgba(0, 0, 0, 0.1)")
    };
    this.ctx.clearRect(0, 0, size.width, size.height);
    this.ctx.fillStyle = canvasBg;
    this.ctx.fillRect(0, 0, size.width, size.height);

    const lanes = this.activeLaneCount();
    const laneWidth = size.width / lanes;
    const now = performance.now();
    for (let i = 0; i < lanes; i += 1) {
      const x = i * laneWidth;
      this.ctx.fillStyle = i % 2 === 0 ? laneBgA : laneBgB;
      this.ctx.fillRect(x, 0, laneWidth, size.height);
      this.drawLaneFlow(x, laneWidth, size.height, i, flow, now);

      this.ctx.strokeStyle = laneLine;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, size.height);
      this.ctx.stroke();

      const guideThickness = laneWidth < 140 ? 3 : 4;
      this.ctx.fillStyle = missLine;
      this.ctx.fillRect(x + 12, this.guideLineY(size) - guideThickness / 2, laneWidth - 24, guideThickness);

      this.ctx.fillStyle = boardLabel;
      this.ctx.font = "800 12px system-ui, sans-serif";
      this.ctx.textAlign = "left";
      this.ctx.fillText(`LANE ${i + 1}`, x + 16, 24);
    }

    this.ctx.strokeStyle = edgeLine;
    this.ctx.beginPath();
    this.ctx.moveTo(size.width - 1, 0);
    this.ctx.lineTo(size.width - 1, size.height);
    this.ctx.stroke();

    this.drawWords(laneWidth);
    this.drawEffects(laneWidth);
  }

  setCanvasFont(size) {
    this.ctx.font = `950 ${size}px system-ui, sans-serif`;
  }

  measuredWidth(text) {
    return this.ctx.measureText(text).width;
  }

  truncateCanvasText(text, maxWidth) {
    const marker = "...";
    if (this.measuredWidth(text) <= maxWidth) {
      return text;
    }
    let trimmed = "";
    for (const char of Array.from(text)) {
      const next = trimmed + char;
      if (this.measuredWidth(next + marker) > maxWidth) {
        break;
      }
      trimmed = next;
    }
    return trimmed ? trimmed + marker : marker;
  }

  wrapContinuousText(text, maxWidth, maxLines) {
    const lines = [];
    let current = "";
    for (const char of Array.from(text)) {
      const candidate = current + char;
      if (current && this.measuredWidth(candidate) > maxWidth) {
        lines.push(current.trim());
        current = char.trimStart();
        if (lines.length >= maxLines) {
          return null;
        }
      } else {
        current = candidate;
      }
    }
    if (current.trim()) {
      lines.push(current.trim());
    }
    return lines.length <= maxLines ? lines : null;
  }

  wrapCanvasText(text, maxWidth, maxLines) {
    const clean = String(text).trim().replace(/\s+/g, " ");
    if (!clean) {
      return [""];
    }

    const words = clean.split(" ");
    if (words.length === 1) {
      return this.wrapContinuousText(clean, maxWidth, maxLines);
    }

    const lines = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (this.measuredWidth(candidate) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
        current = "";
        if (lines.length >= maxLines) {
          return null;
        }
      }

      if (this.measuredWidth(word) <= maxWidth) {
        current = word;
        continue;
      }

      const chunks = this.wrapContinuousText(word, maxWidth, maxLines - lines.length);
      if (!chunks) {
        return null;
      }
      for (let i = 0; i < chunks.length - 1; i += 1) {
        lines.push(chunks[i]);
        if (lines.length >= maxLines) {
          return null;
        }
      }
      current = chunks[chunks.length - 1] || "";
    }

    if (current) {
      lines.push(current);
    }
    return lines.length <= maxLines ? lines : null;
  }

  layoutCanvasText(text, maxWidth, maxHeight, baseSize, maxLines, minSize = 11) {
    const roundedBase = Math.round(baseSize);
    for (let size = roundedBase; size >= minSize; size -= 1) {
      this.setCanvasFont(size);
      const lineHeight = Math.max(12, Math.round(size * 1.06));
      const lines = this.wrapCanvasText(text, maxWidth, maxLines);
      if (!lines) {
        continue;
      }
      const totalHeight = lineHeight * lines.length;
      const fitsWidth = lines.every((line) => this.measuredWidth(line) <= maxWidth + 0.5);
      if (fitsWidth && totalHeight <= maxHeight) {
        return { size, lineHeight, lines };
      }
    }

    this.setCanvasFont(minSize);
    const fallback = this.wrapCanvasText(text, maxWidth, maxLines)
      || this.wrapContinuousText(String(text).trim().replace(/\s+/g, " "), maxWidth, maxLines)
      || [String(text)];
    return {
      size: minSize,
      lineHeight: Math.max(12, Math.round(minSize * 1.06)),
      lines: fallback.slice(0, maxLines).map((line) => this.truncateCanvasText(line, maxWidth))
    };
  }

  roundRect(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    this.ctx.beginPath();
    this.ctx.moveTo(x + r, y);
    this.ctx.lineTo(x + width - r, y);
    this.ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    this.ctx.lineTo(x + width, y + height - r);
    this.ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    this.ctx.lineTo(x + r, y + height);
    this.ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    this.ctx.lineTo(x, y + r);
    this.ctx.quadraticCurveTo(x, y, x + r, y);
    this.ctx.closePath();
  }

  drawWords(laneWidth) {
    const cardBg = this.cssVar("--card-bg", "rgba(6, 10, 11, 0.58)");
    const cardText = this.cssVar("--card-text", "#f1f4ee");
    const cyan = this.cssVar("--cyan", "#61bfd1");
    const green = this.cssVar("--green", "#8fc35d");
    for (const lane of this.state.lanes) {
      if (!lane) {
        continue;
      }
      const lanes = this.activeLaneCount();
      const card = this.cardMetrics(lane, laneWidth);
      const fadeInAlpha = Math.max(0, Math.min(1, lane.age / CARD_FADE_IN_TIME));
      const fadeOutAlpha = lane.fadeDuration ? Math.max(0, Math.min(1, lane.fadeOut / lane.fadeDuration)) : 1;
      const alpha = fadeInAlpha * fadeOutAlpha;
      if (alpha <= 0.01) {
        continue;
      }
      const x = card.x;
      const y = card.y + (lane.fadeKind ? (1 - fadeOutAlpha) * -4 : (1 - fadeInAlpha) * -6);
      const cardWidth = card.width;
      const cardHeight = card.height;
      const pulse = lane.flash === "correct" && lane.flashTime > 0 ? 1 : 0;
      const glow = pulse ? "rgba(143, 195, 93, 0.52)" : "rgba(97, 191, 209, 0.22)";

      this.ctx.save();
      this.ctx.globalAlpha = alpha;
      this.ctx.shadowColor = glow;
      this.ctx.shadowBlur = 18;
      this.roundRect(x, y, cardWidth, cardHeight, 8);
      this.ctx.fillStyle = cardBg;
      this.ctx.fill();
      this.ctx.shadowBlur = 0;
      this.ctx.strokeStyle = pulse ? green : cyan;
      this.ctx.lineWidth = 2;
      this.ctx.stroke();

      const textMaxWidth = cardWidth - (laneWidth < 130 ? 12 : 24);
      const maxLines = cardWidth < 118 ? 3 : 2;
      const maxFont = lanes === 1 ? 46 : lanes === 2 ? 40 : 35;
      const minBaseFont = lanes === 1 ? 30 : lanes === 2 ? 27 : 24;
      const baseFont = Math.max(minBaseFont, Math.min(maxFont, cardWidth * 0.34));
      const minFont = lanes === 1 ? 18 : lanes === 2 ? 16 : 14;
      const textLayout = this.layoutCanvasText(lane.word.english, textMaxWidth, cardHeight - 18, baseFont, maxLines, minFont);
      this.ctx.fillStyle = cardText;
      this.setCanvasFont(textLayout.size);
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      const textTop = y + cardHeight / 2 - (textLayout.lineHeight * textLayout.lines.length) / 2;
      for (let i = 0; i < textLayout.lines.length; i += 1) {
        this.ctx.fillText(textLayout.lines[i], x + cardWidth / 2, textTop + textLayout.lineHeight * (i + 0.5) + 1);
      }
      this.ctx.restore();
    }
  }

  drawEffects(laneWidth) {
    const revealBg = this.cssVar("--reveal-bg", "rgba(18, 25, 27, 0.95)");
    const gold = this.cssVar("--gold", "#f0ce6c");
    for (const effect of this.state.effects) {
      const alpha = Math.max(0, Math.min(1, effect.life / (effect.maxLife || 0.7)));
      this.ctx.save();
      this.ctx.globalAlpha = alpha;
      if (effect.type === "particle") {
        const radius = effect.radius || 3;
        this.ctx.translate(effect.x, effect.y);
        this.ctx.rotate(effect.angle || 0);
        this.ctx.fillStyle = effect.color;
        this.ctx.strokeStyle = effect.color;
        this.ctx.shadowColor = effect.color;
        this.ctx.shadowBlur = effect.shape === "spark" ? 12 : 8;
        if (effect.shape === "spark") {
          this.ctx.lineWidth = Math.max(1.1, radius * 0.48);
          this.ctx.beginPath();
          this.ctx.moveTo(-radius * 2.4, 0);
          this.ctx.lineTo(radius * 2.4, 0);
          this.ctx.moveTo(0, -radius * 1.25);
          this.ctx.lineTo(0, radius * 1.25);
          this.ctx.stroke();
        } else if (effect.shape === "diamond" || effect.shape === "shard") {
          const stretch = effect.shape === "shard" ? 2.2 : 1.35;
          this.ctx.beginPath();
          this.ctx.moveTo(0, -radius * stretch);
          this.ctx.lineTo(radius * 0.95, 0);
          this.ctx.lineTo(0, radius * stretch);
          this.ctx.lineTo(-radius * 0.95, 0);
          this.ctx.closePath();
          this.ctx.fill();
        } else if (effect.shape === "ring") {
          this.ctx.lineWidth = Math.max(1, radius * 0.42);
          this.ctx.beginPath();
          this.ctx.arc(0, 0, radius * 1.7, 0, Math.PI * 2);
          this.ctx.stroke();
        } else {
          this.ctx.beginPath();
          this.ctx.arc(0, 0, radius, 0, Math.PI * 2);
          this.ctx.fill();
        }
      } else if (effect.type === "reveal") {
        const laneCenter = effect.lane * laneWidth + laneWidth / 2;
        const progress = 1 - alpha;
        const scale = 0.88 + Math.sin(Math.min(1, progress * 1.2) * Math.PI) * 0.38;
        const lanes = this.activeLaneCount();
        const cardWidth = Math.min(laneWidth - 14, lanes === 1 ? 460 : lanes === 2 ? 390 : 340) * scale;
        const cardHeight = (lanes === 1 ? 112 : lanes === 2 ? 100 : 92) * scale;
        const x = laneCenter - cardWidth / 2;
        const y = effect.y - cardHeight / 2;

        this.ctx.shadowColor = "rgba(240, 206, 108, 0.58)";
        this.ctx.shadowBlur = 22;
        this.roundRect(x, y, cardWidth, cardHeight, 8);
        this.ctx.fillStyle = revealBg;
        this.ctx.fill();
        this.ctx.shadowBlur = 0;
        this.ctx.strokeStyle = effect.color;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        this.ctx.fillStyle = gold;
        const maxLines = cardWidth < 150 ? 3 : 2;
        const textLayout = this.layoutCanvasText(effect.text, cardWidth - 20, cardHeight - 18, Math.round(44 * scale), maxLines, 12);
        this.setCanvasFont(textLayout.size);
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        const textTop = effect.y - (textLayout.lineHeight * textLayout.lines.length) / 2;
        for (let i = 0; i < textLayout.lines.length; i += 1) {
          this.ctx.fillText(textLayout.lines[i], laneCenter, textTop + textLayout.lineHeight * (i + 0.5) + 1);
        }
      } else {
        const laneCenter = effect.lane * laneWidth + laneWidth / 2;
        this.ctx.fillStyle = effect.color;
        this.ctx.font = "950 22px system-ui, sans-serif";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        this.ctx.fillText(effect.text, laneCenter, effect.y);
      }
      this.ctx.restore();
    }
  }

  showTitleOverlay() {
    this.updateTitleDetails();
    this.syncSettingsInputs();
    this.showOverlay(APP_TITLE, "", "Start", {
      showTitleDetails: true,
      showBack: false,
      obscureBoard: true,
      titleMode: true
    });
  }

  showResultOverlay(options = {}) {
    this.updateTitleDetails();
    this.syncSettingsInputs();
    this.showOverlay("Result", `Score ${this.state.score} / Best ${this.state.best}`, "Restart", {
      showBack: false,
      showTitleDetails: true,
      resultMode: true,
      fadeIn: Boolean(options.fadeIn)
    });
    this.renderReviewList();
  }

  showOverlay(title, copy, buttonText, options = {}) {
    this.ui.overlayTitle.textContent = title;
    this.ui.overlayCopy.textContent = copy;
    this.ui.reviewList.innerHTML = "";
    this.ui.startButton.textContent = buttonText;
    this.ui.titleDetails.classList.toggle("hidden", !options.showTitleDetails);
    this.ui.overlayBackButton.classList.toggle("hidden", !options.showBack);
    this.ui.gameShell.classList.toggle("is-obscured", Boolean(options.obscureBoard));
    this.ui.overlay.classList.toggle("result-mode", Boolean(options.resultMode));
    this.ui.overlay.classList.toggle("title-mode", Boolean(options.titleMode));
    this.ui.overlay.classList.toggle("pause-mode", Boolean(options.pauseMode));
    this.ui.overlay.classList.remove("fade-in");
    if (options.fadeIn) {
      this.ui.overlay.offsetHeight;
      this.ui.overlay.classList.add("fade-in");
    }
    this.ui.overlay.classList.add("show");
  }

  hideOverlay() {
    this.ui.overlay.classList.remove("show");
    this.ui.overlay.classList.remove("fade-in", "result-mode", "title-mode", "pause-mode");
    this.ui.gameShell.classList.remove("is-obscured");
  }

  accuracy() {
    const total = this.state.correct + this.state.wrong + this.state.miss;
    return total ? Math.round((this.state.correct / total) * 100) : 0;
  }

  updateUi() {
    const level = this.activeLevel();
    const isBusy = this.state.phase === "loading";
    const isError = this.state.phase === "error";
    document.body.dataset.lanes = String(this.activeLaneCount());
    this.ui.answers.style.setProperty("--lane-count", String(this.activeLaneCount()));
    this.ui.phase.textContent = this.state.phase === "playing"
      ? "Running"
      : this.state.phase === "paused"
        ? "Paused"
        : this.state.phase === "over"
          ? "Done"
          : isBusy
            ? "Loading"
            : isError
              ? "Error"
              : "Ready";
    this.ui.levelLabel.textContent = `${level.label} / ${this.activeLaneCount()}L`;
    this.ui.laneCount.value = String(this.activeLaneCount());
    this.ui.time.textContent = String(Math.ceil(Math.max(0, this.state.timeLeft))).padStart(2, "0");
    this.ui.elapsed.textContent = this.formatPlayTime(this.state.elapsed);
    this.ui.timeBar.style.width = `${Math.max(0, Math.min(100, (this.state.timeLeft / RUN_TIME) * 100))}%`;
    this.ui.score.textContent = String(this.state.score);
    this.ui.best.textContent = String(Math.max(this.state.best, this.state.score));
    this.ui.streak.textContent = String(this.state.streak);
    this.ui.correct.textContent = String(this.state.correct);
    this.ui.wrong.textContent = String(this.state.wrong);
    this.ui.miss.textContent = String(this.state.miss);
    this.ui.accuracy.textContent = `${this.accuracy()}%`;
    this.ui.wordCount.textContent = String(this.state.words.length);

    const canPause = this.state.phase === "playing" || this.state.phase === "paused";
    this.ui.pauseButton.disabled = !canPause;
    this.ui.pauseButton.title = this.state.phase === "paused" ? "再開" : "一時停止";
    this.ui.pauseButton.setAttribute("aria-label", this.ui.pauseButton.title);
    this.ui.pauseIcon.classList.toggle("hidden", this.state.phase === "paused");
    this.ui.playIcon.classList.toggle("hidden", this.state.phase !== "paused");
    const audioOn = this.state.settings.bgmEnabled || this.state.settings.sfxEnabled;
    this.ui.soundButton.title = "音設定";
    this.ui.soundButton.setAttribute("aria-label", this.ui.soundButton.title);
    this.ui.soundOnIcon.classList.toggle("hidden", !audioOn);
    this.ui.soundOffIcon.classList.toggle("hidden", audioOn);
    this.ui.themeLightIcon?.classList.toggle("hidden", this.state.theme === "light");
    this.ui.themeDarkIcon?.classList.toggle("hidden", this.state.theme !== "light");
    this.ui.level.disabled = this.state.phase === "playing" || this.state.phase === "paused" || isBusy;
    this.ui.levelButton.disabled = this.ui.level.disabled;
    this.ui.laneCount.disabled = this.state.phase === "playing" || this.state.phase === "paused" || isBusy;
    this.ui.backButton.disabled = isBusy;
    this.ui.startButton.disabled = isBusy || isError || !this.state.words.length;
    this.updateTitleDetails();
  }

  gameLoop(now) {
    const dt = Math.min(0.08, (now - this.state.lastTime) / 1000 || 0);
    this.state.lastTime = now;
    this.updateGame(dt);
    this.drawBoard();
    this.updateUi();
    requestAnimationFrame((time) => this.gameLoop(time));
  }

  laneKeys() {
    return LANE_KEY_LAYOUTS[this.activeLaneCount()] || LANE_KEY_LAYOUTS[MAX_LANES];
  }

  keyToLane(key) {
    const laneKeys = this.laneKeys();
    for (let lane = 0; lane < this.activeLaneCount(); lane += 1) {
      const option = laneKeys[lane].indexOf(key);
      if (option >= 0) {
        return { lane, option };
      }
    }
    return null;
  }

  isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return target.isContentEditable
      || target.matches("input, select, textarea");
  }

  attachEvents() {
    this.ui.startButton.addEventListener("click", () => {
      if (this.state.phase === "paused") {
        this.pauseGame();
      } else {
        this.startGame();
      }
    });
    this.ui.overlayBackButton.addEventListener("click", () => this.returnToTitle());
    this.ui.backButton.addEventListener("click", () => this.returnToTitle());
    this.ui.levelButton.addEventListener("click", () => this.toggleLevelMenu());
    this.ui.soundButton.addEventListener("click", () => this.toggleSoundPanel());
    this.ui.themeButton?.addEventListener("click", () => this.toggleTheme());
    this.ui.pauseButton.addEventListener("click", () => this.pauseGame());
    for (const input of [this.ui.bgmEnabled, this.ui.bgmVolume, this.ui.bgmTrack, this.ui.sfxEnabled, this.ui.sfxVolume]) {
      input.addEventListener("input", () => this.applySettingsFromInputs());
      input.addEventListener("change", () => this.applySettingsFromInputs());
    }
    this.ui.level.addEventListener("change", () => {
      if (this.state.phase === "ready" || this.state.phase === "over" || this.state.phase === "error") {
        this.loadLevel(this.ui.level.value, { resultMode: this.state.phase === "over" });
      }
    });
    this.ui.laneCount.addEventListener("change", () => {
      if (this.state.phase === "ready" || this.state.phase === "over") {
        const stayOnResult = this.state.phase === "over";
        this.state.laneCount = this.clampLaneCount(this.ui.laneCount.value);
        this.savePreferences();
        this.state.best = this.readBest();
        this.state.effects = [];
        this.makeLanes();
        this.updateUi();
        this.renderAnswerButtons();
        this.drawBoard();
        if (stayOnResult) {
          this.showResultOverlay();
        } else {
          this.showTitleOverlay();
        }
      }
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".level-picker") && !event.target.closest("#levelMenu")) {
        this.setLevelMenuOpen(false);
      }
      if (!event.target.closest(".sound-control")) {
        this.setSoundPanelOpen(false);
      }
    });
    window.addEventListener("resize", () => {
      this.resizeCanvas();
      this.positionLevelMenu();
      this.drawBoard();
    });
    this.ui.overlayScroll.addEventListener("scroll", () => this.positionLevelMenu());
    window.addEventListener("keydown", (event) => {
      const key = event.key.toLowerCase();
      if (key === "escape" && (this.state.levelMenuOpen || this.state.soundPanelOpen)) {
        event.preventDefault();
        this.setLevelMenuOpen(false);
        this.setSoundPanelOpen(false);
        return;
      }
      if (this.isTypingTarget(event.target)) {
        return;
      }
      const mapped = this.keyToLane(key);
      if (mapped) {
        event.preventDefault();
        this.answer(mapped.lane, mapped.option);
        return;
      }
      if ((key === "enter" || key === " ") && (this.state.phase === "ready" || this.state.phase === "over")) {
        event.preventDefault();
        this.startGame();
        return;
      }
      if (key === "p" || key === "escape") {
        event.preventDefault();
        this.pauseGame();
      }
    });
  }
}

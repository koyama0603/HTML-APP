import { AudioEngine } from "./audio.js";
import { LEVEL_MAP } from "./levels.js";
import { loadWords } from "./words.js";

const RUN_TIME = 60;
const MAX_LANES = 3;
const DEFAULT_LANES = 3;
const STORAGE_PREFIX = "vocab-sprint-best-";
const THEME_STORAGE_KEY = "vocab-sprint-theme";
const MISS_LINE_OFFSET = 98;
const FALL_REFERENCE_DISTANCE = 394;
const FALL_SPEED_MULTIPLIER = 0.5;
const STREAK_SPEED_BONUS = 0.95;
const CORRECT_TIME_BONUS = 2;
const STREAK_TIME_BONUS = 0.1;
const WRONG_TIME_PENALTY = 1;
const ANSWER_REVEAL_TIME = 1.12;
const LANE_KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"]
];

export class VocabSprintGame {
  constructor() {
    this.canvas = document.getElementById("gameCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.ui = {
      phase: document.getElementById("phaseLabel"),
      level: document.getElementById("levelSelect"),
      laneCount: document.getElementById("laneCountSelect"),
      levelLabel: document.getElementById("levelLabel"),
      soundButton: document.getElementById("soundButton"),
      soundOnIcon: document.querySelector(".sound-on-icon"),
      soundOffIcon: document.querySelector(".sound-off-icon"),
      themeButton: document.getElementById("themeButton"),
      themeLightIcon: document.querySelector(".theme-light-icon"),
      themeDarkIcon: document.querySelector(".theme-dark-icon"),
      pauseButton: document.getElementById("pauseButton"),
      pauseIcon: document.querySelector(".pause-icon"),
      playIcon: document.querySelector(".play-icon"),
      restartButton: document.getElementById("restartButton"),
      answers: document.getElementById("answers"),
      overlay: document.getElementById("overlay"),
      overlayTitle: document.getElementById("overlayTitle"),
      overlayCopy: document.getElementById("overlayCopy"),
      reviewList: document.getElementById("reviewList"),
      startButton: document.getElementById("startButton"),
      time: document.getElementById("timeValue"),
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

    this.state = {
      phase: "loading",
      levelId: this.ui.level.value,
      laneCount: DEFAULT_LANES,
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
      audioEnabled: true,
      theme: this.readTheme(),
      rngSeed: 1,
      loadError: ""
    };

    this.loadToken = 0;
    this.resizeObserver = null;
    this.audio = new AudioEngine(() => this.state.audioEnabled);
  }

  async init() {
    this.applyTheme(this.state.theme);
    this.state.laneCount = Number(this.ui.laneCount.value) || DEFAULT_LANES;
    this.state.lastTime = performance.now();
    this.resizeCanvas();
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

  activeLaneCount() {
    return Math.max(1, Math.min(MAX_LANES, Number(this.state.laneCount) || DEFAULT_LANES));
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
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
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

  cssVar(name, fallback) {
    return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
  }

  async loadLevel(levelId) {
    const level = LEVEL_MAP.get(levelId);
    if (!level) {
      return;
    }

    const token = ++this.loadToken;
    this.audio.stopBgm();
    this.state.phase = "loading";
    this.state.levelId = levelId;
    this.state.words = [];
    this.state.lanes = [];
    this.state.effects = [];
    this.state.loadError = "";
    this.showOverlay("Vocab Sprint", "Loading", "Start");
    this.updateUi();
    this.drawBoard();

    try {
      const words = await loadWords(level);
      if (token !== this.loadToken) {
        return;
      }
      this.state.words = words;
      this.state.phase = "ready";
      this.state.best = this.readBest();
      this.state.timeLeft = RUN_TIME;
      this.state.elapsed = 0;
      this.state.feedback = [];
      this.state.review = new Map();
      this.state.recent = [];
      this.makeLanes();
      this.renderFeed();
      this.showOverlay("Vocab Sprint", this.modeLabel(), "Start");
      this.updateUi();
      this.renderAnswerButtons();
      this.drawBoard();
    } catch (error) {
      if (token !== this.loadToken) {
        return;
      }
      this.state.phase = "error";
      this.state.loadError = error instanceof Error ? error.message : String(error);
      this.showOverlay("読み込みエラー", "ローカルサーバーで開いてください", "Start");
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

  missLineY(size = this.canvasSize()) {
    const offset = Math.max(38, Math.min(MISS_LINE_OFFSET, size.height * 0.18));
    return Math.max(24, size.height - offset);
  }

  fallDistance(size = this.canvasSize()) {
    return Math.max(1, this.missLineY(size));
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

  chooseWord() {
    const words = this.state.words;
    let candidate = words[this.randInt(0, words.length - 1)];
    for (let i = 0; i < 24 && this.state.recent.includes(candidate.english); i += 1) {
      candidate = words[this.randInt(0, words.length - 1)];
    }
    this.state.recent.push(candidate.english);
    this.state.recent = this.state.recent.slice(-9);
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
    const word = this.chooseWord();
    const options = this.makeOptions(word.japanese);
    const startY = startAbove ? -56 - this.randInt(0, 76) : -34 - this.randInt(0, 44);
    this.state.lanes[index] = {
      index,
      word,
      options,
      y: startY,
      startY,
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
      this.state.lanes[i].y -= i * 58;
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
      const english = document.createElement("span");
      english.textContent = item.count > 1 ? `${item.english} x${item.count}` : item.english;
      const japanese = document.createElement("span");
      japanese.textContent = item.japanese;
      row.append(english, japanese);
      this.ui.reviewList.appendChild(row);
    }
  }

  modeLabel() {
    return `${this.activeLevel().label} / ${this.activeLaneCount()}レーン`;
  }

  renderAnswerButtons() {
    this.ui.answers.innerHTML = "";
    this.ui.answers.style.setProperty("--lane-count", String(this.activeLaneCount()));
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
      right.textContent = LANE_KEYS[laneIndex].join(" ");
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
        key.textContent = LANE_KEYS[laneIndex][optionIndex];
        const word = document.createElement("span");
        word.className = "word";
        word.textContent = lane ? lane.options[optionIndex] : "";
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
    const seedBase = Date.now() ^ Math.floor(Math.random() * 0xffffffff);
    this.state.rngSeed = seedBase >>> 0;
    this.state.phase = "playing";
    this.state.laneCount = Number(this.ui.laneCount.value) || DEFAULT_LANES;
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
    this.state.lastTime = performance.now();
    this.makeLanes();
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
    this.audio.stopBgm();
    this.saveBest();
    this.showOverlay("Time Up", `Score ${this.state.score} / Best ${this.state.best}`, "Again");
    this.renderReviewList();
    this.addFeed(`Finish: ${this.state.score}`);
    this.audio.playSfx("finish");
    this.updateUi();
    this.renderAnswerButtons();
  }

  resetGame() {
    this.audio.stopBgm();
    this.state.phase = this.state.words.length ? "ready" : "loading";
    this.state.laneCount = Number(this.ui.laneCount.value) || DEFAULT_LANES;
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
    this.state.lastTime = performance.now();
    this.makeLanes();
    this.renderFeed();
    this.showOverlay("Vocab Sprint", this.modeLabel(), "Start");
    this.updateUi();
    this.renderAnswerButtons();
    this.drawBoard();
  }

  pauseGame() {
    if (this.state.phase === "playing") {
      this.state.phase = "paused";
      this.audio.stopBgm();
      this.showOverlay("Paused", `Score ${this.state.score}`, "Resume");
    } else if (this.state.phase === "paused") {
      this.state.phase = "playing";
      this.state.lastTime = performance.now();
      this.hideOverlay();
      this.audio.startBgm(() => this.state.phase);
    }
    this.updateUi();
    this.renderAnswerButtons();
  }

  toggleAudio() {
    this.state.audioEnabled = !this.state.audioEnabled;
    if (this.state.audioEnabled) {
      this.audio.init();
      this.audio.playSfx("toggle");
      if (this.state.phase === "playing") {
        this.audio.startBgm(() => this.state.phase);
      }
    } else {
      this.audio.stopBgm();
    }
    this.updateUi();
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
    const value = Math.abs(delta).toFixed(1).replace(/\.0$/, "");
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
      const timeBonus = CORRECT_TIME_BONUS + this.state.streak * STREAK_TIME_BONUS;
      this.state.score += gain;
      this.adjustTime(timeBonus);
      this.audio.playSfx("correct");
      this.state.effects.push({ lane: laneIndex, text: `+${gain}`, y: lane.y, life: 0.7, color: "#8fc35d" });
      this.state.effects.push({ lane: laneIndex, text: this.formatTimeDelta(timeBonus), y: lane.y + 24, life: 0.7, color: "#f0ce6c" });
      this.addFeed(`${lane.word.english} = ${lane.word.japanese} / ${this.formatTimeDelta(timeBonus)}`);
      setTimeout(() => {
        if (this.state.phase === "playing") {
          this.spawnLane(laneIndex, true);
          this.renderAnswerButtons();
        }
      }, 120);
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
      this.audio.playSfx("wrong");
      this.state.effects.push({ lane: laneIndex, text: `-20 ${this.formatTimeDelta(-WRONG_TIME_PENALTY)}`, y: lane.y, life: 0.55, color: "#df6557" });
      this.addFeed(`${lane.word.english}: 正解は ${lane.word.japanese} / ${this.formatTimeDelta(-WRONG_TIME_PENALTY)}`);
      this.adjustTime(-WRONG_TIME_PENALTY);
      setTimeout(() => {
        if (this.state.phase === "playing") {
          this.spawnLane(laneIndex, true);
          this.renderAnswerButtons();
        }
      }, 180);
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
    this.audio.playSfx("miss");
    this.state.effects.push({ lane: laneIndex, text: `MISS ${this.formatTimeDelta(-WRONG_TIME_PENALTY)}`, y: this.missLineY(this.canvasSize()) + 8, life: 0.65, color: "#e0b34e" });
    this.addFeed(`${lane.word.english} = ${lane.word.japanese} / ${this.formatTimeDelta(-WRONG_TIME_PENALTY)}`);
    this.adjustTime(-WRONG_TIME_PENALTY);
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
      effect.y -= 26 * dt;
    }
    this.state.effects = this.state.effects.filter((effect) => effect.life > 0);
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
    this.ctx.clearRect(0, 0, size.width, size.height);
    this.ctx.fillStyle = canvasBg;
    this.ctx.fillRect(0, 0, size.width, size.height);

    const lanes = this.activeLaneCount();
    const laneWidth = size.width / lanes;
    for (let i = 0; i < lanes; i += 1) {
      const x = i * laneWidth;
      this.ctx.fillStyle = i % 2 === 0 ? laneBgA : laneBgB;
      this.ctx.fillRect(x, 0, laneWidth, size.height);

      this.ctx.strokeStyle = laneLine;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, size.height);
      this.ctx.stroke();

      this.ctx.fillStyle = missLine;
      this.ctx.fillRect(x + 12, this.missLineY(size) + 20, laneWidth - 24, 2);

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
    const cardBg = this.cssVar("--card-bg", "#eef6f1");
    const cardText = this.cssVar("--card-text", "#101416");
    const cyan = this.cssVar("--cyan", "#61bfd1");
    const green = this.cssVar("--green", "#8fc35d");
    for (const lane of this.state.lanes) {
      if (!lane) {
        continue;
      }
      const laneX = lane.index * laneWidth;
      const lanes = this.activeLaneCount();
      const cardGap = laneWidth < 130 ? 8 : laneWidth < 180 ? 14 : 24;
      const maxCardWidth = lanes === 1 ? 420 : lanes === 2 ? 340 : 282;
      const cardWidth = Math.max(58, Math.min(laneWidth - cardGap, maxCardWidth));
      const cardHeight = lanes === 1 ? 88 : lanes === 2 ? 78 : laneWidth < 130 ? 76 : 70;
      const x = laneX + (laneWidth - cardWidth) / 2 + (lane.shake ? Math.sin(performance.now() / 28) * lane.shake : 0);
      const y = lane.y;
      const pulse = lane.flash === "correct" && lane.flashTime > 0 ? 1 : 0;
      const glow = pulse ? "rgba(143, 195, 93, 0.52)" : "rgba(97, 191, 209, 0.22)";

      this.ctx.save();
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
      const textLayout = this.layoutCanvasText(lane.word.english, textMaxWidth, cardHeight - 18, baseFont, maxLines, 12);
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
      const laneCenter = effect.lane * laneWidth + laneWidth / 2;
      this.ctx.save();
      this.ctx.globalAlpha = alpha;
      if (effect.type === "reveal") {
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
        this.ctx.fillStyle = effect.color;
        this.ctx.font = "950 22px system-ui, sans-serif";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        this.ctx.fillText(effect.text, laneCenter, effect.y);
      }
      this.ctx.restore();
    }
  }

  showOverlay(title, copy, buttonText) {
    this.ui.overlayTitle.textContent = title;
    this.ui.overlayCopy.textContent = copy;
    this.ui.reviewList.innerHTML = "";
    this.ui.startButton.textContent = buttonText;
    this.ui.overlay.classList.add("show");
  }

  hideOverlay() {
    this.ui.overlay.classList.remove("show");
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
    this.ui.soundButton.title = this.state.audioEnabled ? "サウンド ON" : "サウンド OFF";
    this.ui.soundButton.setAttribute("aria-label", this.ui.soundButton.title);
    this.ui.soundOnIcon.classList.toggle("hidden", !this.state.audioEnabled);
    this.ui.soundOffIcon.classList.toggle("hidden", this.state.audioEnabled);
    this.ui.themeLightIcon?.classList.toggle("hidden", this.state.theme === "light");
    this.ui.themeDarkIcon?.classList.toggle("hidden", this.state.theme !== "light");
    this.ui.level.disabled = this.state.phase === "playing" || this.state.phase === "paused" || isBusy;
    this.ui.laneCount.disabled = this.state.phase === "playing" || this.state.phase === "paused" || isBusy;
    this.ui.startButton.disabled = isBusy || isError || !this.state.words.length;
  }

  gameLoop(now) {
    const dt = Math.min(0.08, (now - this.state.lastTime) / 1000 || 0);
    this.state.lastTime = now;
    this.updateGame(dt);
    this.drawBoard();
    this.updateUi();
    requestAnimationFrame((time) => this.gameLoop(time));
  }

  keyToLane(key) {
    for (let lane = 0; lane < this.activeLaneCount(); lane += 1) {
      const option = LANE_KEYS[lane].indexOf(key);
      if (option >= 0) {
        return { lane, option };
      }
    }
    return null;
  }

  attachEvents() {
    this.ui.startButton.addEventListener("click", () => {
      if (this.state.phase === "paused") {
        this.pauseGame();
      } else {
        this.startGame();
      }
    });
    this.ui.restartButton.addEventListener("click", () => this.resetGame());
    this.ui.soundButton.addEventListener("click", () => this.toggleAudio());
    this.ui.themeButton?.addEventListener("click", () => this.toggleTheme());
    this.ui.pauseButton.addEventListener("click", () => this.pauseGame());
    this.ui.level.addEventListener("change", () => {
      if (this.state.phase === "ready" || this.state.phase === "over" || this.state.phase === "error") {
        this.loadLevel(this.ui.level.value);
      }
    });
    this.ui.laneCount.addEventListener("change", () => {
      if (this.state.phase === "ready" || this.state.phase === "over") {
        this.state.laneCount = Number(this.ui.laneCount.value) || DEFAULT_LANES;
        this.state.best = this.readBest();
        this.state.effects = [];
        this.makeLanes();
        this.updateUi();
        this.renderAnswerButtons();
        this.drawBoard();
        this.showOverlay("Vocab Sprint", this.modeLabel(), "Start");
      }
    });
    window.addEventListener("resize", () => {
      this.resizeCanvas();
      this.drawBoard();
    });
    window.addEventListener("keydown", (event) => {
      const key = event.key.toLowerCase();
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

export const APP_TITLE = "Word Rush";

export const SETTINGS_STORAGE_KEY = "word-rush-settings";
export const PREFERENCES_STORAGE_KEY = "word-rush-preferences";
export const PLAY_COUNTS_STORAGE_KEY = "word-rush-play-counts";
export const THEME_STORAGE_KEY = "word-rush-theme";

export const DEFAULT_PREFERENCES = {
  levelId: "elementary3",
  laneCount: 2
};

export const DEFAULT_GAME_SETTINGS = {
  correctTimeBonus: 0.1,
  streakTimeMultiplier: 0.01,
  wrongTimePenalty: 0.7,
  bgmEnabled: true,
  sfxEnabled: true,
  bgmVolume: 0.15,
  sfxVolume: 0.7,
  bgmTrack: "random"
};

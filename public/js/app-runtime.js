'use strict';

// ============================================================
//  Global State
// ============================================================
var audio = null, audioCtx = null, source = null, analyser = null, beatAnalyser = null, gainNode = null, audioReady = false;
var playbackUrlPreloadCache = Object.create(null);
var lyricPreloadCache = Object.create(null);
var preloadedAudioElements = Object.create(null);
var nextTrackPreloadTimer = 0;
var preparedNextTrackIndex = -1;
var PLAYBACK_PRELOAD_TTL_MS = 3 * 60 * 1000;
var uiSfxCtx = null, lastShelfSelectSfxAt = 0;
var FFT_SIZE = 2048;
var frequencyData = new Uint8Array(FFT_SIZE / 2);
var timeDomainData = new Uint8Array(FFT_SIZE);
var BEAT_FFT_SIZE = 2048;
var beatFrequencyData = new Uint8Array(BEAT_FFT_SIZE / 2);
var beatTimeDomainData = new Uint8Array(BEAT_FFT_SIZE);
var bass = 0, mid = 0, treble = 0, audioEnergy = 0, beatPulse = 0, prevEnergy = 0;
var lyricSunEnergy = 0, lyricSunTarget = 0, lyricSunHold = 0, lyricSunAvg = 0, lyricSunPeak = 0.55;
var smoothBass = 0, smoothMid = 0, smoothTreb = 0, smoothEnergy = 0;
var bassPeak = 0.12, midPeak = 0.10, treblePeak = 0.08, energyPeak = 0.10;
var beatOnsetFlag = false;        // beat 上升沿瞬时标志,每帧消费一次
var lastStrongDrop = 0;           // 用于 burst 预设的强 drop 时刻

var lyricsLines = [], lyricsVisible = false, lyricsHasNativeKaraoke = false, lyricsTimingSource = 'none';
var playlist = [], playQueue = [], currentIdx = -1, playing = false, playToggleBusy = false;
var searchMode = 'song', podcastResults = [], podcastPrograms = [], podcastCurrentRadio = null;
var loginStatus = { loggedIn: false, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' };
var activeAccountProvider = 'netease';
var neteaseWebLoginBusy = false;
var loginStatusChecked = false, loginStatusCheckFailed = false;
var qrPollTimer = null, qrKey = null;
var volumeTween = null, trackSwitchToken = 0;
var audioFadeTimer = null, audioElementFadeFrame = 0, audioFadeSerial = 0;
var AUDIO_FADE_IN_MS = 460;
var AUDIO_FADE_OUT_MS = 420;
var AUDIO_SILENCE_GAIN = 0.0001;
var PLAYBACK_SESSION_STORE_KEY = 'mineradio-playback-session-v1';
var CROSSFADE_STORE_KEY = 'mineradio-crossfade-ms-v1';
var VOLUME_LEVELING_STORE_KEY = 'mineradio-volume-leveling-v1';
var TRACK_CROSSFADE_DEFAULT_MS = 700;
var trackCrossfadeMs = TRACK_CROSSFADE_DEFAULT_MS;
var volumeLevelingEnabled = readBooleanPreference(VOLUME_LEVELING_STORE_KEY, false);
var playbackSessionSaveTimer = 0;
var restoredPlaybackState = null;
var playbackState = { phase: 'idle', token: 0, index: -1, songKey: '', desiredPlaying: false, error: '', updatedAt: Date.now() };
var playbackReconcileTick = 0;
var userPlaylists = [], myPodcastCollections = [], myPodcastItems = {}, playlistCoverCache = {};
var USER_LIBRARY_CACHE_KEY = 'mineradio-user-library-cache-v1';
var PLAYLIST_TRACK_CACHE_KEY = 'mineradio-playlist-track-cache-v1';
var LYRIC_PERSISTENT_CACHE_KEY = 'mineradio-lyric-cache-v1';
var COVER_PALETTE_CACHE_KEY = 'mineradio-cover-palette-cache-v2';
var USER_LIBRARY_CACHE_TTL_MS = 10 * 60 * 1000;
var PLAYLIST_TRACK_PERSIST_TTL_MS = 7 * 86400000;
var LYRIC_PERSISTENT_CACHE_TTL_MS = 30 * 86400000;
var COVER_PALETTE_CACHE_TTL_MS = 90 * 86400000;
var userLibraryCacheSavedAt = 0;
var lyricPersistentCacheMemory = null;
var coverPaletteCacheMemory = null;
var CUSTOM_COVER_STORE_KEY = 'mineradio-custom-covers';
var CUSTOM_LYRIC_STORE_KEY = 'mineradio-custom-lyrics-v1';
var CUSTOM_LYRIC_PREF_STORE_KEY = 'mineradio-custom-lyric-prefs-v1';
var LYRIC_LAYOUT_STORE_KEY = 'mineradio-lyric-layout-v1';
var VISUAL_PRESET_SCHEMA = 'skull-preset-v2';
var PLAYBACK_QUALITY_STORE_KEY = 'mineradio-playback-quality-v1';
var UPLOAD_TIP_STORE_KEY = 'mineradio-upload-tip-seen';
var DIY_MODE_STORE_KEY = 'mineradio-diy-player-mode-v1';
var PLAYLIST_PANEL_PIN_STORE_KEY = 'mineradio-playlist-panel-pinned-v1';
// v3 migrates existing installs back to the requested right-side default once;
// users can still switch sides afterwards and that choice remains persistent.
var PLAYLIST_PANEL_SIDE_STORE_KEY = 'mineradio-playlist-panel-side-v3';
var LYRIC_CAMERA_FOLLOW_MIGRATION_KEY = 'mineradio-lyric-camera-follow-v1';
var USER_CAPSULE_AUTO_HIDE_STORE_KEY = 'mineradio-user-capsule-auto-hide-v1';
var FX_FAB_AUTO_HIDE_STORE_KEY = 'mineradio-fx-fab-auto-hide-v1';
var CONTROLS_AUTO_HIDE_STORE_KEY = 'mineradio-controls-auto-hide-v1';
var FREE_CAMERA_STORE_KEY = 'mineradio-free-camera-v1';
var HOTKEY_SETTINGS_STORE_KEY = 'mineradio-hotkey-settings-v1';
var VISUAL_GUIDE_SEEN_STORE_KEY = 'mineradio-visual-guide-seen-v2';
var LOCAL_BEATMAP_STORE_KEY = 'mineradio-local-beatmaps-v1';
var LOCAL_BEAT_PREF_STORE_KEY = 'mineradio-local-beatmap-prefs-v1';
var LOCAL_BEAT_COMBOS = ['', 'downbeat', 'push', 'drop', 'rebound', 'accent'];
var HOTKEY_ACTIONS = [
  { key:'togglePlay', label:'播放 / 暂停', category:'播放', local:'Space', global:'Ctrl+Alt+Space' },
  { key:'prevTrack', label:'上一首', category:'播放', local:'ArrowLeft', global:'Ctrl+Alt+ArrowLeft' },
  { key:'nextTrack', label:'下一首', category:'播放', local:'ArrowRight', global:'Ctrl+Alt+ArrowRight' },
  { key:'volumeUp', label:'音量增加', category:'音量', local:'ArrowUp', global:'Ctrl+Alt+ArrowUp' },
  { key:'volumeDown', label:'音量降低', category:'音量', local:'ArrowDown', global:'Ctrl+Alt+ArrowDown' },
  { key:'toggleFullscreen', label:'全屏', category:'窗口', local:'KeyF', global:'Ctrl+Alt+KeyF' },
  { key:'toggleDesktopLyrics', label:'桌面歌词', category:'歌词', local:'Alt+KeyL', global:'Ctrl+Alt+KeyL' }
];
var hotkeyCaptureState = null;
var hotkeyGlobalStatus = {};
var diyPlayerMode = readDiyModePreference();
var customCoverMap = readCustomCoverMap();
var customLyricMap = readCustomLyricMap();
var customLyricPrefs = readCustomLyricPrefs();
var localBeatMapCache = readLocalBeatMapCache();
var localBeatMapPrefs = readLocalBeatPrefs();
var playbackQuality = readPlaybackQualityPreference();
var qqPlaybackQualityCeiling = '';
var coverCropState = null, coverCropBound = false;
var currentLocalSong = null;
var lyricSourceMode = 'original';
var originalLyricsState = { lines: [], hasNativeKaraoke: false, timingSource: 'none' };
var localBeatAnalysis = { song:null, audioUrl:'', mode:'mr', active:false, token:0 };
var likedSongMap = {}, likeBusyMap = {}, likeStatusToken = 0;
var collectTargetSong = null, collectBusy = false;
var uploadTipTimer = null, uploadTipAttempts = 0;
var visualGuideActive = false, visualGuideStep = 0, visualGuideResizeBound = false;
var visualGuideState = { bottomWasVisible: false, searchWasPeek: false, manual: false };
var emptyHomeActive = false;
var homeForcedOpen = false;
var homeSuppressed = false;
var homeDiscoverState = { loading: false, loaded: false, loggedIn: false, mode: 'starter', songs: [], playlists: [], podcasts: [], error: '', updatedAt: 0 };
var homeDiscoverToken = 0;
var homeVisualPresetActive = false;
var homeVisualPrevPreset = 0;
var HOME_LISTEN_STATS_KEY = 'mineradio-listen-stats-v1';
var likedMusicPlayBusy = false;
var PLAYLIST_FAST_INITIAL_LIMIT = 80;
var PLAYLIST_BACKGROUND_PAGE_LIMIT = 200;
var PLAYLIST_SAFE_TRACK_LIMIT = 5000;
var PLAYLIST_PERSIST_TRACK_LIMIT = 2000;
var PLAYLIST_CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
var playlistTrackRequestCache = Object.create(null);
var playlistPersistentStoreMemory = null;
var playlistQueueLoadToken = 0;
var adaptiveMusicDynamics = {
  rawRmsAvg: 0, visualGain: 1, shortEnergy: 0, longEnergy: 0,
  shortLow: 0, longLow: 0, buildup: 0, chorus: 0, chorusHold: 0,
  chorusEntryPulse: 0, frames: 0
};
var activeRadioContext = null;
var listenStatsState = loadListenStatsState();
var listenSession = null;
var appPerfMarks = [];

markAppPerf('script-start');

installStartupLongTaskObserver();
var queueViewTab = 'queue', playMode = 'loop', miniQueueOpen = false;
var miniQueueRenderSeq = 0, queueRenderSeq = 0, playlistRenderSeq = 0;
var queueDragState = { from: -1, over: -1, after: false, suppressClickUntil: 0 };
var queuePanelDirty = false;
var PLAYLIST_PANEL_BATCH_SIZE = 28;
var playlistPanelRenderLimit = PLAYLIST_PANEL_BATCH_SIZE;
var playlistPanelLazyBound = false;
var PLAYLIST_DETAIL_INITIAL_RENDER = 64;
var PLAYLIST_DETAIL_BATCH_SIZE = 48;
var smoothWheelScrollBound = false;
var coverProcessToken = 0, aiDepthPipeline = null, aiDepthReady = false, aiDepthBusy = false, aiDepthFailUntil = 0;
var coverDepthCache = Object.create(null), coverDepthCacheKeys = [];
var aiDepthLastRunAt = 0, aiDepthMinGapMs = 18000;
var updatePreviewState = {
  visible: false,
  open: false,
  status: 'idle',
  progress: 0,
  timer: null,
  pollTimer: null,
  downloadJobId: '',
  patchJobId: '',
  mode: 'installer',
  installerPath: '',
  installerOpened: false,
  cached: false,
  currentVersion: '0.9.11',
  version: '1.1.0',
  configured: false,
  preview: true,
  updateAvailable: false,
  releaseUrl: '',
  downloadUrl: '',
  patchAvailable: false,
  patchUrl: '',
  received: 0,
  total: 0,
  speedBps: 0,
  etaSeconds: 0,
  sourceLabel: '',
  attempt: 0,
  attempts: 0,
  errorReason: '',
  errorDetail: '',
  failedAttempts: [],
  message: '',
  restartRequired: false,
  patchFallbackTried: false,
  hero: '当前版本，更新检测已就绪。',
  notes: [
    '安装包文字对比修复',
    '安装目录可自由选择',
    '单实例与快捷方式修复'
  ]
};


















var targetVolume = readSavedVolume();
var lastNonZeroVolume = targetVolume > 0.01 ? targetVolume : 0.8;
var volumeCloseTimer = null;

// v7.2: 离线节拍预解析
//   每次切歌, fetch 完整音频 → OfflineAudioContext 分析 → 标出真鼓点
//   缓存按 song.id 存, 避免重复
var beatMapCache = {};       // { songId: { kicks: [t1, t2, ...], duration: ... } }
var currentBeatMap = null;   // 当前播放的歌的 beatMap
var beatMapNextIdx = 0;      // 下一个待触发的 kick index
var beatMapBusy = false;     // 正在分析中
var beatMapToken = 0;        // 取消旧分析
var beatAnalysisTimer = null;
var beatAnalysisStartedAt = 0;
var beatPrefetchTimer = null;
var beatPrefetchBusy = false;
var beatPrefetchToken = 0;
var beatPrefetchLastKey = '';
var BEAT_PREFETCH_LIMIT = 2;
var beatDiskCacheStatus = { checked:false, enabled:false, mode:'unknown', reason:'' };
var beatDiskCacheNoticeLogged = false;
var djBeatMapCache = {};
var currentDjBeatMap = null;
var djBeatMapNextIdx = 0;
var djBeatPulseNextIdx = 0;
var djBeatMapBusy = false;
var djBeatMapToken = 0;
var djBeatAnalysisTimer = null;
var beatAnalysisConfig = {
  delayMs: 1600,
  minPlaybackSec: 1.2,
  idleTimeout: 1400,
  skipMusicTempoWhilePlaying: false
};
var beatCam = {
  nextIdx: 0,
  events: [],
  punch: 0,
  lookahead: 0.075,
  lastTriggerAt: -10,
  lastRealtimeAt: -10,
  minInterval: 0.820,
  fallbackMinInterval: 0.320,
  realtimeMinInterval: 0.720,
  realtimeMergeWindow: 0.135,
  attack: 0.028,
  hold: 0.030,
  release: 0.185,
  thetaKick: 0,
  phiKick: 0,
  radiusKick: 0,
  rollKick: 0,
  prevAudioTime: -1,
  stats: { map: 0, live: 0, merged: 0, liveBlocked: 0 }
};
var liveCamAvg = 0, liveCamPeak = 0.28, liveCamLastRaw = 0;
var cinemaDynamics = { avg: 0, lowAvg: 0, peak: 0.30, scale: 0.82 };
var cinemaTrackProfile = {
  scale: 1.0,
  target: 1.0,
  nameHint: 1.0,
  frames: 0,
  energyAvg: 0,
  lowAvg: 0,
  vocalAvg: 0,
  melodyAvg: 0,
  punchPeak: 0.10,
  density: 0
};
var rtBeat = {
  subFast: 0, subSlow: 0, lowFast: 0, lowSlow: 0,
  bodyFast: 0, bodySlow: 0, vocalFast: 0, vocalSlow: 0, snapFast: 0, snapSlow: 0,
  prevSub: 0, prevLow: 0, prevBody: 0, prevVocal: 0, prevSnap: 0, prevRms: 0,
  onsetAvg: 0.012, onsetPeak: 0.060,
  subPeak: 0.14, lowPeak: 0.18, bodyPeak: 0.16, vocalPeak: 0.16, snapPeak: 0.14,
  lastHitAt: -10,
  tempoGap: 0,
  tempoConfidence: 0,
  beatCount: 0,
  primedFrames: 0,
  warmupUntil: 0,
  pulse: 0,
  score: 0,
  stats: { hits: 0, blocked: 0, assisted: 0, strong: 0, rejected: 0 }
};
var djMode = {
  active: false,
  songKey: '',
  startedAt: 0,
  lastNoticeAt: -100000,
  tempoGap: 0,
  tempoConfidence: 0,
  sectionEnergy: 0,
  sectionLow: 0,
  sectionChange: 0,
  visualPulse: 0,
  lastBeatAt: -10
};















// fx 状态: 预设 + 主滑块 + 开关 + 三态
var fxDefaults = {
  preset: 0,            // 0=emily cover, 1=tunnel, 2=orbit, 3=void, 4=vinyl, 5=wallpaper, 6=skull
  intensity: 0.85,
  cinemaShake: 0.5,
  depth: 1.0,
  coverResolution: 1.55,
  point: 1.0, speed: 1.0, twist: 0.0, color: 1.10, scatter: 0.0, bgFade: 0.20,
  bloomStrength: 0.62,
  lyricGlowStrength: 0.28,
  lyricScale: 1.0,
  lyricOffsetX: 0,
  lyricOffsetY: 0,
  lyricOffsetZ: 0,
  lyricTiltX: 0,
  lyricTiltY: 0,
  lyricColorMode: 'auto',
  lyricColor: '#a9b8c8',
  lyricHighlightMode: 'auto',
  lyricHighlightColor: '#fac900',
  lyricGlowLinked: true,
  lyricGlowColor: '#008aff',
  lyricFont: 'hei',
  lyricLetterSpacing: 0,
  lyricLineHeight: 1.0,
  lyricWeight: 900,
  visualTintMode: 'auto',
  visualTintColor: '#9db8cf',
  uiAccentColor: '#ffffff',
  homeAccentColor: '#ffffff',
  homeIconColor: '#ffffff',
  visualIconColor: '#ffffff',
  backgroundColorMode: 'cover',
  backgroundColor: '#000000',
  backgroundOpacity: 1,
  controlGlassChromaticOffset: 90,
  backgroundColorCustom: false,
  backgroundImage: '',
  backgroundMedia: null,
  desktopLyrics: false,
  desktopLyricsSize: 1.0,
  desktopLyricsOpacity: 0.92,
  desktopLyricsY: 0.76,
  desktopLyricsClickThrough: false,
  desktopLyricsCinema: true,
  desktopLyricsHighlight: false,
  desktopLyricsFps: 60,
  wallpaperMode: false,
  wallpaperOpacity: 1,
  wallpaperLyrics: true,
  wallpaperParticleMode: 'full',
  floatLayer: false, cinema: true, edge: false, aiDepth: false, bloom: false, lyricGlow: true,
  lyricGlowBeat: true,
  lyricGlowParticles: false,
  lyricCameraLock: true,
  particleLyrics: true,    // v7.2: 粒子歌词
  backCover: false,        // 旧的封面背面粒子层关闭；浮空粒子层会跟随封面翻转
  shelf: 'side',
  shelfCameraMode: 'static',
  shelfPresence: 'always',
  shelfShowPodcasts: false,
  shelfMergeCollections: false,
  shelfSize: 1,
  shelfOffsetX: 0,
  shelfOffsetY: 0,
  shelfOffsetZ: 0,
  shelfAngleY: -15,
  shelfAngleYManual: false,
  shelfOpacity: 1,
  shelfBgOpacity: 0.90,
  shelfAccentColor: '#ffffff',
  performanceBackground: 'auto',
  performanceQuality: 'high',
  liveBackgroundKeep: false,
  cam: 'off',
};
var PACKAGED_DEFAULT_USER_FX_ARCHIVE_NAME = '默认测试';
var PACKAGED_DEFAULT_USER_FX_ARCHIVE_EXPORTED_AT = 1782276031784;
var PACKAGED_DEFAULT_USER_FX_ARCHIVE_SAVED_AT = 1782273019045;
var PACKAGED_DEFAULT_FX_SNAPSHOT = Object.freeze({
  visualPresetSchema: VISUAL_PRESET_SCHEMA,
  preset: 0,
  intensity: 0.85,
  cinemaShake: 0.5,
  depth: 1,
  coverResolution: 1.55,
  point: 1,
  speed: 1,
  twist: 0,
  color: 1.1,
  scatter: 0,
  bgFade: 0.2,
  bloomStrength: 0.62,
  lyricGlowStrength: 0.28,
  lyricScale: 1,
  lyricOffsetX: 0,
  lyricOffsetY: 0,
  lyricOffsetZ: 0,
  lyricTiltX: 0,
  lyricTiltY: 0,
  lyricCameraLock: true,
  lyricColorMode: 'auto',
  lyricColor: '#a9b8c8',
  lyricHighlightMode: 'auto',
  lyricHighlightColor: '#fac900',
  lyricGlowLinked: true,
  lyricGlowColor: '#008aff',
  lyricFont: 'hei',
  lyricLetterSpacing: 0,
  lyricLineHeight: 1,
  lyricWeight: 900,
  visualTintMode: 'auto',
  visualTintColor: '#9db8cf',
  uiAccentColor: '#ffffff',
  homeAccentColor: '#ffffff',
  homeIconColor: '#ffffff',
  visualIconColor: '#ffffff',
  backgroundColorMode: 'cover',
  backgroundColor: '#000000',
  backgroundOpacity: 1,
  controlGlassChromaticOffset: 90,
  backgroundColorCustom: false,
  floatLayer: false,
  cinema: true,
  edge: false,
  aiDepth: false,
  bloom: false,
  lyricGlow: true,
  lyricGlowBeat: true,
  lyricGlowParticles: false,
  desktopLyrics: false,
  desktopLyricsSize: 1,
  desktopLyricsOpacity: 0.92,
  desktopLyricsY: 0.76,
  desktopLyricsClickThrough: false,
  desktopLyricsCinema: true,
  desktopLyricsHighlight: false,
  desktopLyricsFps: 60,
  wallpaperMode: false,
  wallpaperOpacity: 1,
  wallpaperLyrics: true,
  wallpaperParticleMode: 'full',
  performanceBackground: 'auto',
  performanceQuality: 'high',
  liveBackgroundKeep: false,
  particleLyrics: true,
  backCover: false,
  shelf: 'side',
  shelfCameraMode: 'static',
  shelfPresence: 'always',
  shelfShowPodcasts: false,
  shelfMergeCollections: false,
  shelfSize: 1,
  shelfOffsetX: 0,
  shelfOffsetY: 0,
  shelfOffsetZ: 0,
  shelfAngleY: -15,
  shelfAngleYManual: false,
  shelfOpacity: 1,
  shelfBgOpacity: 0.9,
  shelfAccentColor: '#ffffff',
  cam: 'off'
});


var DEVELOPMENT_LOCKED_FX = { desktopLyrics: true };



var playbackVisualPreset = readSavedPlaybackVisualPreset();
var startupVisualPreviewActive = false;
var fx = Object.assign({}, fxDefaults, readSavedLyricLayout());
normalizeDevelopmentLockedFxState();
var presetTransition = { active:false, start:-10, duration:0.92, from:0, to:0 };
var controlsAutoHide = readBooleanPreference(CONTROLS_AUTO_HIDE_STORE_KEY, false);
var controlsHovering = false;
var controlsHideTimer = null;
var controlsHandleDimTimer = null;
var controlsLastMoveAt = 0;
var controlsShelfSuppressUntil = 0;
var cursorHideTimer = null;
var CURSOR_HIDE_DELAY = 2500;
var fxPanelPinned = false;
var playlistPanelPinned = readBooleanPreference(PLAYLIST_PANEL_PIN_STORE_KEY, false);
var playlistPanelSide = readPlaylistPanelSidePreference();
var playlistPanelPreferredSide = playlistPanelSide;
var playlistPanelSideSwitchTimer = 0;
var playlistPanelPreferredSideResetTimer = 0;
var playlistPanelAutoRevealSuppressed = false;
var userCapsuleAutoHide = readBooleanPreference(USER_CAPSULE_AUTO_HIDE_STORE_KEY, false);
var fxFabAutoHide = readBooleanPreference(FX_FAB_AUTO_HIDE_STORE_KEY, false);
var fxFabAutoHideRevealArmed = true;
var hotkeySettings = readHotkeySettings();
var immersiveMode = false;
var immersiveState = {
  shelfMode: null,
  shelfPinnedOpen: false,
  lyrics: true,
  controlsAutoHide: true,
  bottomVisible: false
};

// 鼠标 / 摄像头视差
var pointerParallax = { x:0, y:0 };
var pointerTarget = { x:0, y:0 };
var headParallax = { x:0, y:0, active:false };
var headNeutral = null;



var desktopRuntimeState = {
  desktop: !!window.desktopWindow,
  minimized: false,
  visible: true,
  focused: true,
  fullscreen: false
};
var renderPowerState = { mode: '', width: 0, height: 0, pixelRatio: 0 };
var backgroundCacheTrimTimer = 0;
var runtimePerfState = {
  lastCacheTrimAt: 0,
  cacheTrimCount: 0,
  lastCacheTrimReason: '',
  lastHeapSampleAt: 0,
  heapMB: 0,
  cacheCounts: {}
};















window.__mineradioPerfSnapshot = collectRuntimePerfSnapshot;








// ============================================================
//  Three.js 场景
// ============================================================
var scene = new THREE.Scene();
scene.background = null;
var camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
var RENDER_DPR_CAP = 1.35;
var RENDER_PIXEL_BUDGET = 5200000;
var RENDER_MIN_DPR = 0.72;
// 0 = display vsync. Keep visible playback high-refresh capable instead of capping 120Hz+ screens to 60/72.
var RENDER_VISIBLE_VSYNC = true;
var RENDER_ACTIVE_FPS = 0;
var RENDER_LARGE_FPS = 0;
var RENDER_HUGE_FPS = 0;
var RENDER_INTERACTION_FPS = 0;
var RENDER_INTERACTION_LARGE_FPS = 0;
var RENDER_INTERACTION_HUGE_FPS = 0;
var RENDER_INTERACTION_HOLD_MS = 900;
var renderInteractionBoostUntil = 0;
var renderInteractionReason = '';






var renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(getRenderPixelRatio());
renderer.setSize(innerWidth, innerHeight);
renderer.domElement.style.background = 'transparent';
renderer.domElement.style.display = 'block';
renderer.domElement.style.width = '100%';
renderer.domElement.style.height = '100%';
renderer.domElement.tabIndex = 0;
document.getElementById('canvas-container').appendChild(renderer.domElement);

// ============================================================
//  相机系统 v7.1 — 分离 user offset / cinema offset
//   - userOrbit: 用户拖拽的目标 (永久保留, 不会被电影模式覆盖)
//   - cinemaOffset: 电影模式的微偏移 (始终叠加, 即使用户在拖)
//   - 最终 theta = userOrbit.theta + cinemaOffset.theta
//   - 回正按钮 / 双击屏幕: 让 userOrbit 缓慢归零
// ============================================================
var orbit = {
  userTheta: 0.0, userPhi: 0.08, userRadius: 6.6,
  cineTheta: 0.0, cinePhi: 0.0, cineRadius: 0.0,
  theta: 0.0, phi: 0.08, radius: 6.6,
  minPhi: -Math.PI*0.45, maxPhi: Math.PI*0.45,
  minRadius: 2.4, maxRadius: 14.0,
  baselineTheta: 0.0, baselinePhi: 0.08, baselineRadius: 6.6,
  rotating: false, last:{x:0,y:0},
  recentering: false,
  centerLocked: false,
  // v8: 镜头跟拍 (hover shelf / queue 时)
  lookAt: new THREE.Vector3(0,0,0),
  focus: {
    active: false,
    type: null,        // 'shelf-side' | 'shelf-stage' | 'queue'
    theta: 0.0, phi: 0.08, radius: 6.6,
    lookAt: new THREE.Vector3(0,0,0),
  },
  glowFollowX: 0,
  glowFollowY: 0,
  glowFollowRoll: 0,
  beatGlow: 0,
};
var ZERO_VEC = new THREE.Vector3(0,0,0);
var BASE_FOV = 45;
var camPunch = 0;
var cinemaT = 0;


var freeCamera = readFreeCameraState();
var FREE_CAMERA_MOVE = new THREE.Vector3();
var FREE_CAMERA_TARGET_VEL = new THREE.Vector3();
var FREE_CAMERA_SHAKE_DIR = new THREE.Vector3();
var FREE_CAMERA_EULER = new THREE.Euler(0, 0, 0, 'YXZ');
var FREE_CAMERA_RESET_MAT = new THREE.Matrix4();
var FREE_CAMERA_RESET_QUAT = new THREE.Quaternion();
var FREE_CAMERA_UP = new THREE.Vector3(0, 1, 0);
var freeCameraPointer = { seen: false, x: 0, y: 0 };
var freeCameraDeferredSaveTimer = 0;












// The wallpaper surface shares the App's origin/storage partition, so it must
// never persist its passive fake playback state over the real player session.
if (!WALLPAPER_SURFACE) {
  window.addEventListener('beforeunload', flushPersistentVisualState);
  window.addEventListener('beforeunload', function(){ savePlaybackSessionNow('beforeunload'); });
  window.addEventListener('pagehide', function(){ savePlaybackSessionNow('pagehide'); });
  window.addEventListener('pagehide', flushPersistentVisualState);
}

































































// 焦点跟拍 (hover 0.5s 后镜头移到目标)
var focusHover = { wantType: null, pendingTimer: null, exitTimer: null };










// 电影镜头 v8: 振幅大幅减小, 节拍 punch 加冷却 + 强度门槛
//   - cineTheta/Phi 是非常缓慢的低频漂移, 不再让人 motion sick
//   - punch zoom 只在 真·强主拍 触发, 至少间隔 0.45s, 振幅 ×0.5
var lastCamPunchAt = -10;
var CAM_PUNCH_MIN_INTERVAL = 0.45;     // 秒
var CAM_PUNCH_BEAT_THRESHOLD = 0.55;   // 必须够强才触发

updateCamera();





























(function initControlsAutoHide() {
  if (WALLPAPER_SURFACE) return;
  var bar = document.getElementById('bottom-bar');
  var handle = document.getElementById('bottom-handle');
  if (!bar) return;
  function enterControls(){
    controlsHovering = true;
    wakeBottomHandle();
    setControlsHidden(false);
    if (controlsHideTimer) { clearTimeout(controlsHideTimer); controlsHideTimer = null; }
  }
  function leaveControls(){
    controlsHovering = false;
    scheduleControlsHide(70);
    wakeBottomHandle(900);
  }
  bar.addEventListener('mouseenter', enterControls);
  bar.addEventListener('mouseleave', leaveControls);
  if (handle) {
    handle.addEventListener('mouseenter', function(){
      controlsHovering = true;
      revealBottomControls(900);
    });
    handle.addEventListener('mouseleave', leaveControls);
    handle.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); toggleBottomControlsFromHandle(); });
  }
  updateControlsChromeState();
})();













['mousemove', 'pointermove', 'mousedown', 'wheel', 'touchstart'].forEach(function(type){
  window.addEventListener(type, revealCursorForActivity, { passive:true, capture:true });
});
syncCursorAutoHideMode();

// ============================================================
//  指针 / 拖拽控制
//   v7.1: 用 userOrbit 替代 targetOrbit; 加 drag 距离判断
// ============================================================
var mouseWorld = new THREE.Vector3(-999, -999, 0);
var mouseActive = false;
var mouseDownAt = { x:0, y:0, t:0, hadDrag:false };
var particlePointerSpin = { active:false, lastX:0, lastY:0, lastT:0 };
var particlePointerRay = new THREE.Raycaster();
var particlePointerNdc = new THREE.Vector2();
var particlePointerPlane = new THREE.Plane();
var particlePointerPlanePoint = new THREE.Vector3();
var particlePointerPlaneNormal = new THREE.Vector3();
var particlePointerWorldHit = new THREE.Vector3();
var particlePointerLocalHit = new THREE.Vector3();
var particlePointerQuat = new THREE.Quaternion();
var particlePointerFrame = { dirty:false, ndcX:0, ndcY:0 };
var CLICK_THRESHOLD = 6;  // 像素, 拖动 > 6px 视为 drag
var UI_HIT_SELECTOR = '#search-area,#top-right,#fullscreen-diy-zone,#fx-panel,#fx-fab,#fx-fab-hide-btn,#playlist-panel,#bottom-bar,#thumb-wrap,#empty-home,#visual-guide,#trial-banner,#source-fallback-notice,.modal-mask,#toast,#ai-depth-chip,#beat-chip,#drop-overlay';










renderer.domElement.addEventListener('mousedown', function(e){
  beginParticlePointerDrag(e);
});
window.addEventListener('mousedown', function(e){
  if (!(fx && fx.preset === SKULL_PRESET_INDEX)) return;
  if (orbit.rotating || e.target === renderer.domElement) return;
  beginParticlePointerDrag(e);
}, true);
window.addEventListener('mousemove', function(e){
  updateControlsAutoHideFromPointer(e.clientX, e.clientY);
  idleGuidePointerMove(e);
  if (freeCamera && freeCamera.active) {
    markRenderInteraction('free-camera', 900);
    var mdx = e.movementX || 0;
    var mdy = e.movementY || 0;
    if ((!mdx && !mdy) && freeCameraPointer.seen) {
      mdx = e.clientX - freeCameraPointer.x;
      mdy = e.clientY - freeCameraPointer.y;
    }
    freeCameraPointer.x = e.clientX;
    freeCameraPointer.y = e.clientY;
    freeCameraPointer.seen = true;
    freeCamera.yaw -= mdx * 0.00125;
    freeCamera.pitch = clampRange(freeCamera.pitch - mdy * 0.00125, -Math.PI * 0.49, Math.PI * 0.49);
    return;
  }
  if (isPointerOverUi(e) && !orbit.rotating) { mouseActive = false; return; }
  if (orbit.rotating) {
    markRenderInteraction('canvas-drag', 900);
    unlockCenteredView();
    var dx = e.clientX - orbit.last.x, dy = e.clientY - orbit.last.y;
    if (particlePointerSpin.active) {
      var nowSpin = performance.now();
      var spinDt = Math.max(1 / 120, Math.min(0.08, (nowSpin - particlePointerSpin.lastT) / 1000 || 1 / 60));
      applyParticleSpinDrag(dx, dy, spinDt);
      particlePointerSpin.lastX = e.clientX;
      particlePointerSpin.lastY = e.clientY;
      particlePointerSpin.lastT = nowSpin;
    }
    orbit.last.x = e.clientX; orbit.last.y = e.clientY;
    // drag 距离判断
    var totalDx = e.clientX - mouseDownAt.x, totalDy = e.clientY - mouseDownAt.y;
    if (Math.sqrt(totalDx*totalDx + totalDy*totalDy) > CLICK_THRESHOLD) mouseDownAt.hadDrag = true;
    if (orbit.recentering) orbit.recentering = false;
  }
  queueParticlePointerFrame(e.clientX, e.clientY);
});
window.addEventListener('mouseup', function(){
  orbit.rotating = false;
  particlePointerSpin.active = false;
  idleGuidePointerUp();
});
renderer.domElement.addEventListener('mouseleave', function(){
  particlePointerFrame.dirty = false;
  mouseWorld.set(-999, -999, 0);
  mouseActive = false;
  idleGuidePointerLeave();
});
renderer.domElement.addEventListener('wheel', function(e){
  if (isPointerOverUi(e)) return;
  e.preventDefault();
  markRenderInteraction('canvas-wheel', 900);
  if (freeCamera && freeCamera.active) {
    freeCamera.fov = clampRange((freeCamera.fov || BASE_FOV) + e.deltaY * 0.018, 26, 72);
    saveFreeCameraState();
    return;
  }
  if (fx && fx.preset === SKULL_PRESET_INDEX && typeof skullWheelZoomTarget !== 'undefined') {
    skullWheelZoomTarget = clampRange(skullWheelZoomTarget + e.deltaY * 0.00155, -0.95, 1.28);
    return;
  }
  idleGuideWheel(e);
  unlockCenteredView();
  orbit.userRadius = Math.max(orbit.minRadius, Math.min(orbit.maxRadius, orbit.userRadius + e.deltaY * 0.005));
  if (orbit.recentering) orbit.recentering = false;
}, { passive:false });

// 双击屏幕回正 — 不命中卡片时
renderer.domElement.addEventListener('dblclick', function(e){
  if (isPointerOverUi(e)) return;
  if (freeCamera && freeCamera.locked) {
    resetFreeCameraToDefault();
    resetSkullPresetView(false, { smooth:true, keepLyricLock:true });
    return;
  }
  if (shelfManager && shelfManager.getMode() !== 'off') {
    var mx = (e.clientX / innerWidth) * 2 - 1;
    var my = -(e.clientY / innerHeight) * 2 + 1;
    var rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(mx, my), camera);
    if (shelfManager.raycastCards(rc)) return;
  }
  recenterCamera();
});

// ============================================================
//  粒子点纹理 (干净圆点, 无 glow)
// ============================================================

var dotTexture = makeDotTexture();

// ============================================================
//  主粒子系统
//   - 5 个 preset, 每个预设走完全不同的 pos 计算
//   - 共享: 封面色采样, 鼠标交互, 粒子大小限制
// ============================================================
var PLANE_SIZE = 4.8;
var RIPPLE_MAX = 12;

var GRID_X = coverParticleGridForResolution(fx.coverResolution), GRID_Y = GRID_X;
var PCOUNT = GRID_X * GRID_Y;
var positions = null, uvs = null, aRand = null;
var coverResolutionReloadTimer = null;
var currentCoverSource = null;
var coverPickerCanvas = null;



var geo = buildCoverParticleGeometry(GRID_X);





// 涟漪数据纹理 (1×N, RGBA: x, y, age, str)
var rippleData = new Float32Array(RIPPLE_MAX * 4);
var rippleTex  = new THREE.DataTexture(rippleData, 1, RIPPLE_MAX, THREE.RGBAFormat, THREE.FloatType);
rippleTex.magFilter = THREE.NearestFilter; rippleTex.minFilter = THREE.NearestFilter;
var ripples = [];
for (var ri = 0; ri < RIPPLE_MAX; ri++) ripples.push({ x:0, y:0, age:-10, str:0 });

// 封面纹理 + 边缘/深度纹理
var coverTex = new THREE.Texture();
coverTex.minFilter = THREE.LinearFilter; coverTex.magFilter = THREE.LinearFilter;
coverTex.wrapS = THREE.ClampToEdgeWrapping; coverTex.wrapT = THREE.ClampToEdgeWrapping;

var coverEdgeTex = new THREE.Texture();  // R=depth, G=edge, B=fg-mask, A=lum
coverEdgeTex.minFilter = THREE.LinearFilter; coverEdgeTex.magFilter = THREE.LinearFilter;

// 初始 1×1 像素
(function(){
  var c = document.createElement('canvas'); c.width = c.height = 4;
  var x = c.getContext('2d'); x.fillStyle = '#1c1c28'; x.fillRect(0,0,4,4);
  coverTex.image = c; coverTex.needsUpdate = true;
  var d = document.createElement('canvas'); d.width = d.height = 4;
  var dx = d.getContext('2d'); dx.fillStyle = 'rgba(128,0,0,255)'; dx.fillRect(0,0,4,4);
  coverEdgeTex.image = d; coverEdgeTex.needsUpdate = true;
})();

// 前一首封面纹理 (用于切歌渐变)
var prevCoverTex = new THREE.Texture();
prevCoverTex.minFilter = THREE.LinearFilter; prevCoverTex.magFilter = THREE.LinearFilter;
(function(){
  var c = document.createElement('canvas'); c.width = c.height = 4;
  var x = c.getContext('2d'); x.fillStyle = '#1c1c28'; x.fillRect(0,0,4,4);
  prevCoverTex.image = c; prevCoverTex.needsUpdate = true;
})();

var uniforms = {
  uTime:       { value: 0 },
  uBass:       { value: 0 },
  uMid:        { value: 0 },
  uTreble:     { value: 0 },
  uBeat:       { value: 0 },
  uKick:       { value: 0 },           // 低频鼓点能量 (kick band), 驱动点云炸开
  uSection:    { value: 0 },           // 持续高能量/副歌强度，主歌克制、副歌释放
  uEnergy:     { value: 0 },
  uBurstAmt:   { value: 0 },          // 通用预设切换脉冲 0..1
  uVinylSpin:  { value: 0 },
  uPreset:     { value: 0 },
  uIntensity:  { value: 0.85 },
  uDepth:      { value: 1.0 },
  uPointScale: { value: 1.0 },
  uSpeed:      { value: 1.0 },
  uTwist:      { value: 0 },
  uColorBoost: { value: 1.1 },
  uScatter:    { value: 0 },
  uCoverRes:   { value: 1.0 },
  uBgFade:     { value: 0.20 },
  uBloomStrength:{ value: 0.62 },
  uBloomSize:  { value: 2.65 },
  uTintColor:  { value: new THREE.Color('#9db8cf') },
  uTintStrength:{ value: 0 },
  uCoverTex:   { value: coverTex },
  uPrevCoverTex:{ value: prevCoverTex },
  uColorMixT:  { value: 1.0 },        // 0=显示旧封面 → 1=显示新封面
  uCoverMorph: { value: 0.0 },        // 切歌时旧封面解体、随后聚合为新封面
  uEdgeTex:    { value: coverEdgeTex },
  uRippleTex:  { value: rippleTex },
  uRippleCount:{ value: 0 },
  uDotTex:     { value: dotTexture },
  uHasCover:   { value: 0 },
  uHasDepth:   { value: 0 },
  uEdgeEnabled:{ value: 1 },
  uAiBoost:    { value: 0 },          // AI 深度增益, 当 AI 接管时升至 1
  uMouseXY:    { value: new THREE.Vector2(-999, -999) },
  uMouseActive:{ value: 0 },
  uHandXY:     { value: new THREE.Vector2(-999, -999) },
  uHandActive: { value: 0 },
  uGestureGrip:{ value: 0 },
  uPixel:      { value: renderer.getPixelRatio() },
  uAlpha:      { value: 0 },          // 整体粒子透明度 (启动 fade-in)
  uParticleDim:{ value: 1 },          // 覆盖层打开时只压低粒子背景, 不影响 3D 卡片
  uFloatAlpha: { value: 0 },          // 空场/浮空粒子透明度
  uLoading:    { value: 0 },          // 加载动画混合度 0..1 (1 = 完全聚成圆环)
};
installRenderPowerHooks();
applyRendererPowerMode();

// ----- 顶点 Shader -----
//   v7.1: 律动幅度 ×2.5, Tunnel 自旋, 虚空预设, 切歌颜色渐变
var vs = `
precision highp float;
uniform float uTime, uBass, uMid, uTreble, uBeat, uEnergy, uBurstAmt;
uniform float uKick;
uniform float uSection;
uniform float uPreset, uIntensity, uDepth, uPointScale, uSpeed, uTwist;
uniform float uVinylSpin;
uniform float uColorBoost, uScatter, uCoverRes, uBgFade;
uniform float uHasCover, uHasDepth, uEdgeEnabled, uAiBoost;
uniform float uMouseActive, uPixel, uColorMixT, uCoverMorph, uLoading;
uniform sampler2D uCoverTex, uPrevCoverTex, uEdgeTex, uRippleTex;
uniform int uRippleCount;
uniform vec2 uMouseXY, uHandXY;
uniform float uHandActive, uGestureGrip;
uniform vec3 uTintColor;
uniform float uTintStrength;
attribute vec2 aUv;
attribute float aRand;
varying vec3 vColor;
varying float vBright, vRipple, vEdgeBoost, vAlpha, vSourceLum;

#define PI 3.14159265359

vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289v(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 perm(vec4 x){return mod289v(((x*34.0)+1.0)*x);}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=perm(perm(perm(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=inversesqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

float hash11(float p) {
  return fract(sin(p * 127.1) * 43758.5453123);
}

vec2 safeCoverUv(vec2 uv) {
  return clamp(uv, vec2(0.0012), vec2(0.9988));
}

vec3 sampleNewCoverColor(vec2 uv) {
  return texture2D(uCoverTex, safeCoverUv(uv)).rgb;
}

vec3 samplePrevCoverColor(vec2 uv) {
  return texture2D(uPrevCoverTex, safeCoverUv(uv)).rgb;
}

vec4 sampleEdgeColor(vec2 uv) {
  return texture2D(uEdgeTex, safeCoverUv(uv));
}

float rippleSumAt(vec2 p, out float maxAmp) {
  float sum = 0.0; maxAmp = 0.0;
  for (int ri = 0; ri < 12; ri++) {
    if (ri >= uRippleCount) break;
    float vCoord = (float(ri) + 0.5) / 12.0;
    vec4 rd = texture2D(uRippleTex, vec2(0.5, vCoord));
    float age = rd.z; float str = rd.w;
    if (str < 0.005 || age < 0.0 || age > 2.0) continue;
    float dx = p.x - rd.x, dy = p.y - rd.y;
    float dist = sqrt(dx*dx + dy*dy);
    float lifeN = age / 2.0;
    float fadeIn  = smoothstep(0.0, 0.06, age);
    float fadeOut = 1.0 - smoothstep(0.7, 1.0, lifeN);
    float env = fadeIn * fadeOut;
    // v7.1: 把幅度放大 — 中心凸起更高更宽
    float bulgeW = 0.55 + age * 0.80;
    float bulge  = exp(-dist*dist / (2.0 * bulgeW * bulgeW)) * (1.0 - smoothstep(0.0, 0.55, lifeN));
    float waveR  = age * 2.10;
    float ringW  = 0.40 + age * 0.22;
    float ring   = exp(-pow((dist - waveR) / ringW, 2.0));
    // v7.1: 提升整体幅度 ×2
    float local  = (bulge * 2.4 + ring * 1.30) * env * str;
    sum += local;
    maxAmp = max(maxAmp, abs(local));
  }
  return sum;
}

void main(){
  float t = uTime * uSpeed;
  vec3 pos;
  vec2 sampleUv = safeCoverUv(aUv);
  // 切歌颜色渐变: 在新旧封面间 mix
  vec3 newCol = sampleNewCoverColor(sampleUv);
  vec3 prevCol = samplePrevCoverColor(sampleUv);
  vec3 coverColor = mix(prevCol, newCol, clamp(uColorMixT, 0.0, 1.0));
  vec4 edge = sampleEdgeColor(sampleUv);
  float depthVal = edge.r;
  float edgeVal  = edge.g;
  float fgMask   = edge.b;
  float lumVal   = edge.a;
  float maxRippleAmp = 0.0;
  float rippleZ = 0.0;

  vec3 defaultColor = mix(
    vec3(0.36, 0.28, 0.72),
    mix(vec3(0.85, 0.55, 0.95), vec3(0.45, 0.78, 0.95), aUv.x),
    aUv.y
  );
  vColor = mix(defaultColor, coverColor, uHasCover);
  vAlpha = 1.0;

  // 律动强度的真实倍数：主歌略收、持续高能量/副歌逐步释放，保留原有粒子风格。
  float sectionEase = smoothstep(0.08, 0.86, uSection);
  float K = uIntensity * 1.6 * mix(0.72, 1.58, sectionEase);

  // ====================================================
  //  Preset 0: SILK — 丝绸 (xy 平面, z 涟漪)
  //  v7.1: 全部位移 ×2.5
  // ====================================================
  if (uPreset < 0.5) {
    pos = position;
    rippleZ = rippleSumAt(pos.xy, maxRippleAmp);

    float midN = snoise(vec3(pos.x*1.4, pos.y*1.4, t*0.55)) * 0.6
               + snoise(vec3(pos.x*2.8+5.0, pos.y*2.8-3.0, t*0.85)) * 0.4;
    float midMask = 0.55 + 0.45 * snoise(vec3(pos.x*0.4, pos.y*0.4, t*0.18));
    float midDisp = midN * uMid * 0.55 * midMask * K;       // 0.20 → 0.55

    float trebleJ = snoise(vec3(pos.x*6.5, pos.y*6.5, t*3.5 + aRand*4.0)) * uTreble * 0.18 * K;  // 0.06→0.18
    float bassBreath = snoise(vec3(pos.x*0.35, pos.y*0.35, t*0.4)) * uBass * 0.26 * K;

    // AI 深度: 显著强化 (0.85 → 1.4)
    float depthZ = (depthVal - 0.5) * uAiBoost * uDepth * 1.40 * uHasDepth;

    pos.z = rippleZ * 1.30 + midDisp + trebleJ + bassBreath + depthZ;

    // 鼓点炸开: 沿径向外扩 + 朝镜头方向弹出, 由 uBeat(瞬时脉冲) + uKick(低频鼓点) 驱动, 信号衰减时自然回弹聚合
    float kickBurst = (uBeat * 0.26 + uKick * 0.18) * K;
    float rlen = length(pos.xy) + 1e-4;
    vec2 rdir = pos.xy / rlen;
    pos.xy += rdir * kickBurst * 0.07 * (0.5 + rlen * 0.30);
    pos.z += kickBurst * 0.09;
    maxRippleAmp = max(maxRippleAmp, kickBurst * 0.12);
  }

  // ====================================================
  //  Preset 1: TUNNEL — 隧道 + 自旋
  // ====================================================
  else if (uPreset < 1.5) {
    // v7.1: 整体自旋 — 整管缓慢绕 Z 轴
    float spin = t * 0.12;
    float angle = aUv.x * 2.0 * PI + spin;
    float flow = aUv.y - t * 0.08 * (1.0 + uBass * 0.55);
    flow = fract(flow);
    float zPos = (flow - 0.5) * 9.0;
    float baseR = 2.0 - uBass * 0.08 * K;
    float ripG  = sin(angle * 5.0 + zPos * 1.4 + t * 2.2) * 0.10 * (uMid + uTreble) * K;   // 0.04→0.10
    float r = baseR + ripG;
    pos.x = cos(angle) * r;
    pos.y = sin(angle) * r;
    pos.z = zPos;

    sampleUv = vec2(aUv.x, flow);
    sampleUv = safeCoverUv(sampleUv);
    newCol = sampleNewCoverColor(sampleUv);
    prevCol = samplePrevCoverColor(sampleUv);
    coverColor = mix(prevCol, newCol, clamp(uColorMixT, 0.0, 1.0));
    vColor = mix(defaultColor, coverColor, uHasCover);

    float depthFade = smoothstep(-4.5, 4.5, zPos);
    vColor *= 0.4 + depthFade * 0.7;
  }

  // ====================================================
  //  Preset 2: ORBIT — 星球 (保留自转)
  //  v7.1: 律动幅度加大
  // ====================================================
  else if (uPreset < 2.5) {
    float theta = aUv.x * 2.0 * PI;
    float phi   = (aUv.y - 0.5) * PI;
    float baseR = 2.2;
    float trebFlare = snoise(vec3(theta * 1.5, phi * 1.5, t * 0.7)) * uTreble * 0.85 * K;   // 0.40→0.85
    float bassExpand = uBass * 0.11 * K;
    float beatExpand = (uBeat * 0.06 + uKick * 0.04) * K;                                     // 鼓点仅保留轻微空间呼吸
    float r = baseR * (1.0 + bassExpand + beatExpand) + trebFlare;

    pos.x = r * cos(phi) * cos(theta);
    pos.y = r * sin(phi);
    pos.z = r * cos(phi) * sin(theta);

    float yaw = t * 0.18;
    float cy = cos(yaw), sy = sin(yaw);
    pos.xz = mat2(cy, -sy, sy, cy) * pos.xz;
  }

  // ====================================================
  //  Preset 3: VOID — 虚空 (无粒子, 适合自定义背景)
  // ====================================================
  else if (uPreset < 3.5) {
    pos = vec3((aUv.x - 0.5) * 0.01, (aUv.y - 0.5) * 0.01, -90.0);
    vAlpha = 0.0;
    vColor = vec3(0.0);
    maxRippleAmp = 0.0;
  }

  // ====================================================
  //  Preset 4: VINYL RECORD
  //  A real record layout: circular album cover in the center, black vinyl
  //  grooves outside, and a complete white particle rim.
  // ====================================================
  else if (uPreset < 4.5) {
    float bassDrive = smoothstep(0.08, 0.78, uBass + uBeat * 0.82);
    float highDrive = smoothstep(0.05, 0.46, uTreble);
    float hiResGuard = smoothstep(1.08, 1.55, uCoverRes);
    float edgeGuard = mix(1.0, 0.38, hiResGuard);
    float depthGuard = mix(1.0, 0.44, hiResGuard);
    float grooveGuard = mix(1.0, 0.48, hiResGuard);
    float beatGuard = mix(1.0, 0.36, hiResGuard);

    vec2 p = (aUv - 0.5) * 5.12;
    float spin = uVinylSpin;
    float cs = cos(spin), sn = sin(spin);
    vec2 rp = mat2(cs, -sn, sn, cs) * p;
    float d = length(p);
    float angle0 = atan(p.y, p.x);
    float recordR = 2.46;
    float coverR = 1.18;
    float recordAlpha = 1.0 - smoothstep(recordR - 0.02, recordR + 0.05, d);
    float coverMask = 1.0 - smoothstep(coverR - 0.012, coverR + 0.018, d);
    float border = exp(-pow((d - coverR) / 0.064, 2.0)) * edgeGuard;
    float outerRim = exp(-pow((d - (recordR - 0.050)) / 0.055, 2.0)) * edgeGuard;
    float vinylN = clamp((d - coverR) / max(0.001, recordR - coverR), 0.0, 1.0);

    pos = vec3(rp * (1.0 + bassDrive * 0.012 * beatGuard + uBeat * 0.026 * beatGuard), 0.0);
    vAlpha = recordAlpha;

    if (coverMask > 0.02) {
      vec2 coverUv = p / (coverR * 2.0) + 0.5;
      newCol = sampleNewCoverColor(coverUv);
      prevCol = samplePrevCoverColor(coverUv);
      coverColor = mix(prevCol, newCol, clamp(uColorMixT, 0.0, 1.0));
      if (hiResGuard > 0.001) {
        vec2 sx = vec2(0.0026, 0.0);
        vec2 sy = vec2(0.0, 0.0026);
        vec3 softNew = (sampleNewCoverColor(coverUv + sx) + sampleNewCoverColor(coverUv - sx) + sampleNewCoverColor(coverUv + sy) + sampleNewCoverColor(coverUv - sy)) * 0.25;
        vec3 softPrev = (samplePrevCoverColor(coverUv + sx) + samplePrevCoverColor(coverUv - sx) + samplePrevCoverColor(coverUv + sy) + samplePrevCoverColor(coverUv - sy)) * 0.25;
        coverColor = mix(coverColor, mix(softPrev, softNew, clamp(uColorMixT, 0.0, 1.0)), hiResGuard * 0.42);
      }
      vColor = mix(defaultColor, coverColor, uHasCover);
      float coverShade = 1.02 + 0.10 * (1.0 - smoothstep(0.0, coverR, d));
      vColor *= coverShade;
      vColor = mix(vColor, vec3(1.0), border * 0.54);
      pos.z = 0.040 + border * 0.026 * depthGuard + uBeat * 0.018 * beatGuard;
      maxRippleAmp = max(maxRippleAmp, border * 0.30 + bassDrive * 0.075 * beatGuard + uBeat * 0.075 * beatGuard);
    } else {
      float groove = 0.5 + 0.5 * sin((d - coverR) * mix(98.0, 58.0, hiResGuard));
      float fineGroove = 0.5 + 0.5 * sin((d - coverR) * mix(170.0, 92.0, hiResGuard) + aRand * 3.0);
      float tick = smoothstep(0.82, 0.995, hash11(floor((angle0 + PI) * 38.0) + floor(d * 72.0) * 2.1));
      vec3 vinyl = vec3(0.052, 0.054, 0.058) + vec3(0.052 * grooveGuard) * groove + vec3(0.026 * grooveGuard) * fineGroove;
      vinyl = mix(vinyl, coverColor * 0.32, 0.18 * (1.0 - vinylN));
      float whiteRing = max(border * 0.92, outerRim * 0.26);
      vColor = mix(vinyl, vec3(0.92, 0.94, 0.94), whiteRing);
      vColor = mix(vColor, vec3(1.0), tick * highDrive * (0.06 + border * 0.12) * grooveGuard);
      pos.z = groove * 0.010 * grooveGuard + border * 0.024 * depthGuard + bassDrive * vinylN * 0.016 * K * beatGuard + tick * highDrive * 0.010 * grooveGuard;
      maxRippleAmp = max(maxRippleAmp, border * 0.32 + outerRim * 0.12 + bassDrive * vinylN * 0.11 * beatGuard + tick * highDrive * 0.10 * grooveGuard + uBeat * vinylN * 0.08 * beatGuard);
    }
  }

  // ====================================================
  //  Preset 5: WALLPAPER PULSE
  //  Layered music-particle wallpaper: aurora ribbons, depth sparks,
  //  and cover-colored audio flow.
  // ====================================================
  else {
    float bassGlow = smoothstep(0.07, 0.78, uBass) * 0.34 + uBeat * 0.014;
    float midGlow = smoothstep(0.07, 0.62, uMid) * 0.42;
    float highGlow = smoothstep(0.04, 0.46, uTreble) * 0.46;
    float lane = aUv.y;
    float transition = clamp(uBurstAmt, 0.0, 1.0);

    if (lane < 0.80) {
      float laneWarp = snoise(vec3(aUv.x * 0.42, lane * 1.7, t * 0.026)) * 0.11 + (hash11(aRand * 73.1) - 0.5) * 0.045;
      float warpedLane = clamp(lane + laneWarp, 0.0, 0.80);
      float bandCoord = warpedLane / 0.80 * 5.65 + snoise(vec3(aUv.x * 0.82, lane * 2.25, t * 0.032)) * 0.62;
      float band = floor(bandCoord);
      float local = fract(bandCoord + hash11(band * 9.13 + aRand * 2.4) * 0.18);
      float bandN = clamp((band + 0.5) / 5.65, 0.0, 1.0);
      float seed = hash11(band * 19.17 + aRand * 31.0);
      float flow = fract(aUv.x + t * (0.0034 + bandN * 0.0038 + seed * 0.0022) + seed * 0.53);
      float arc = (flow - 0.5) * PI * (1.35 + bandN * 0.72 + seed * 0.24);
      float armCurve = sin(arc + bandN * 2.2 + seed * 5.3);
      float spiralRadius = 9.2 + bandN * 11.8 + seed * 6.0 + local * 2.9;
      float x = cos(arc * 0.72 + bandN * 0.92 + seed * 1.3) * spiralRadius + (flow - 0.5) * (13.5 + bandN * 9.5);
      float ribbonPhase = flow * PI * 2.0 * (0.55 + bandN * 0.24 + seed * 0.10) + t * (0.010 + bandN * 0.007) + seed * 5.7;
      float broadWave = sin(ribbonPhase) * 0.92;
      float fineWave = sin(ribbonPhase * (1.36 + seed * 0.62) - t * 0.044 + seed * 5.0) * 0.045;
      float yBase = (bandN - 0.5) * 13.2 + armCurve * (2.3 + bandN * 1.6) + (seed - 0.5) * 1.85 + snoise(vec3(bandN * 2.0, flow * 0.62, seed)) * 0.92;
      float ridgeCenter = 0.43 + (seed - 0.5) * 0.18;
      float ridge = exp(-pow((local - ridgeCenter) / (0.25 + seed * 0.04), 2.0));
      float softMask = smoothstep(0.010, 0.12, lane) * (1.0 - smoothstep(0.72, 0.81, lane));
      float ribbonNoise = snoise(vec3(flow * 1.18 + seed, bandN * 2.0, t * 0.018)) * 0.74;
      float zLayer = mix(-23.5, 15.5, bandN) + (seed - 0.5) * 6.0;

      pos.x = x + ribbonNoise * 1.40 + sin(t * 0.012 + seed * 8.0) * 0.22;
      pos.y = yBase + broadWave + fineWave + (local - 0.5) * (0.58 + ridge * 0.14);
      pos.z = zLayer + broadWave * 1.35 + ribbonNoise * 1.85;

      float pulseLine = 0.5 + 0.5 * sin(ribbonPhase * (1.7 + seed * 0.9) - t * 0.32 + seed * 6.0);
      vec3 aurora = mix(vec3(0.52, 0.86, 1.0), vec3(0.70, 0.58, 1.0), bandN);
      aurora = mix(aurora, vec3(0.96, 0.98, 0.92), bassGlow * 0.05);
      vAlpha = (0.18 + ridge * 0.78 + pulseLine * highGlow * 0.035 + bassGlow * 0.025) * softMask * (0.96 + transition * 0.02);
      vColor = mix(coverColor, aurora, 0.62 + ridge * 0.22) * (0.76 + ridge * 0.86 + pulseLine * highGlow * 0.05 + bassGlow * 0.04);
      maxRippleAmp = max(maxRippleAmp, ridge * (0.12 + midGlow * 0.05) + pulseLine * highGlow * 0.045 + bassGlow * 0.030);
    } else {
      float q = (lane - 0.80) / 0.20;
      float seed = hash11(aRand * 917.0 + floor(q * 130.0));
      float depth = mix(-32.0, 18.0, seed);
      float drift = fract(aUv.x + t * (0.0014 + seed * 0.0048) + seed * 0.63);
      float cluster = snoise(vec3(seed * 2.0, q * 3.2, t * 0.007));
      float x = (drift - 0.5) * (45.0 + seed * 22.0) + cluster * 3.4;
      float y = (hash11(aRand * 331.0 + seed * 5.0) - 0.5) * 22.0 + sin(t * (0.018 + seed * 0.028) + seed * 7.0) * 0.86;
      float z = depth + sin(t * (0.020 + seed * 0.032) + aRand * 8.0) * 1.05;
      float twinkle = pow(0.5 + 0.5 * sin(t * (0.24 + seed * 0.42) + aRand * 17.0), 5.0);
      float dust = smoothstep(0.22, 0.98, hash11(aRand * 661.0 + floor(q * 160.0)));

      pos = vec3(x, y, z);
      vAlpha = dust * (0.16 + twinkle * 0.46 + highGlow * 0.025 + bassGlow * 0.018) * (1.0 - q * 0.06);
      vColor = mix(coverColor, vec3(0.92, 0.97, 1.0), 0.62 + twinkle * 0.14) * (0.72 + twinkle * 0.62 + bassGlow * 0.025);
      maxRippleAmp = max(maxRippleAmp, twinkle * highGlow * 0.055 + dust * bassGlow * 0.030);
    }

    if (transition > 0.001) {
      float bloom = smoothstep(0.0, 1.0, transition);
      vec2 burstVec = pos.xy + vec2(hash11(aRand * 31.0) - 0.5, hash11(aRand * 47.0) - 0.5) * 0.75;
      vec2 burstDir = burstVec / max(length(burstVec), 0.001);
      pos.xy += burstDir * bloom * 0.026;
      pos.xy += vec2(snoise(vec3(aRand, t * 0.014, 1.0)), snoise(vec3(aRand, t * 0.014, 5.0))) * bloom * 0.06;
      pos.xy *= 1.0 + bloom * 0.014;
      pos.z += (hash11(aRand * 123.0) - 0.5) * bloom * 0.18;
      vAlpha *= 0.86 + bloom * 0.22;
      maxRippleAmp = max(maxRippleAmp, bloom * 0.10);
    }
  }

  // ====================================================
  //  鼠标交互 (仅 SILK)
  // ====================================================
  if (uMouseActive > 0.5 && uPreset < 0.5) {
    float mdx = pos.x - uMouseXY.x;
    float mdy = pos.y - uMouseXY.y;
    float md = sqrt(mdx*mdx + mdy*mdy);
    if (md < 1.0) {
      float push = (1.0 - md) * (1.0 - md);
      pos.z += push * 0.55;
    }
  }

  // ====================================================
  //  v8 手势遮挡 — uHandActive 是 0..1 平滑过渡, 大半径推开
  // ====================================================
  if (uHandActive > 0.01) {
    float hdx = pos.x - uHandXY.x;
    float hdy = pos.y - uHandXY.y;
    float hd = sqrt(hdx*hdx + hdy*hdy);
    float rad = 1.55;
    if (hd < rad) {
      float push = (rad - hd) / rad;
      push = push * push * uHandActive;
      pos.z += push * 1.10;
      vec2 outDir = vec2(hdx, hdy) / max(0.001, hd);
      pos.xy += outDir * push * 0.28;
    }
  }
  if (uGestureGrip > 0.001) {
    float grip = clamp(uGestureGrip, 0.0, 1.0);
    float gripWave = 0.5 + 0.5 * sin(uTime * 2.2 + aRand * 6.2831);
    pos.xy *= mix(1.0, 0.66 + gripWave * 0.035, grip);
    pos.z += grip * (0.18 + uBass * 0.22 + gripWave * 0.10);
  }

  // ====================================================
  //  通用: 离散感 / 扭曲
  // ====================================================
  if (uScatter > 0.001) {
    vec2 jdir = vec2(cos(aRand * 6.2831), sin(aRand * 6.2831));
    pos.xy += jdir * uScatter * (0.05 + uTreble * 0.10);
  }
  if (uCoverMorph > 0.001) {
    float morphSeed = hash11(aRand * 941.37 + 17.0);
    float morphAngle = aRand * 6.2831 + morphSeed * 4.2;
    vec2 morphDir = vec2(cos(morphAngle), sin(morphAngle));
    float morphReach = mix(0.24, 1.05, morphSeed) * uCoverMorph;
    pos.xy += morphDir * morphReach;
    pos.z += (morphSeed - 0.42) * uCoverMorph * 0.88;
    vAlpha *= 1.0 - uCoverMorph * 0.16;
  }
  if (uTwist > 0.001 && uPreset < 0.5) {
    float ta = uTwist * pos.z * 0.6;
    float cs = cos(ta), sn = sin(ta);
    pos.xy = mat2(cs, -sn, sn, cs) * pos.xy;
  }

  // 颜色
  float vinylHiResGuard = smoothstep(1.08, 1.55, uCoverRes) * step(3.5, uPreset) * (1.0 - step(4.5, uPreset));
  float edgeBoost = uEdgeEnabled * edgeVal * mix(1.0, 0.42, vinylHiResGuard);
  vSourceLum = dot(max(vColor, vec3(0.0)), vec3(0.299, 0.587, 0.114));
  float blackParticleGuard = 1.0 - smoothstep(0.025, 0.115, vSourceLum);
  vEdgeBoost = edgeBoost * (uPreset > 3.5 ? 0.22 : 1.0) * (1.0 - blackParticleGuard);
  vColor = pow(max(vColor, vec3(0.0)), vec3(1.0 / max(0.35, uColorBoost)));
  float edgeColorMix = edgeBoost * (uPreset > 3.5 ? 0.20 : 0.50) * (1.0 - blackParticleGuard);
  vColor = mix(vColor, vColor + vec3(0.20), edgeColorMix);
  float tintLum = max(max(vColor.r, vColor.g), vColor.b);
  vec3 tintedColor = uTintColor * max(0.24, tintLum * 1.12);
  vColor = mix(vColor, tintedColor, clamp(uTintStrength, 0.0, 1.0) * (1.0 - blackParticleGuard));

  vBright = 0.82 + maxRippleAmp * 0.55 + uBass * 0.10 + edgeBoost * 0.30 + uEnergy * 0.05 + uBurstAmt * 0.40;
  if (uPreset > 4.5) {
    vBright = 0.94 + maxRippleAmp * 0.34 + uBass * 0.020 + uEnergy * 0.026 + uBurstAmt * 0.025;
  } else if (uPreset > 3.5) {
    vBright = 0.94 + maxRippleAmp * 0.64 + uBass * 0.08 + edgeBoost * 0.12 + uEnergy * 0.05 + uBeat * 0.16 + uBurstAmt * 0.16;
  }
  vRipple = clamp(maxRippleAmp * 1.5, 0.0, 1.0);

  if (uHasDepth > 0.5 && uPreset < 0.5) {
    float bgMul = mix(1.0, 0.55, uBgFade * (1.0 - fgMask));
    vBright *= bgMul;
  }
  vBright += uGestureGrip * 0.22;
  float loadingMistSize = 1.0;

  // 加载形态: 雾状微尘流，避免廉价旋转圆环
  if (uLoading > 0.001) {
    float mistSeed = hash11(aRand * 931.7);
    float mistLayer = floor(mistSeed * 4.0);
    float layerN = (mistLayer + 0.5) / 4.0;
    float mistAngle = aRand * 6.2831 + uTime * (0.16 + mistSeed * 0.18) + snoise(vec3(aRand * 2.1, uTime * 0.24, 2.0)) * 1.85;
    float mistR = mix(1.35, 3.15, sqrt(hash11(aRand * 127.3))) * (1.0 + sin(uTime * 0.42 + aRand * 7.0) * 0.13);
    vec2 mistCurl = vec2(
      snoise(vec3(aRand * 4.1, uTime * 0.32, 3.0)),
      snoise(vec3(aRand * 4.7, uTime * 0.30, 8.0))
    );
    float mistBreath = 0.5 + 0.5 * sin(uTime * (0.82 + mistSeed * 0.55) + aRand * 17.0);
    float mistRibbon = sin(mistAngle * (1.35 + layerN * 0.55) + uTime * 0.34 + mistSeed * 4.0);
    float glowPick = smoothstep(0.88, 0.997, hash11(aRand * 1501.0 + mistLayer * 17.0));
    float dustPick = 0.34 + glowPick * 0.66;
    vec3 mistPos = vec3(
      cos(mistAngle) * mistR * (1.24 + mistCurl.x * 0.16) + mistCurl.x * 0.72,
      sin(mistAngle * 0.82 + mistRibbon * 0.25) * mistR * (0.56 + layerN * 0.10) + mistCurl.y * 0.62,
      (layerN - 0.5) * 4.85 + mistCurl.x * 0.56 + mistBreath * 0.36 + mistRibbon * 0.24
    );
    vec3 mistCol = mix(vec3(0.62, 0.86, 0.84), vec3(0.36, 0.46, 0.78), mistSeed);
    mistCol = mix(mistCol, vec3(0.94, 1.0, 0.97), glowPick * (0.45 + mistBreath * 0.35));
    vColor = mix(vColor, mistCol, uLoading * 0.78);
    vBright = mix(vBright, 0.20 + mistBreath * 0.18 + abs(mistCurl.x) * 0.06 + glowPick * (0.72 + abs(mistRibbon) * 0.24), uLoading);
    vAlpha = mix(vAlpha, 0.08 + mistBreath * 0.11 + dustPick * 0.11 + glowPick * 0.30, uLoading);
    pos = mix(pos, mistPos, uLoading);
    loadingMistSize = 1.26 + mistBreath * 0.24 + abs(mistRibbon) * 0.14 + glowPick * 0.78;
  }

  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  float depthSize = 36.0 / max(0.5, -mvPos.z);
  float audioBoost = 1.0 + maxRippleAmp * 0.7 + edgeBoost * 0.55 + uBeat * 0.08 + uBurstAmt * 0.18;
  float sz = clamp(depthSize * audioBoost, 1.05, 4.95);
  if (uPreset > 4.5) {
    float flowDrive = uBass * 0.070 + uMid * 0.046 + uTreble * 0.060 + uBurstAmt * 0.090 + uBeat * 0.015;
    sz = clamp(depthSize * (1.05 + flowDrive), 1.00, 5.45);
  } else if (uPreset > 3.5) {
    float ringDrive = uBass * 0.30 + uMid * 0.18 + uTreble * 0.22 + uBeat * 0.08;
    sz = clamp(depthSize * (0.90 + ringDrive * 0.62), 1.05, 3.90);
  }
  // 加载态下粒子稍大
  sz = mix(sz, sz * loadingMistSize, uLoading);
  gl_PointSize = sz * uPixel * uPointScale;
  gl_Position = projectionMatrix * mvPos;
}
`;

// ----- 片元 Shader -----
var fs = `
precision highp float;
uniform sampler2D uDotTex;
uniform float uAlpha, uPreset, uParticleDim;
varying vec3 vColor;
varying float vBright, vRipple, vEdgeBoost, vAlpha, vSourceLum;

void main(){
  vec4 tex = texture2D(uDotTex, gl_PointCoord);
  if (tex.a < 0.02) discard;
  vec3 col = vColor * vBright;
  col = mix(col, col * 1.3 + vec3(0.05), vEdgeBoost * 0.35);
  col = mix(col, col * 1.2, vRipple * 0.4);
  float keepBlack = 1.0 - smoothstep(0.025, 0.115, vSourceLum);
  float nonBlack = 1.0 - keepBlack;
  float dotDist = length(gl_PointCoord - vec2(0.5)) * 2.0;
  float readableRim = smoothstep(0.44, 0.94, dotDist) * (1.0 - smoothstep(0.94, 1.08, dotDist)) * tex.a;
  float outLum = dot(col, vec3(0.299, 0.587, 0.114));
  float lightParticle = smoothstep(0.50, 0.82, outLum) * nonBlack;
  float darkParticle = (1.0 - smoothstep(0.20, 0.50, outLum)) * nonBlack;
  col = mix(col, vec3(0.0), readableRim * lightParticle * 0.38);
  col = mix(col, vec3(1.0), readableRim * darkParticle * 0.20);
  col = clamp(col, vec3(0.0), vec3(1.6));
  gl_FragColor = vec4(col, tex.a * uAlpha * uParticleDim * vAlpha);
}
`;

var material = new THREE.ShaderMaterial({
  uniforms: uniforms, vertexShader: vs, fragmentShader: fs,
  transparent: true, depthWrite: false, blending: THREE.NormalBlending,
});

var bloomVs = vs
  .replace('uniform float uMouseActive, uPixel, uColorMixT, uCoverMorph, uLoading;', 'uniform float uMouseActive, uPixel, uColorMixT, uCoverMorph, uLoading, uBloomSize;')
  .replace('gl_PointSize = sz * uPixel * uPointScale;', 'gl_PointSize = sz * uPixel * uPointScale * uBloomSize;');
var bloomFs = `
precision highp float;
uniform sampler2D uDotTex;
uniform float uAlpha, uBloomStrength, uPreset, uParticleDim;
varying vec3 vColor;
varying float vBright, vRipple, vEdgeBoost, vAlpha, vSourceLum;

void main(){
  vec4 tex = texture2D(uDotTex, gl_PointCoord);
  if (tex.a < 0.01) discard;
  float soft = tex.a * tex.a;
  vec3 col = vColor * (0.55 + vBright * 0.62);
  col = mix(col, col + vec3(0.22, 0.18, 0.10), vEdgeBoost * 0.35);
  col = clamp(col, vec3(0.0), vec3(1.8));
  float pulse = 1.0 + vRipple * 0.65;
  float keepBlack = 1.0 - smoothstep(0.025, 0.115, vSourceLum);
  float bloomKeep = 1.0 - keepBlack * 0.92;
  gl_FragColor = vec4(col, soft * uAlpha * uBloomStrength * uParticleDim * pulse * 0.55 * vAlpha * bloomKeep);
}
`;
var bloomMaterial = new THREE.ShaderMaterial({
  uniforms: uniforms, vertexShader: bloomVs, fragmentShader: bloomFs,
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
});
var bloomParticles = new THREE.Points(geo, bloomMaterial);
bloomParticles.frustumCulled = false;
bloomParticles.renderOrder = 0;
scene.add(bloomParticles);
var particles = new THREE.Points(geo, material);
particles.frustumCulled = false;
particles.renderOrder = 1;
scene.add(particles);
console.log('v7 shell loaded, JS pending');

// ============================================================
//  浮空粒子层 (独立 Points)
//   v7.1: 速度大幅放慢, 改用 sin/cos 长周期漂移 (优雅而非乱飞)
// ============================================================
var FLOAT_COUNT = 1300;
var floatGroup = null;
var floatPositionsArr = null, floatBaseArr = null, floatPhaseArr = null, floatColorArr = null;




// ============================================================
//  安魂 — 3D 粒子建模层
// ============================================================
var SKULL_PRESET_INDEX = 6;
var SKULL_MODEL_BASE_ROTATION_X = -0.26;
var SKULL_MODEL_BASE_ROTATION_Y = 0.00;
var SKULL_MODEL_SCALE = 2.34;
var SKULL_MODEL_BASE_POSITION = { x: 0, y: 0.22, z: 0.10 };
var skullAmpPulse = 0;
var skullBeatFlash = 0;
var skullJawOpen = 0;
var skullCameraBlend = 0;
var skullWheelZoom = 0;
var skullWheelZoomTarget = 0;
var skullCameraTargetPos = new THREE.Vector3();
var skullCameraTargetLook = new THREE.Vector3();
var skullCameraBasePos = new THREE.Vector3();
var skullCameraBaseLook = new THREE.Vector3();
var skullCameraShelfPos = new THREE.Vector3();
var skullCameraShelfLook = new THREE.Vector3();
var skullCameraMixedLook = new THREE.Vector3();
var skullShelfCameraMix = 0;
var skullLyricMouthLocal = new THREE.Vector3(0.025, -0.72, 0.62);
var skullLyricMouthTarget = new THREE.Vector3();
var skullLyricMouthForward = new THREE.Vector3();
var skullLyricMouthQuat = new THREE.Quaternion();
var skullLyricReadableQuat = new THREE.Quaternion();
var skullParticleGroup = null;
var skullParticleOpacity = 0;
var skullParticleAsset = { data: null, promise: null, failed: false };
var skullBaseColors = {
  boneA: new THREE.Color('#b8ae98'),
  boneB: new THREE.Color('#fff4d8'),
  shadow: new THREE.Color('#100d0d'),
  light: new THREE.Color('#ffe3a0'),
  neutralBoneA: new THREE.Color('#9fb7c8'),
  neutralBoneB: new THREE.Color('#eef9ff'),
  neutralShadow: new THREE.Color('#070b12'),
  neutralLight: new THREE.Color('#d6f3ff')
};
var skullTintScratch = {
  tint: new THREE.Color(),
  soft: new THREE.Color(),
  bright: new THREE.Color(),
  dark: new THREE.Color(),
  boneA: new THREE.Color(),
  boneB: new THREE.Color(),
  shadow: new THREE.Color(),
  light: new THREE.Color()
};




















// ============================================================
//  封面背面粒子层 (v7.2)
//   - 独立 Points, 放在 z=-1.5 (主封面平面背面)
//   - 颜色取自封面镜像 UV
//   - 慢呼吸 + 小幅 noise 漂移
//   - 跟主粒子同步旋转 (在主循环里赋值)
//   - 视角转到背面才能看到 — 不需要手动控制 visible
// ============================================================
var BACK_COVER_COUNT = 3000;
var backCoverGroup = null;
var backCoverColorArr = null;










// ============================================================
//  舞台歌词系统 v9 — Three.js 文字平面, 跟随专辑粒子 3D 运动
// ============================================================
var stageLyrics = {
  group: null,
  current: null,
  outgoing: [],
  currentIdx: -1,
  currentText: '',
  highBloom: 0,
  beatGlow: 0,
  glowFollowX: 0,
  glowFollowY: 0,
  glowFollowRoll: 0,
  palette: {
    primary: '#d6f8ff',
    secondary: '#9cffdf',
    highlight: '#eef7ff',
    shadow: 'rgba(2,8,12,0.42)',
    glow: 'rgba(143,233,255,0.34)',
  },
  coverPalette: {
    primary: '#d6f8ff',
    secondary: '#9cffdf',
    highlight: '#eef7ff',
    shadow: 'rgba(2,8,12,0.42)',
    glow: 'rgba(143,233,255,0.34)',
  },
  starRiver: null,
  starRiverWidth: 4.2,
  starRiverHeight: 0.58,
  lockFitScale: 1,
  snapCameraLockFrames: 0,
};
var lyricSunColor = new THREE.Color(0xffe6a4);
var lyricSunHotColor = new THREE.Color(0xfff4cc);
var lyricCameraDir = new THREE.Vector3();
var lyricCameraRight = new THREE.Vector3();
var lyricCameraUp = new THREE.Vector3();
var lyricCameraTarget = new THREE.Vector3();
var lyricLayoutBase = new THREE.Vector3();
var lyricLayoutTarget = new THREE.Vector3();
var lyricCoverWorldPos = new THREE.Vector3();
var lyricCoverWorldQuat = new THREE.Quaternion();
var lyricBaseEuler = new THREE.Euler(0, 0, 0, 'YXZ');
var lyricTiltEuler = new THREE.Euler(0, 0, 0, 'YXZ');
var lyricBaseQuat = new THREE.Quaternion();
var lyricTiltQuat = new THREE.Quaternion();
var lyricTargetQuat = new THREE.Quaternion();
var LYRIC_CAMERA_LOCK_MAX_SCALE = 0.80;





// 兼容旧变量名以便其它代码不破坏
var lyricsParticles = null;
var lyricsGeo = null;

// 三个 attribute: 源位置(随机扩散态), 目标位置(组成字), color, brightness
var lyricsAttrTargetA = null;
var lyricsAttrTargetB = null;
var lyricsAttrSeed = null;



















































var CUSTOM_BG_DB_NAME = 'mineradio-custom-background-v1';
var CUSTOM_BG_STORE = 'media';
var customBgObjectUrl = '';
var customBgApplyToken = 0;



var colorLabState = { picker: null, id: '', h: 0, s: 1, v: 1, dragging: false };
var COLOR_LAB_PRESETS = [
  { name: '极黑', color: '#000000' },
  { name: '极白', color: '#ffffff' },
  { name: '克莱因蓝', color: '#002fa7' },
  { name: '法拉利红', color: '#f00000' },
  { name: '香槟金', color: '#c8a96a' },
  { name: '孔雀绿', color: '#006b5b' },
  { name: '午夜紫', color: '#2b164f' },
  { name: '银雾', color: '#d9dde2' }
];












window.addEventListener('resize', function(){
  if (window.requestAnimationFrame) requestAnimationFrame(repositionFxFloatingPanels);
  else repositionFxFloatingPanels();
});

























var STAGE_LYRIC_MAX_LINES = 1;







var lyricSunBloomTexture = null;






















// ============================================================
//  涟漪触发系统 — 3×3 九宫格 + bass 上升沿
// ============================================================
var rippleIdx = 0;
var lastRippleAt = 0;
var lastBassRising = false;
var BASS_THRESHOLD = 0.45;
var RIPPLE_COOLDOWN = 0.75;

var regions = [];
for (var ry = 0; ry < 3; ry++) for (var rx = 0; rx < 3; rx++) {
  regions.push({
    x: (rx / 2 - 0.5) * PLANE_SIZE * 0.72,
    y: (ry / 2 - 0.5) * PLANE_SIZE * 0.72,
  });
}





// ============================================================
//  封面 + 边缘 + 启发式深度 处理 (CPU 端)
//   生成 256×256 RGBA 纹理: R=depth G=edge B=fg-mask A=lum
// ============================================================






// AI 深度估计 (Xenova/depth-anything-small) - 异步加载, 失败回退












// 颜色渐变 tween (切歌时旧封面→新封面)
var colorMixTween = null;


// 粒子整体透明度 tween (启动 fade-in)
var alphaTween = null;
var floatAlphaTween = null;
var IDLE_PARTICLE_ALPHA = 0;




// 加载形态 tween (uLoading 0..1)
var loadingTween = null;
var loadingShownAt = 0;
var loadingHideTimer = null;
var coverDepthTween = null;

















// ============================================================
//  离线节拍预解析 (v7.2)
//    流程: fetch 完整音频 → OfflineAudioContext.decodeAudioData
//          → 低通滤波 (只保留 60-150Hz, 即 kick 频段)
//          → 短时能量曲线 → 自适应阈值检测峰值
//          → 输出 kick 时间戳数组 (单位: 秒)
//    优点: 完全规避人声干扰; 预先准备好节奏表
//    缺点: 每首歌首次要 1-3 秒
// ============================================================






var musicTempoLoadPromise = null;


var musicTempoWorkerUrl = null;














































































// 每帧调用 — 按 beatMap 触发预演鼓点









var scheduledBeatPulse = 0;
var scheduledBeatFlag = false;






































// ============================================================
//  3D 歌单架 — 双模式 (off / side / stage)
//   - side:   现版本精修, 右侧 5 张卡微角度堆叠
//   - stage:  弧形排列, 居中, 有倒影, 当前卡片"呼吸+光环"
//             卡片间粒子穿梭, 切歌时飞出动画
// ============================================================
var shelfPinnedOpen = false;
var shelfManager = null;
var shelfOpenAnimAt = -10;
var shelfHoverCue = { target: 0, value: 0, x: 0, y: 0, lastAt: 0, enteredAt: 0, zoneActive: false, guide: false };
var shelfVisibility = 0;  // 0..1, 侧栏自动隐藏的整体透明度系数





















shelfManager = makeShelfManager();

var deferredShelfRebuild = { raf: 0, reason: '', asyncCards: true, token: 0 };






function clearTransientUiOnPointerExit() {
  clearShelfPreviewOnPointerExit();
  var panel = document.getElementById('playlist-panel');
  if (panel && !playlistPanelPinned && (panel.classList.contains('peek') || panel.classList.contains('show'))) {
    setPeek(panel, false, 'pl');
    if (typeof setFocusZone === 'function') setFocusZone(null, true);
  }
}

window.addEventListener('blur', clearTransientUiOnPointerExit);
document.addEventListener('mouseleave', clearTransientUiOnPointerExit);
document.addEventListener('mouseout', function(e) {
  if (!e.relatedTarget && !e.toElement) clearTransientUiOnPointerExit();
});

// ============================================================
//  二级内容框 (歌单内的歌曲列表) — 同样 PSP 风格滚动
// ============================================================






// ============================================================
//  3D 卡片交互 - PSP 风格
//   - 滚轮: 滚动 center 卡 (一级或二级)
//   - 点击 center 卡: 打开内容框 (歌单) 或 播放 (队列)
//   - 点击两侧卡: 滚到那张
//   - ESC: 关闭内容框
// ============================================================





renderer.domElement.addEventListener('click', function(e){
  if (!shelfManager || shelfManager.getMode() === 'off') return;
  if (document.body.classList.contains('splash-active')) return;
  if (isPointerOverUi(e)) return;
  if (mouseDownAt.hadDrag) { mouseDownAt.hadDrag = false; return; }

  var rc = raycasterFromPointerEvent(e);
  var mode = shelfManager.getMode();
  var canInteract = shelfManager.canInteract && shelfManager.canInteract();

  // 优先二级内容框
  if (shelfManager.hasOpenContent()) {
    var cl = shelfManager.getContentList && shelfManager.getContentList();
    if (cl) {
      var rowHit = cl.raycastRows(rc);
      if (!rowHit && cl.pickRowAtScreen) rowHit = cl.pickRowAtScreen(e.clientX, e.clientY);
      if (rowHit) {
        if (cl.pulseRow) cl.pulseRow(rowHit.row, 0.72);
        var selectedRow = Math.abs(rowHit.row.index - cl.getCenterIdx()) < 0.5;
        var rowIsPodcastRadio = !!(rowHit.row.song && rowHit.row.song.type === 'podcast-radio');
        var hitLikeButton = rowHit.uv && rowHit.uv.x > 0.61 && rowHit.uv.x < 0.68 && rowHit.uv.y > 0.20 && rowHit.uv.y < 0.82;
        var hitCollectButton = rowHit.uv && rowHit.uv.x >= 0.68 && rowHit.uv.x < 0.75 && rowHit.uv.y > 0.20 && rowHit.uv.y < 0.82;
        var hitNextButton = rowHit.uv && rowHit.uv.x >= 0.75 && rowHit.uv.x < 0.82 && rowHit.uv.y > 0.20 && rowHit.uv.y < 0.82;
        var hitPlayButton = rowHit.uv && rowHit.uv.x >= 0.82 && rowHit.uv.y > 0.20 && rowHit.uv.y < 0.82;
        var screenAction = (!rowHit.uv && cl.rowActionAtScreen) ? cl.rowActionAtScreen(rowHit.row, e.clientX, e.clientY) : null;
        hitLikeButton = hitLikeButton || screenAction === 'like';
        hitCollectButton = hitCollectButton || screenAction === 'collect';
        hitNextButton = hitNextButton || screenAction === 'next';
        hitPlayButton = hitPlayButton || screenAction === 'play';
        // 详情页支持直接点歌曲播放；红心/收藏按钮仍然保留原动作。
        if (selectedRow && !rowIsPodcastRadio && hitLikeButton) {
          toggleLikeDetailSong(rowHit.row.song);
        } else if (selectedRow && !rowIsPodcastRadio && hitCollectButton) {
          collectDetailSong(rowHit.row.song);
        } else if (selectedRow && !rowIsPodcastRadio && hitNextButton) {
          queueDetailSongNext(rowHit.row.song);
        } else if ((rowHit.row.song && rowHit.row.song.id) || rowIsPodcastRadio || (selectedRow && hitPlayButton)) {
          cl.playRow(rowHit.row);
        } else {
          // 滚到这行
          cl.scrollBy(rowHit.row.index - cl.getCenterIdx());
        }
        return;
      }
      var returnHit = shelfManager.raycastCards(rc);
      safeShelfCloseContent('shelf-card-return');
      if (mode === 'side') setShelfPinnedOpen(true, true);
      if (returnHit && returnHit.card) {
        shelfManager.scrollBy(returnHit.card.index - shelfManager.getCenterIdx());
      }
      return;
    }
  }

  // 一级卡片
  var hit = pointerCardHit(rc, e, mode === 'side' && !shelfPinnedOpen && shelfAlwaysVisible() ? 18 : undefined);
  if (mode === 'side' && !shelfPinnedOpen && !canUseSideShelfWithoutPinnedOpen()) return;

  if (hit) {
    if (mode === 'side') setShelfPinnedOpen(true, true);
    var idx = hit.card.index;
    if (Math.abs(idx - shelfManager.getCenterIdx()) < 0.5) {
      if (isShelfPlaylistPlayHit(hit) && shelfManager.playPlaylistAt && shelfManager.playPlaylistAt(idx)) return;
      shelfManager.openContent(idx);
    } else {
      shelfManager.scrollBy(idx - shelfManager.getCenterIdx());
    }
  } else if (mode === 'side' && shelfPinnedOpen) {
    setShelfPinnedOpen(false, true);
  }
});

// 滚轮: 在真实卡片或右侧窄热区内滚卡片; 否则保留给封面粒子/视角
//   side 模式: 常驻不再用半屏预览区接管滚轮
//   stage 模式: 鼠标 y > 60% 屏幕高
//   shift + wheel: 强制滚卡片
var wheelOverShelf = false;
renderer.domElement.addEventListener('wheel', function(e){
  if (isPointerOverUi(e)) return;
  if (!shelfManager || shelfManager.getMode() === 'off') return;
  markRenderInteraction('shelf-wheel', 900);
  var rc = raycasterFromPointerEvent(e);
  // 二级框打开时, 只有真正命中详情行才接管滚轮
  if (shelfManager.hasOpenContent()) {
    var cl = shelfManager.getContentList();
    if (cl) {
      var rowHit = cl.raycastRows(rc);
      var panelHit = !rowHit && cl.raycastPanel ? cl.raycastPanel(rc) : null;
      var panelScreenHit = !rowHit && !panelHit && cl.screenContainsPanel ? cl.screenContainsPanel(e.clientX, e.clientY) : false;
      if (!rowHit && !panelHit && !panelScreenHit) return;
      e.preventDefault(); e.stopImmediatePropagation();
      cl.scrollBy(e.deltaY > 0 ? 1 : -1);
      return;
    }
  }
  var mode = shelfManager.getMode();
  var inShelfArea = false;
  var canScrollShelf = shelfManager.canInteract && shelfManager.canInteract();
  var shelfPreviewActive = shelfAutoHiddenInputReady();
  var cardWheelHit = canScrollShelf ? pointerCardHit(rc, e, mode === 'side' && !shelfPinnedOpen && shelfAlwaysVisible() ? 18 : undefined) : null;
  if (canScrollShelf && e.shiftKey && (mode !== 'side' || shelfPinnedOpen || shelfPreviewActive || shelfAlwaysVisible())) inShelfArea = true;
  else if (canScrollShelf && mode === 'side') {
    if (shelfPinnedOpen) inShelfArea = isShelfWheelZone(e) || !!cardWheelHit;
    else if (shelfAlwaysVisible()) inShelfArea = !!cardWheelHit;
    else if (shelfPreviewActive) inShelfArea = isShelfWheelZone(e) || !!cardWheelHit;
  }
  else if (canScrollShelf && mode === 'stage' && cardWheelHit) inShelfArea = true;
  if (inShelfArea) {
    e.preventDefault();
    e.stopImmediatePropagation();
    shelfManager.scrollBy(e.deltaY > 0 ? 1 : -1);
  }
}, { passive: false, capture: true });

// 键盘 / 全局事件


document.addEventListener('keydown', function(e){
  consumeFreeCameraKeyEvent(e, true);
}, true);
document.addEventListener('keyup', function(e){
  consumeFreeCameraKeyEvent(e, false);
}, true);
document.addEventListener('keydown', function(e){
  if (isTypingTarget(e.target)) return;
  markRenderInteraction('keyboard', 700);
  if (e.code === 'KeyK') {
    e.preventDefault();
    if (freeCamera && (freeCamera.active || freeCamera.locked)) resetFreeCameraToDefault();
    else {
      recenterCamera();
      showToast('镜头已回正');
    }
    return;
  }
  if (!shelfManager) return;
  if (e.code === 'BracketRight' || e.code === 'PageDown') shelfManager.next();
  else if (e.code === 'BracketLeft' || e.code === 'PageUp') shelfManager.prev();
});
window.addEventListener('blur', function(){
  if (freeCamera && freeCamera.keys) freeCamera.keys = {};
});

// ============================================================
//  API 助手
// ============================================================






















































































var homeWallpaperPrewarmStarted = false;






















document.addEventListener('click', function(e) {
  if (!isHomeBlankDismissClick(e)) return;
  e.preventDefault();
  e.stopPropagation();
  dismissHomePage({ reason: 'blank-click' });
}, true);









var trackDetailSeq = 0;
var detailArtistSongs = [];












































































// ============================================================
//  搜索
// ============================================================
var searchTimer = null;
var searchRequestSeq = 0;
var searchLastResultQuery = '';
var SEARCH_HISTORY_STORE_KEY = 'mineradio-search-history';
var $input = document.getElementById('search-input');
var $results = document.getElementById('search-results');
var $loading = document.getElementById('loading-overlay');

if (window.MutationObserver && $results) {
  new MutationObserver(syncSearchAreaResultState).observe($results, { childList: true, attributes: true, attributeFilter: ['class'] });
}























$input.addEventListener('input', function(){
  clearTimeout(searchTimer);
  var q = $input.value.trim();
  if (!q) {
    if (searchMode === 'podcast') loadPodcastHot();
    else renderSearchHistory();
    return;
  }
  if (isMusicSearchMode(searchMode)) {
    $results.innerHTML = '<div class="search-empty">正在搜索 “' + escHtml(q) + '”…</div>';
    $results.classList.add('show');
  }
  searchTimer = setTimeout(function(){ doSearch(q); }, 180);
});
$input.addEventListener('focus', function(){
  var searchArea = document.getElementById('search-area');
  if (searchArea) setPeek(searchArea, true, 'search');
  if (!$input.value.trim() && isMusicSearchMode(searchMode)) renderSearchHistory();
  else if ($results.children.length > 0) $results.classList.add('show');
  else if (searchMode === 'podcast') loadPodcastHot();
});
var searchBoxEl = document.getElementById('search-box');
if (searchBoxEl) {
  searchBoxEl.addEventListener('click', function(){
    if ($input) $input.focus();
  });
}
$input.addEventListener('keydown', function(e){
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(searchTimer);
    var q = $input.value.trim();
    if (isMusicSearchMode(searchMode) && q && playlist.length && searchLastResultQuery === searchResultKey(q)) $results.classList.add('show');
    else doSearch(q, { autoPlayFirst: false });
  } else if (e.key === 'Escape') {
    clearTimeout(searchTimer);
    $input.blur();
    clearSearchResults();
    if (!emptyHomeActive) setPeek(document.getElementById('search-area'), false, 'search');
  }
});
$results.addEventListener('click', function(e){
  var clearBtn = e.target && e.target.closest ? e.target.closest('[data-clear-history]') : null;
  if (clearBtn) {
    e.preventDefault();
    e.stopPropagation();
    clearSearchHistory();
    return;
  }
  var item = e.target && e.target.closest ? e.target.closest('[data-history-query]') : null;
  if (item) {
    e.preventDefault();
    e.stopPropagation();
    runSearchHistory(item.getAttribute('data-history-query') || '');
  }
});
document.addEventListener('click', function(e){
  var searchArea = document.getElementById('search-area');
  if (!searchArea.contains(e.target)) {
    $results.classList.remove('show');
    if (!emptyHomeActive) setPeek(searchArea, false, 'search');
  }
});
if (!WALLPAPER_SURFACE) updateSearchModeTabs();










var SEARCH_ORIGINAL_ARTIST_HINTS = [
  { titles: ['日落大道'], artists: ['梁博'] },
  { titles: ['beautyandabeat', 'beauty and a beat'], artists: ['justin bieber', 'nicki minaj'] }
];










// ============================================================
//  音频上下文 & 频谱分析
// ============================================================






















trackCrossfadeMs = readTrackCrossfadeMs();
























// ============================================================
//  播放队列
// ============================================================









var firstPlayDone = false;






var sourceFallbackNoticeTimer = null;



































































if (!WALLPAPER_SURFACE) updatePlayModeButton(false);

var controlGlassState = { key: '', searchBoxKey: '', searchPillKey: '' };














// ============================================================
//  歌词
// ============================================================













// ============================================================
//  播放列表面板
// ============================================================





















document.addEventListener('click', function(e){
  if (miniQueueOpen && !(e.target && e.target.closest && e.target.closest('#bottom-bar'))) closeMiniQueue();
});
if (!WALLPAPER_SURFACE) {
  bindSmoothQueueScrolling();
  bindPlaylistPanelLazyRender();
  bindPlaylistPanelInteractionHold();
  bindModalBackdropClose();
}







var playlistPanelDetailState = { key: '', loading: false, playlist: null, tracks: [], token: 0, renderLimit: PLAYLIST_DETAIL_INITIAL_RENDER };

















document.getElementById('pl-list').addEventListener('click', function(e){
  var loadMore = e.target && e.target.closest ? e.target.closest('[data-pl-load-more]') : null;
  if (loadMore) {
    e.preventDefault();
    e.stopPropagation();
    growPlaylistPanelRenderLimit();
    return;
  }
  var detailLoadMore = e.target && e.target.closest ? e.target.closest('[data-pl-detail-load-more]') : null;
  if (detailLoadMore) {
    e.preventDefault();
    e.stopPropagation();
    growPlaylistPanelDetailRenderLimit();
    return;
  }
  var detailTop = e.target && e.target.closest ? e.target.closest('[data-pl-detail-top]') : null;
  if (detailTop) {
    e.preventDefault();
    e.stopPropagation();
    scrollPlaylistPanelToTop();
    return;
  }
  var playDetail = e.target && e.target.closest ? e.target.closest('[data-pl-detail-play]') : null;
  if (playDetail) {
    e.preventDefault();
    e.stopPropagation();
    playPlaylistPanelDetail();
    return;
  }
  var artist = e.target && e.target.closest ? e.target.closest('[data-pl-detail-artist]') : null;
  if (artist) {
    e.preventDefault();
    e.stopPropagation();
    openPlaylistPanelDetailArtist(Number(artist.getAttribute('data-pl-detail-artist')));
    return;
  }
  var row = e.target && e.target.closest ? e.target.closest('[data-pl-detail-row]') : null;
  if (row) {
    e.preventDefault();
    e.stopPropagation();
    playPlaylistPanelDetailTrack(Number(row.getAttribute('data-pl-detail-row')));
    return;
  }
  var card = e.target && e.target.closest ? e.target.closest('.pl-card') : null;
  if (!card) return;
  var provider = card.getAttribute('data-playlist-provider') || 'netease';
  var pid = card.getAttribute('data-playlist-id') || '';
  openPlaylistPanelDetail(provider, pid, card.getAttribute('data-playlist-title') || '');
});
var podcastListEl = document.getElementById('podcast-list');
if (podcastListEl) {
  podcastListEl.addEventListener('click', function(e){
    if (e.target && e.target.closest && e.target.closest('[data-podcast-back]')) {
      renderMyPodcastCollections({ animate: true });
      return;
    }
    var radioCard = e.target && e.target.closest ? e.target.closest('[data-podcast-radio-id]') : null;
    if (radioCard) {
      loadPodcastRadioIntoQueue(radioCard.getAttribute('data-podcast-radio-id'), true, radioCard.getAttribute('data-podcast-title') || '');
      return;
    }
    var card = e.target && e.target.closest ? e.target.closest('[data-podcast-key]') : null;
    if (!card) return;
    openMyPodcastCollection(card.getAttribute('data-podcast-key'), card.getAttribute('data-podcast-title') || '');
  });
}





// 进度条
var progressDragState = { active: false, lastParticleAt: 0 };









var progressBar = document.getElementById('progress-bar');
progressBar.addEventListener('pointerdown', function(e){
  if (!audio || !audio.duration) return;
  progressDragState.active = true;
  progressBar.classList.add('is-dragging');
  try { progressBar.setPointerCapture(e.pointerId); } catch (err) {}
  seekFromProgressPointer(e, true);
});
progressBar.addEventListener('pointermove', function(e){
  if (!progressDragState.active) return;
  seekFromProgressPointer(e, true);
});

progressBar.addEventListener('pointerup', endProgressDrag);
progressBar.addEventListener('pointercancel', endProgressDrag);
progressBar.addEventListener('lostpointercapture', function(){ progressDragState.active = false; progressBar.classList.remove('is-dragging'); });
setInterval(function(){
  if (!audio) { updatePlaybackProgressUi(); return; }
  playbackReconcileTick++;
  if (playbackReconcileTick % 5 === 0) syncPlaybackStateFromAudioEvent('poll', audio);
  updateListenStatsTick(false);
  updatePlaybackProgressUi();
  if (audio.currentTime) updateLyricsHighlight();
}, 200);

// ============================================================
//  文件拖放
// ============================================================
document.getElementById('file-input').addEventListener('change', function(e){ handleFiles(e.target.files); e.target.value = ''; });

var dropOv = document.getElementById('drop-overlay'), dragCount = 0;
document.addEventListener('dragenter', function(e){ e.preventDefault(); dragCount++; dropOv.classList.add('show'); });
document.addEventListener('dragleave', function(e){ e.preventDefault(); dragCount--; if (dragCount<=0){ dragCount=0; dropOv.classList.remove('show'); } });
document.addEventListener('dragover',  function(e){ e.preventDefault(); });
document.addEventListener('drop', function(e){
  e.preventDefault(); dragCount = 0; dropOv.classList.remove('show');
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

// ============================================================
//  控制台 — 预设卡片 + 主滑块 + 开关 + 三态
// ============================================================
var presetMeta = [
  { name: 'emily专辑封面',  desc: '封面粒子 · 快速入场' },
  { name: '滚筒', desc: '隧道 · 沉浸感' },
  { name: '星球',  desc: '星球 · 雕塑感' },
  { name: '虚空', desc: '无粒子 · 自定义背景' },
  { name: '唱片', desc: '唱片 · 圆形封面' },
  { name: '星河', desc: '壁纸粒子 · 音乐律动' },
  { name: '安魂', desc: '骷髅·YUI7W', descHtml: '骷髅·<span class="pc-yui7w">YUI7W</span>' },
];
var presetIcons = [
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 14c3-2 5-2 8 0s5 2 8 0M3 10c3-2 5-2 8 0s5 2 8 0M3 18c3-2 5-2 8 0s5 2 8 0"/></svg>',
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>',
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7"/><path d="M5 12a7 7 0 0 0 14 0"/></svg>',
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="7"/><path d="M8.8 8.8l6.4 6.4"/></svg>',
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.4"/><path d="M16.5 5.2c2.1.9 3.4 2.4 4 4.5"/><path d="M18.8 3.2l1.5 4.8"/></svg>',
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 15c2.2-4.4 4.4-4.4 6.6 0s4.4 4.4 6.6 0S20.6 10.6 23 15"/><path d="M3 9c2.2 2.2 4.4 2.2 6.6 0s4.4-2.2 6.6 0S20.6 11.2 23 9"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/></svg>',
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.2h4v6.2h4.2v3.8H14v7.6h-4v-7.6H5.8V9.4H10z"/></svg>',
];
var presetDisplayOrder = [0, 6, 5, 4, 2, 1, 3];
var lyricColorPresets = [
  { name:'雾蓝', color:'#a9b8c8' },
  { name:'银蓝', color:'#9db8cf' },
  { name:'冰川', color:'#7ec8d8' },
  { name:'青绿', color:'#66d2b5' },
  { name:'松针', color:'#7fa894' },
  { name:'月白', color:'#d7d2c4' },
  { name:'岩金', color:'#c3ae7c' },
  { name:'琥珀', color:'#d9a45f' },
  { name:'暮粉', color:'#c78aa4' },
  { name:'玫红', color:'#d76a8d' },
  { name:'烟紫', color:'#9b83d3' },
  { name:'电紫', color:'#8d70ff' },
  { name:'靛蓝', color:'#5e78d8' },
  { name:'海蓝', color:'#3c9fe0' },
  { name:'霓青', color:'#28c5c3' },
  { name:'夜绿', color:'#245c49' },
  { name:'酒红', color:'#6d1f35' },
  { name:'墨黑', color:'#111318' },
];
var USER_FX_ARCHIVE_STORE_KEY = 'mineradio-user-fx-archives-v1';
var USER_FX_ARCHIVE_EXPORT_TYPE = 'mineradio-user-fx-archive';
var USER_FX_ARCHIVE_SCHEMA = 1;













var hadStoredUserFxArchives = hasStoredUserFxArchives();
var userFxArchives = readUserFxArchives();
if (!hadStoredUserFxArchives) {
  userFxArchives = [createPackagedDefaultUserFxArchiveSlot()];
  saveUserFxArchives();
}
var userFxArchiveEditing = -1;






























































var coverColorPickerState = { target: 'visualTint', canvas: null };





























var homeWaveTrackState = { bars: 0, smooth: [] };












var fxPanelTab = 'presets';







































var globalHotkeyListenerBound = false;

document.addEventListener('keydown', function(e){
  var hotkeyModal = document.getElementById('hotkey-modal');
  if (!hotkeyCaptureState) {
    if (hotkeyModal && hotkeyModal.classList.contains('show') && e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeHotkeySettings();
    }
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  if (e.code === 'Escape') {
    hotkeyCaptureState = null;
    renderHotkeySettings();
    return;
  }
  if (e.code === 'Backspace' || e.code === 'Delete') {
    var clearTarget = hotkeyCaptureState;
    hotkeyCaptureState = null;
    setHotkeyBinding(clearTarget.action, clearTarget.scope, '');
    return;
  }
  var combo = normalizeHotkeyEvent(e);
  if (!combo) return;
  var target = hotkeyCaptureState;
  hotkeyCaptureState = null;
  setHotkeyBinding(target.action, target.scope, combo);
}, true);




























// ============================================================
//  更新提示预览
// ============================================================








































// ============================================================
//  登录系统
// ============================================================


































var startupLoginGuideShown = false;
var loginGuideAnimating = false;
var loginGuideRaf = null;



// ============================================================
//  空场待机引导
// ============================================================
var idleGuideCanvas = null;
var idleGuideCtx = null;
var idleGuideW = 0, idleGuideH = 0, idleGuideDpr = 1;
var idleGuideParticles = [];
var idleGuideTrails = [[], [], [], []];
var idleGuideStartedAt = performance.now();
var idleGuideVisible = false;
var idleGuideLastFrameAt = performance.now();
var idleGuideDelayTimer = null;
// Keep Wallpaper as the only startup idle background.
var IDLE_GUIDE_BACKGROUND_ENABLED = false;
var idleGuideInteraction = {
  angle: 0,
  velocity: 0,
  rotX: -0.12,
  rotY: 0,
  spinX: 0,
  spinY: 0,
  zoom: 1,
  zoomTarget: 1,
  zoomPulse: 0,
  dragging: false,
  lastX: 0,
  lastY: 0,
  lastT: 0,
  pointerX: 0.5,
  pointerY: 0.5,
  pointerActive: false,
  focus: 0,
  press: 0,
  tiltX: 0,
  tiltY: 0
};





















// ============================================================
//  toast
// ============================================================
var toastTimer = null;


var visualGuideSteps = [
  {
    target: 'stage',
    kicker: '01 / Welcome',
    title: 'Mineradio 是用来听歌的视觉播放器',
    body: '它不是单纯歌单页：搜索或导入一首歌后，封面、歌词、粒子和镜头会跟着音乐一起动。'
  },
  {
    selector: '#search-box',
    kicker: '02 / Play',
    title: '从搜索或导入开始',
    body: '输入歌名、歌手或关键词即可播放；如果有本地音乐，也可以用导入入口直接放进舞台。'
  },
  {
    selector: '#bottom-bar',
    kicker: '03 / Control',
    title: '播放以后看底部控制台',
    body: '播放、切歌、进度、队列和歌词都集中在底部，先把它当作一个正常播放器使用就可以。'
  },
  {
    selector: '#user-btn',
    kicker: '04 / Account',
    title: '登录只是为了同步你的音乐库',
    body: '登录后会同步歌单、红心和播客；不登录也可以搜索和播放，不会强制卡住你。'
  },
  {
    target: 'shelf',
    kicker: '05 / Visual',
    title: '进阶视觉都放在舞台周围',
    body: '右侧 3D 歌单架和 DIY 玩家模式是进阶入口；先播放一首歌，再慢慢调视觉效果。'
  },
  {
    selector: '#diy-mode-btn',
    kicker: '06 / DIY',
    title: '高级功能在 DIY 玩家模式',
    body: '视觉控制台、上传/封面、自定义歌词、音质和更多面板都会在这里展开。'
  }
];
var visualGuideStepsDiy = [
  {
    selector: '#diy-mode-btn',
    kicker: '01 / DIY',
    title: 'DIY 玩家模式已展开',
    body: '这里可以随时切回默认模式。DIY 模式会显示完整控制台、上传、视觉面板和高级调参。'
  },
  {
    selector: '#search-box',
    kicker: '02 / Search',
    title: '搜索源和导入入口会展开',
    body: '顶部搜索支持更多来源切换，上传歌曲、封面等入口也会在 DIY 模式中显示。'
  },
  {
    selector: '#playlist-panel',
    kicker: '03 / Library',
    title: '左右侧都能打开歌单和队列',
    body: '靠近任一侧边缘都可以打开歌单/队列面板，在这里管理队列、个人歌单和播客。'
  },
  {
    selector: '#fx-panel',
    kicker: '04 / Visual Lab',
    title: '右侧是视觉控制台',
    body: '靠近右下角或点击视觉按钮，可以调节粒子、歌词、镜头、3D 歌单架和更多视觉参数。'
  },
  {
    selector: '#quality-control',
    kicker: '05 / Controls',
    title: '高级播放控制会补全',
    body: '音质、播放顺序、收藏、歌词源和更多按钮会在 DIY 模式中完整显示。'
  },
  {
    target: 'shelf',
    kicker: '06 / Shelf',
    title: '3D 歌单架支持直接打开',
    body: '右侧的 3D 歌单架会在靠近时半透明浮现，点击卡片可打开歌单，点卡片里的播放按钮可直接播放整张歌单。'
  }
];













(function bindVisualGuideSurfaceClick(){
  if (WALLPAPER_SURFACE) return;
  var guide = document.getElementById('visual-guide');
  if (guide) guide.addEventListener('click', handleVisualGuideSurfaceClick);
})();

// ============================================================
//  动态库加载
// ============================================================


// ============================================================
//  摄像头 / 手势 v8 — 仅保留手势, 头部追踪已下线
//   - 21 个关键点用 EMA 平滑滤波, 消除抖动
//   - 食指尖 + 手掌中心 共同推开粒子 (真实手感, 不再是单点小球)
//   - 在 hand-canvas 上画出手掌骨架, 视觉跟随手
//   - 捏合 = 拖动旋转封面 (Y 反向修正)
//   - 没有挥扫 / 没有手势切歌
// ============================================================
     // stub: 兼容旧调用
      // stub

var gestureVideo = null, gestureCamera = null, gestureHands = null;
var gestureActive = false;
// 21 个关键点的平滑缓存 (EMA): [{x,y}, ...]
var handLmSmooth = null;
var handLmLastSeen = 0;
// 捏合状态
var pinchState = { active:false, lastX:0, lastY:0, lastT:0 };
// 物理旋转: 给 particles 一个角速度, 每帧衰减
var particleSpin = { vx: 0, vy: 0, damping: 0.90 };
// 手势驱动的总旋转 (累计角度), 输出到 particles
var gestureRotation = { x: 0, y: 0 };
var gestureGrip = { value: 0, target: 0, openness: 1, lastState: 'open', pulse: 0 };
var PARTICLE_POINTER_SPIN_X = 0.0032;
var PARTICLE_POINTER_SPIN_Y = 0.0034;
var PARTICLE_HAND_SPIN_X = 4.15;
var PARTICLE_HAND_SPIN_Y = 4.30;
var PARTICLE_SPIN_MAX = 6.2;










// 手骨架 canvas
var handCanvas = null, handCanvasCtx = null;
// 平滑系数 (越小越平滑, 但反应越慢)
var HAND_SMOOTH_ALPHA = 0.35;






window.addEventListener('resize', resizeHandCanvas);



// 把单帧 21 个 landmark 平滑到 handLmSmooth, 镜像 X (摄像头是反的)


// 手掌中心 ≈ wrist(0) 和 mcp 平均 (5,9,13,17 是各指根)






// 画手掌骨架: 连线 + 关节圆点
//   骨架连接表 (MediaPipe 标准)
var HAND_BONES = [
  [0,1],[1,2],[2,3],[3,4],        // 拇指
  [0,5],[5,6],[6,7],[7,8],        // 食指
  [0,9],[9,10],[10,11],[11,12],   // 中指
  [0,13],[13,14],[14,15],[15,16], // 无名指
  [0,17],[17,18],[18,19],[19,20], // 小指
  [5,9],[9,13],[13,17],           // 掌横连
];


// 每帧调用 — 应用惯性旋转 + handActive 衰减



  // stub: 兼容旧调用
  // stub: 兼容旧调用


// ============================================================
//  Resize / 快捷键
// ============================================================


window.addEventListener('resize', function(){
  scheduleMainRendererViewportRefresh('resize');
  if (desktopRuntimeState.fullscreen || desktopFullscreenActive || document.fullscreenElement || document.body.classList.contains('desktop-fullscreen')) layoutFullscreenDiyZone();
});
// 上下文感知"返回"：依次关闭最上层的浮层；都没有时回到 Home。供 Esc 键与鼠标右键复用。

document.addEventListener('keydown', function(e){
  if (isTypingTarget(e.target)) return;
  if (handleConfiguredLocalHotkey(e)) return;
  if (shouldSuppressDefaultConfiguredHotkey(e)) return;
  if (e.code === 'Space') {
    if (freeCamera && freeCamera.active) { e.preventDefault(); return; }
    e.preventDefault(); togglePlay();
  }
  else if (e.code === 'Home') { e.preventDefault(); goHome(); }
  else if (e.code === 'ArrowUp') { e.preventDefault(); adjustVolumeByKeyboard(0.05); }
  else if (e.code === 'ArrowDown') { e.preventDefault(); adjustVolumeByKeyboard(-0.05); }
  else if (e.code === 'ArrowRight') nextTrack();
  else if (e.code === 'ArrowLeft')  prevTrack();
  else if (e.code === 'Escape')     {
    e.preventDefault();
    performBackAction();
  }
  else if (e.code === 'KeyL') { if (!immersiveMode) toggleLyricsPanel(); }
  else if (e.code === 'KeyP') {
    if (!immersiveMode && diyPlayerMode) toggleFxPanel();
    else if (!immersiveMode) showToast('开启 DIY 玩家模式后可打开视觉控制台');
  }
  else if (e.code === 'KeyI') toggleImmersiveMode();
  else if (e.code === 'KeyF') toggleFullscreen();
});

// 鼠标右键只负责“返回”。捕获阶段吞掉事件，避免画布或 Chromium
// 再把它解释成 3D 货架操作 / 原生上下文菜单。
document.addEventListener('contextmenu', function(e){
  e.preventDefault();
  e.stopImmediatePropagation();
  if (document.body.classList.contains('splash-active')) return;
  performBackAction();
}, true);

// ============================================================
//  UI 半隐藏 v8 — 三个面板的触发/隐藏体验完全统一
//   - 搜索栏 (顶部): y < 80 进入, y > 96 离开
//   - 控制台 (右侧): x > w-48 进入, x < w-380 离开
//   - 歌单 (左侧): x < 48 进入, x > 380 离开
//   - 进入立即显示, 离开延迟 500ms (统一)
// ============================================================
var PEEK_HIDE_DELAY = 170;
var peekTimers = { search:null, fx:null, pl:null };














window.addEventListener('mousemove', function(e){
  var sa = document.getElementById('search-area');
  var fp = document.getElementById('fx-panel');
  var pp = document.getElementById('playlist-panel');
  var ex = e.clientX, ey = e.clientY, W = innerWidth, H = innerHeight;
  updateUserCapsuleAutoHideFromPointer(ex, ey);
  updateFxFabAutoHideFromPointer(ex, ey);
  updateFullscreenDiyPeekFromPointer(ex, ey);
  if (document.body.classList.contains('splash-active')) {
    updateShelfHoverCueFromPointer(null);
    updateShelfCardHoverSelection(null);
    setFocusZone(null);
    return;
  }
  if (immersiveMode) {
    updateShelfHoverCueFromPointer(e);
    updateShelfCardHoverSelection(e);
    updateControlsAutoHideFromPointer(ex, ey);
    var ppOnImm = pp.classList.contains('peek') || pp.classList.contains('show');
    var ppRectImm = ppOnImm ? pp.getBoundingClientRect() : null;
    var queueEdgeSideImm = playlistPanelEdgeTriggerSide(ex, ey, W, H);
    var inQueueTriggerImm = !!queueEdgeSideImm;
    if (queueEdgeSideImm && !playlistPanelPinned && queueEdgeSideImm !== playlistPanelSide) {
      applyPlaylistPanelSide(queueEdgeSideImm, false, ppOnImm);
    }
    var inQueuePanelImm = ppOnImm && ex >= ppRectImm.left - 18 && ex <= ppRectImm.right + 24 && ey >= ppRectImm.top - 22 && ey <= ppRectImm.bottom + 22;
    if (inQueueTriggerImm || inQueuePanelImm) setPeek(pp, true, 'pl');
    else if (shouldClosePlaylistPanelFromPointer(ppOnImm, ex, ey, ppRectImm)) setPeek(pp, false, 'pl');
    var shelfCanFocusImm = !!(shelfManager && shelfManager.canInteract && shelfManager.canInteract());
    var newFocusImm = null;
    var queueFocusImm = isPlaylistPanelFocusActive(inQueueTriggerImm, inQueuePanelImm, pp, ex, ey, ppRectImm);
    var shelfHoverFocusImm = !!(shelfCanFocusImm && isSideShelfFocusHit(e));
    if (queueFocusImm) newFocusImm = 'queue';
    else if (shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent()) newFocusImm = 'shelf-detail';
    else if (shelfHoverFocusImm) newFocusImm = 'shelf-side';
    else if (shelfCanFocusImm && shelfManager.getMode() === 'stage' && ey > H * 0.55) newFocusImm = 'shelf-stage';
    setFocusZone(newFocusImm, newFocusImm === 'queue');
    return;
  }
  updateShelfHoverCueFromPointer(e);
  updateShelfCardHoverSelection(e);
  // 搜索 (上): 顶部 48px 内进入; 已显示时鼠标在 280px 内保留
  var saOn = sa.classList.contains('peek');
  var saRect = sa.getBoundingClientRect();
  var searchFocused = document.activeElement === $input;
  var uploadTip = document.getElementById('upload-tip');
  var uploadTipOpen = !!(uploadTip && uploadTip.classList.contains('show'));
  var inSearchPanel = saOn && ex >= saRect.left - 24 && ex <= saRect.right + 24 && ey >= saRect.top - 22 && ey <= saRect.bottom + 42;
  if (ey < 66 || inSearchPanel || searchFocused || uploadTipOpen) setPeek(sa, true, 'search');
  else if (saOn && !emptyHomeActive) setPeek(sa, false, 'search');
  // 控制台: 右下角触发；右侧歌单已经展开时让歌单优先，避免两层争抢焦点。
  var ppOn = pp.classList.contains('peek') || pp.classList.contains('show');
  var fpOn = fp.classList.contains('peek') || fp.classList.contains('show');
  var fpRect = fp.getBoundingClientRect();
  var fab = document.getElementById('fx-fab');
  var fabRect = fab ? fab.getBoundingClientRect() : { left:W, right:W, top:H, bottom:H };
  var inFxPanel = fpOn && ex >= fpRect.left - 24 && ex <= fpRect.right + 24 && ey >= fpRect.top - 24 && ey <= fpRect.bottom + 24;
  var inFxFab = ex >= fabRect.left - 18 && ex <= fabRect.right + 18 && ey >= fabRect.top - 18 && ey <= fabRect.bottom + 18;
  var inFxBridge = fpOn && ex >= Math.min(fpRect.left, fabRect.left) - 18 && ex <= W && ey >= fpRect.bottom - 10 && ey <= fabRect.bottom + 18;
  if (ppOn && playlistPanelSide === 'right') inFxPanel = inFxFab = inFxBridge = false;
  if (!diyPlayerMode) inFxPanel = inFxFab = inFxBridge = false;
  if (inFxFab || inFxPanel || inFxBridge) setPeek(fp, true, 'fx');
  else if (fpOn) setPeek(fp, false, 'fx');
  // 歌单/队列面板可从左右边缘唤出；右侧触发时避开视觉控制按钮区域。
  var ppRect = ppOn ? pp.getBoundingClientRect() : null;
  var queueEdgeSide = playlistPanelEdgeTriggerSide(ex, ey, W, H);
  if (queueEdgeSide === 'right' && (inFxFab || inFxPanel || inFxBridge)) queueEdgeSide = '';
  var inQueueTrigger = !!queueEdgeSide;
  if (queueEdgeSide && !playlistPanelPinned && queueEdgeSide !== playlistPanelSide) {
    applyPlaylistPanelSide(queueEdgeSide, false, ppOn);
  }
  var inQueuePanel = ppOn && ex >= ppRect.left - 18 && ex <= ppRect.right + 24 && ey >= ppRect.top - 22 && ey <= ppRect.bottom + 22;
  if (inQueueTrigger || inQueuePanel) setPeek(pp, true, 'pl');
  else if (shouldClosePlaylistPanelFromPointer(ppOn, ex, ey, ppRect)) setPeek(pp, false, 'pl');

  // v8: 镜头跟拍触发判断
  //   - 队列面板 peek 时 → queue focus
  //   - 3D shelf side 模式只在点击展开后 → shelf-side
  //   - 3D shelf stage 模式 + 鼠标在下 35% → shelf-stage
  var shelfCanFocus = !!(shelfManager && shelfManager.canInteract && shelfManager.canInteract());
  if (!shelfCanFocus && !(shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent())) {
    shelfPinnedOpen = false;
  }

  var newFocus = null;
  var queueFocusActive = isPlaylistPanelFocusActive(inQueueTrigger, inQueuePanel, pp, ex, ey, ppRect);
  var shelfHoverFocus = !!(shelfCanFocus && isSideShelfFocusHit(e));
  if (queueFocusActive) {
    newFocus = 'queue';
  } else if (shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent()) {
    newFocus = 'shelf-detail';
  } else if (shelfHoverFocus) {
    newFocus = 'shelf-side';
  } else if (shelfCanFocus && shelfManager.getMode() === 'stage' && ey > H * 0.55) {
    newFocus = 'shelf-stage';
  }
  setFocusZone(newFocus, newFocus === 'queue');
});

// ============================================================
//  启动页 (splash) 控制
// ============================================================

if (!WALLPAPER_SURFACE) document.body.classList.add('splash-active');
var splashAnimating = true;
var splashCanvas = null, splashCtx = null;
var splashGl = null, splashGlProgram = null, splashGlBuffer = null, splashGlUniforms = null;
var splashW = 0, splashH = 0;
var splashDust = [];
var splashStreaks = [];
var splashShards = [];
var splashPixelRatio = 1;
var splashStartedAt = performance.now();
var splashSoundPlayed = false;
var splashAudioCtx = null;
var splashSoundFallbackArmed = false;
var splashTimer = null;
var reduceSplashMotion = false;
var splashReadyToEnter = false;









(function initMineradioSplashCanvas() {
  if (WALLPAPER_SURFACE) return;
  splashCanvas = document.getElementById('splash-canvas');
  if (!splashCanvas) return;
  if (!reduceSplashMotion && initMineradioSplashWebgl(splashCanvas)) {
    splashCtx = null;
  } else {
    splashCtx = splashCanvas.getContext('2d');
  }
  function resize() {
    splashPixelRatio = Math.min(1.6, Math.max(1, window.devicePixelRatio || 1));
    splashW = window.innerWidth;
    splashH = window.innerHeight;
    splashCanvas.width = Math.max(1, Math.floor(splashW * splashPixelRatio));
    splashCanvas.height = Math.max(1, Math.floor(splashH * splashPixelRatio));
    if (splashCtx) splashCtx.setTransform(splashPixelRatio, 0, 0, splashPixelRatio, 0, 0);
    if (splashGl) splashGl.viewport(0, 0, splashCanvas.width, splashCanvas.height);
    splashDust = [];
    splashStreaks = [];
    splashShards = [];
    var count = reduceSplashMotion ? 28 : 84;
    for (var i = 0; i < count; i++) {
      splashDust.push({
        x: Math.random() * splashW,
        y: Math.random() * splashH,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.11,
        r: Math.random() * 1.35 + 0.28,
        a: Math.random() * 0.105 + 0.025,
        p: Math.random() * Math.PI * 2
      });
    }
    var streakColors = [
      'rgba(244,210,138,',
      'rgba(122,215,194,',
      'rgba(255,83,103,',
      'rgba(157,184,207,'
    ];
    var streakCount = reduceSplashMotion ? 6 : 22;
    for (var s = 0; s < streakCount; s++) {
      splashStreaks.push({
        x: Math.random() * splashW,
        y: splashH * (0.20 + Math.random() * 0.62),
        len: splashW * (0.12 + Math.random() * 0.24),
        width: 0.75 + Math.random() * 2.1,
        speed: splashW * (0.00028 + Math.random() * 0.00042),
        angle: (-10 + Math.random() * 20) * Math.PI / 180,
        phase: Math.random() * Math.PI * 2,
        color: streakColors[s % streakColors.length],
        delay: Math.random() * 1.1,
        alpha: 0.18 + Math.random() * 0.36
      });
    }
    var shardCount = reduceSplashMotion ? 10 : 34;
    for (var h = 0; h < shardCount; h++) {
      splashShards.push({
        ox: (Math.random() - 0.5) * splashW * 0.92,
        oy: (Math.random() - 0.5) * splashH * 0.22,
        w: 18 + Math.random() * 86,
        h: 1 + Math.random() * 5,
        skew: (Math.random() - 0.5) * 20,
        phase: Math.random() * Math.PI * 2,
        color: streakColors[h % streakColors.length],
        alpha: 0.10 + Math.random() * 0.24
      });
    }
  }
  resize();
  window.addEventListener('resize', resize);
  drawMineradioSplash();
})();










document.addEventListener('DOMContentLoaded', function(){
  var s = document.getElementById('splash');
  if (!s) return;
  if (WALLPAPER_SURFACE) {
    s.style.display = 'none';
    document.body.classList.remove('splash-active', 'splash-revealing');
    return;
  }
  markAppPerf('dom-content-loaded');
  armSplashSoundFallback();
  prewarmHomeWallpaperPreview();
  function requestSplashEnter() {
    playMineradioIntroSound();
    if (splashReadyToEnter) dismissSplash();
  }
  s.addEventListener('click', requestSplashEnter);
  document.addEventListener('keydown', function(e){
    if (!document.body.classList.contains('splash-active')) return;
    if (e.key === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      requestSplashEnter();
    }
  });
  if (reduceSplashMotion) {
    s.classList.add('reduce-motion');
    splashTimer = setTimeout(markSplashReadyToEnter, 900);
    return;
  }
  playMineradioIntroSound();
  splashTimer = setTimeout(markSplashReadyToEnter, 5000);
});

var desktopOverlayPushState = {
  lyricsAt: 0,
  wallpaperAt: 0,
  lastLyricsKey: '',
  lastLyricsBeatKey: '',
  lastWallpaperBeatKey: '',
  lastWallpaperKey: ''
};



















setInterval(function(){
  if (fx && fx.desktopLyrics) syncDesktopOverlayState();
}, 320);

// 全屏
var desktopFullscreenActive = false;
var documentFullscreenActive = false;
var desktopWindowState = {};



(function initDesktopWindowShell(){
  var api = window.desktopWindow;
  if (!api || !api.isDesktop) return;

  document.documentElement.classList.add('desktop-shell-root');
  document.body.classList.add('desktop-shell');
  document.body.classList.remove('desktop-fullscreen');
  desktopFullscreenActive = false;
  syncCursorAutoHideMode();

  var maxBtn = document.querySelector('[data-window-action="maximize"]');
  var maxIcon = maxBtn && maxBtn.querySelector('.icon-maximize');
  var restoreIcon = maxBtn && maxBtn.querySelector('.icon-restore');
  function applyState(state) {
    desktopWindowState = Object.assign(desktopWindowState, state || {});
    var isMaximized = !!desktopWindowState.isMaximized;
    var wallpaperModeActive = !!desktopWindowState.wallpaperModeActive;
    var wallpaperInteractive = !!desktopWindowState.wallpaperInteractive;
    var isFullScreen = !!desktopWindowState.isFullScreen || !!desktopWindowState.isNativeFullScreen || !!desktopWindowState.isHtmlFullScreen || !!desktopWindowState.isWindowFullScreen || !!document.fullscreenElement || wallpaperModeActive;
    var wasFullScreen = desktopFullscreenActive;
    desktopFullscreenActive = isFullScreen;
    document.body.classList.toggle('desktop-maximized', isMaximized);
    document.body.classList.toggle('desktop-fullscreen', isFullScreen);
    document.body.classList.toggle('wallpaper-hosted', wallpaperModeActive);
    document.body.classList.toggle('wallpaper-interactive', wallpaperModeActive && wallpaperInteractive);
    if (wallpaperModeActive && typeof dismissSplash === 'function') {
      var splash = document.getElementById('splash');
      if (splash && !splash.classList.contains('hide') && !splash.classList.contains('exiting')) dismissSplash();
    }
    desktopRuntimeState.fullscreen = isFullScreen;
    if (isFullScreen) layoutFullscreenDiyZone();
    if (isFullScreen !== wasFullScreen) {
      scheduleMainRendererViewportRefresh('desktop-shell-state');
      if (!isFullScreen) {
        document.body.classList.remove('fullscreen-diy-peek');
        setTimeout(function(){ clearPlayerControlFocusState('desktop-fullscreen-exit'); }, 80);
      }
    }
    syncCursorAutoHideMode();
    if (maxBtn) {
      maxBtn.title = isFullScreen ? '退出全屏' : '全屏';
      maxBtn.setAttribute('aria-label', maxBtn.title);
    }
    if (maxIcon) maxIcon.style.display = isFullScreen ? 'none' : '';
    if (restoreIcon) restoreIcon.style.display = isFullScreen ? '' : 'none';
  }

  document.querySelectorAll('[data-window-action]').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.preventDefault();
      e.stopPropagation();
      var action = btn.getAttribute('data-window-action');
      if (action === 'minimize') api.minimize();
      if (action === 'maximize') toggleFullscreen();
      if (action === 'close') api.close();
    });
  });

  if (typeof api.onDesktopLyricsLockState === 'function') {
    api.onDesktopLyricsLockState(function(payload){
      var locked = !payload || payload.locked !== false;
      if (fx.desktopLyricsClickThrough === locked) return;
      fx.desktopLyricsClickThrough = locked;
      updateFxInputs();
      saveLyricLayout();
      pushDesktopLyricsState(true);
      showToast(locked ? '桌面歌词已锁定' : '桌面歌词可移动');
    });
  }
  if (typeof api.onDesktopLyricsEnabledState === 'function') {
    api.onDesktopLyricsEnabledState(function(payload){
      var enabled = !!(payload && payload.enabled);
      if (fx.desktopLyrics === enabled) return;
      fx.desktopLyrics = enabled;
      updateFxInputs();
      saveLyricLayout();
      showToast(enabled ? '桌面歌词已开启' : '桌面歌词已关闭');
    });
  }

  api.onStateChange(applyState);
  if (typeof api.getState === 'function') {
    api.getState().then(applyState).catch(function(){ applyState({}); });
  } else {
    applyState({});
  }
  document.addEventListener('fullscreenchange', function(){
    var wasDocumentFullscreen = documentFullscreenActive;
    documentFullscreenActive = !!document.fullscreenElement;
    desktopWindowState.isHtmlFullScreen = documentFullscreenActive;
    if (wasDocumentFullscreen && !documentFullscreenActive && typeof api.exitFullscreenWindowed === 'function') {
      api.exitFullscreenWindowed();
    }
    applyState({});
  });
})();

// ============================================================
//  启动
// ============================================================
if (WALLPAPER_SURFACE) {
  initWallpaperSurfaceRuntime();
} else {
applyDiyMode(diyPlayerMode, { save: false });
bindFxPanel();
applySavedLyricPaletteState();
bindQualityControl();
bindVolumeControls();
bindQueueDragAndDrop();
initControlGlassSurface();
bindPlayerControlAnimations();
scheduleUiWarmTask(function(){
  updateControlGlassDisplacementMap();
  updateSearchBoxGlassDisplacementMap();
  updateSearchPillGlassDisplacementMap();
  try {
    if (renderer && renderer.compile && scene && camera) renderer.compile(scene, camera);
  } catch (e) {}
}, 900);
applyUserCapsuleAutoHideState();
applyFxFabAutoHideState();
applyControlsAutoHidePreference();
applyDesktopLyricsState(false);
applyWallpaperModeState(false);
// 默认关掉 3D 歌单架（错位、用户只要简约播放）。只强制一次，之后用户可在视觉控制台重新开启。
try {
  if (!localStorage.getItem('mineradio-shelf-off-applied-v1')) {
    localStorage.setItem('mineradio-shelf-off-applied-v1', '1');
    fx.shelf = 'off';
  }
} catch (e) {}
// 自由镜头和电影镜头需要歌词跟拍；仅迁移一次，之后仍可由用户手动关闭。
try {
  if (!localStorage.getItem(LYRIC_CAMERA_FOLLOW_MIGRATION_KEY)) {
    fx.lyricCameraLock = true;
    localStorage.setItem(LYRIC_CAMERA_FOLLOW_MIGRATION_KEY, '1');
    saveLyricLayout();
  }
} catch (e) {}
setShelfMode(fx.shelf);
applyStartupStarfieldPreset();
applyPlaylistPanelSide(playlistPanelSide, false, false);
applyPlaylistPanelPinState(false);
if (fx.floatLayer) createFloatLayer();
if (fx.particleLyrics) createLyricsParticles();
if (fx.backCover) createBackCoverLayer();
initIdleGuideCanvas();
restoreCachedUserLibrary();
restorePlaybackSession();
var startupLoginStatusPromise = Promise.all([refreshLoginStatus()]);
if (startupLoginStatusPromise && startupLoginStatusPromise.then) {
  startupLoginStatusPromise.then(function(){
    if (hasAnyPlatformLogin()) {
      refreshUserPlaylists(true);
      loadHomeDiscover(true);
    }
    if (document.body.classList.contains('splash-active')) return;
    var homeShown = updateEmptyHomeVisibility({ forceLoad: hasAnyPlatformLogin() });
    if (!hasAnyPlatformLogin()) maybeRunStartupLoginGuide('status');
    else if (!homeShown) maybeRunStartupLoginGuide('status');
  });
}
var collectNameInput = document.getElementById('collect-new-name');
if (collectNameInput) {
  collectNameInput.addEventListener('keydown', function(e){
    if (e.key === 'Enter') {
      e.preventDefault();
      createPlaylistFromCollect();
    }
  });
}
var customLyricInput = document.getElementById('custom-lyric-input');
if (customLyricInput) {
  customLyricInput.addEventListener('keydown', function(e){
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      saveCustomLyricForCurrent();
    }
  });
}
safeRenderQueuePanel('startup');
updateCustomCoverButton();
updateCustomLyricControls();
updateLikeButtons();
setTimeout(initUpdatePreview, 9000);
}

// ============================================================
//  主循环
// ============================================================
var prevTime = performance.now();
var renderPerfState = {
  mode: 'vsync',
  fps: 0,
  frames: 0,
  skipped: 0,
  longFrames: 0,
  lastRenderAt: 0,
  lastSampleAt: performance.now()
};
window.__mineradioPerf = renderPerfState;
var splashWarmRenderLast = 0;
var visualSubsystemHealth = Object.create(null);
window.__mineradioVisualHealth = visualSubsystemHealth;










installVisualRuntimeRecovery();
animate();

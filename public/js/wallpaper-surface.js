'use strict';

// Passive desktop-wallpaper surface.  It reuses Mineradio's exact Three.js
// scene, shaders, cover pipeline and 3D lyric renderer, but never owns audio or
// playback controls.  The main App renderer remains the single source of truth.
var WALLPAPER_SURFACE = window.__MINERADIO_SURFACE__ === 'wallpaper';
var wallpaperSurfaceRuntime = {
  enabled: false,
  ready: false,
  sequence: 0,
  trackKey: '',
  fxKey: '',
  lyricKey: '',
  beatMapKey: '',
  paletteKey: '',
  receivedAt: 0,
  clock: {
    position: 0,
    duration: 0,
    rate: 1,
    playing: false,
    capturedAt: 0
  },
  motion: {
    bass: 0,
    mid: 0,
    treble: 0,
    smoothBass: 0,
    smoothMid: 0,
    smoothTreb: 0,
    smoothEnergy: 0,
    audioEnergy: 0,
    beatPulse: 0,
    lyricSunEnergy: 0,
    lyricSunHold: 0,
    buildup: 0,
    chorus: 0,
    chorusEntryPulse: 0,
    beatGlow: 0,
    highBloom: 0
  },
  lastTime: 0,
  lastBeatTarget: 0,
  host: 'electron',
  bridgeConnected: false,
  bridgeLastError: '',
  bridgeLastConnectedAt: 0
};

// Wallpaper Engine hosts this page outside Electron, so the preload IPC bridge
// is unavailable there.  Mineradio's desktop process exposes the same passive
// state stream on loopback; playback and all controls remain owned by the App.
var WALLPAPER_ENGINE_BRIDGE_ORIGIN = 'http://127.0.0.1:17368';
var wallpaperEngineBridgeRuntime = {
  source: null,
  retryTimer: 0,
  pollTimer: 0,
  requestToken: 0,
  attempt: 0,
  stopped: false,
  sessionKey: ''
};

var WALLPAPER_FX_KEYS = {
  preset:1, intensity:1, cinemaShake:1, depth:1, coverResolution:1,
  point:1, speed:1, twist:1, color:1, scatter:1, bgFade:1,
  bloomStrength:1, lyricGlowStrength:1, lyricScale:1,
  lyricOffsetX:1, lyricOffsetY:1, lyricOffsetZ:1,
  lyricTiltX:1, lyricTiltY:1, lyricCameraLock:1,
  lyricColorMode:1, lyricColor:1, lyricHighlightMode:1,
  lyricHighlightColor:1, lyricGlowLinked:1, lyricGlowColor:1,
  lyricFont:1, lyricLetterSpacing:1, lyricLineHeight:1, lyricWeight:1,
  visualTintMode:1, visualTintColor:1,
  backgroundColorMode:1, backgroundColor:1, backgroundOpacity:1,
  backgroundColorCustom:1, backgroundImage:1, backgroundMedia:1,
  floatLayer:1, cinema:1, edge:1, aiDepth:1, bloom:1,
  lyricGlow:1, lyricGlowBeat:1, lyricGlowParticles:1,
  particleLyrics:1, backCover:1, performanceQuality:1,
  wallpaperOpacity:1, wallpaperLyrics:1, wallpaperParticleMode:1
};

function wallpaperSurfaceClamp(value, min, max, fallback) {
  var n = Number(value);
  if (!isFinite(n)) n = fallback == null ? min : fallback;
  return Math.max(min, Math.min(max, n));
}

function wallpaperSurfaceStableString(value) {
  try { return JSON.stringify(value == null ? null : value); }
  catch (e) { return String(value || ''); }
}

function wallpaperSurfaceCoverSource(src) {
  src = String(src || '').trim();
  if (!src) return '';
  if (/^(data:image\/|blob:)/i.test(src)) return src;
  try {
    var parsed = new URL(src, location.href);
    if (parsed.pathname === '/api/cover') {
      return parsed.searchParams.get('url') || '';
    }
  } catch (e) {}
  return src;
}

function wallpaperSurfaceTrackFromState(state) {
  var raw = state && state.track && typeof state.track === 'object' ? state.track : (state || {});
  var cover = raw.cover || state.cover || '';
  var title = raw.title || raw.name || state.title || 'Mineradio';
  var artist = raw.artist || state.artist || '';
  var key = raw.key || raw.songKey || raw.id || [title, artist, cover].join('|');
  return {
    key: String(key || ''),
    id: raw.id || '',
    name: String(title || 'Mineradio'),
    title: String(title || 'Mineradio'),
    artist: String(artist || ''),
    cover: String(cover || ''),
    provider: raw.provider || raw.source || 'netease',
    source: raw.source || raw.provider || 'netease'
  };
}

function wallpaperSurfaceApplyTrack(state) {
  var hasTrackPayload = !!(state && state.track && typeof state.track === 'object')
    || !!(state && (Object.prototype.hasOwnProperty.call(state, 'cover')
      || Object.prototype.hasOwnProperty.call(state, 'title')
      || Object.prototype.hasOwnProperty.call(state, 'artist')));
  if (!hasTrackPayload) return;
  var track = wallpaperSurfaceTrackFromState(state || {});
  if (!track.key && !track.cover && !track.name) return;
  playQueue = [track];
  playlist = [track];
  currentIdx = 0;
  if (track.key === wallpaperSurfaceRuntime.trackKey) return;
  wallpaperSurfaceRuntime.trackKey = track.key;
  wallpaperSurfaceRuntime.lyricKey = '';
  wallpaperSurfaceRuntime.beatMapKey = '';
  currentBeatMap = null;
  currentDjBeatMap = null;
  trackSwitchToken++;
  if (stageLyrics) stageLyrics.currentIdx = -1;
  var src = wallpaperSurfaceCoverSource(track.cover);
  if (/^(data:image\/|blob:)/i.test(src)) {
    applyCoverDataUrl(src, { deferHeavy:true, delay:80, timeout:900, colorMixDuration:920 });
  } else {
    loadCoverFromUrl(src, { deferHeavy:true, delay:80, timeout:900, colorMixDuration:920 });
  }
  if (uniforms && uniforms.uAlpha) tweenParticleAlpha(uniforms.uAlpha.value || 0, 1, 320);
}

function wallpaperSurfaceFxFromState(state) {
  var out = {};
  var incoming = state && state.fx && typeof state.fx === 'object' ? state.fx : null;
  var visual = state && state.visual && typeof state.visual === 'object' ? state.visual : null;
  if (incoming) Object.keys(incoming).forEach(function(key){ if (WALLPAPER_FX_KEYS[key]) out[key] = incoming[key]; });
  if (visual) Object.keys(visual).forEach(function(key){ if (WALLPAPER_FX_KEYS[key]) out[key] = visual[key]; });
  if (state && state.preset != null) out.preset = state.preset;
  if (state && state.opacity != null) out.wallpaperOpacity = state.opacity;
  if (state && state.particleMode != null) out.wallpaperParticleMode = state.particleMode;
  if (state && state.lyricsEnabled != null) out.wallpaperLyrics = state.lyricsEnabled !== false;
  return out;
}

function wallpaperSurfaceSyncOptionalLayers() {
  // The floating layer is intentionally disabled in the current main renderer;
  // calling createFloatLayer keeps that source-of-truth behavior intact.
  if (fx.floatLayer) createFloatLayer();
  else if (typeof destroyFloatLayer === 'function') destroyFloatLayer();
  var lyricsOn = fx.wallpaperLyrics !== false && fx.particleLyrics !== false;
  fx.particleLyrics = !!lyricsOn;
  lyricsVisible = !!lyricsOn;
  if (lyricsOn) createLyricsParticles();
  else clearStageLyrics();
  if (fx.backCover) createBackCoverLayer();
  else if (typeof destroyBackCoverLayer === 'function') destroyBackCoverLayer();
}

function wallpaperSurfaceForcePassiveScene() {
  fx.shelf = 'off';
  fx.cam = 'off';
  if (shelfManager && typeof shelfManager.setMode === 'function') shelfManager.setMode('off');
  if (typeof gestureActive !== 'undefined' && gestureActive && typeof stopGestureControl === 'function') stopGestureControl();
}

function wallpaperSurfaceApplyFx(state) {
  var next = wallpaperSurfaceFxFromState(state || {});
  var key = state && (state.fxRevision || state.visualRevision) || wallpaperSurfaceStableString(next);
  if (String(key) === wallpaperSurfaceRuntime.fxKey) return;
  wallpaperSurfaceRuntime.fxKey = String(key);
  var previousPreset = Number(fx.preset) || 0;
  var previousResolution = Number(fx.coverResolution) || 1;
  Object.keys(next).forEach(function(name){
    if (!WALLPAPER_FX_KEYS[name]) return;
    fx[name] = next[name];
  });
  fx.wallpaperMode = true;
  fx.desktopLyrics = false;
  fx.shelf = 'off';
  fx.cam = 'off';
  fx.wallpaperParticleMode = normalizeWallpaperParticleMode(fx.wallpaperParticleMode);
  fx.wallpaperOpacity = wallpaperSurfaceClamp(fx.wallpaperOpacity, 0.05, 1, 1);
  document.documentElement.style.setProperty('--wallpaper-visual-opacity', fx.wallpaperOpacity.toFixed(3));
  document.body.setAttribute('data-wallpaper-particles', fx.wallpaperParticleMode);
  document.body.classList.toggle('wallpaper-lyrics-hidden', fx.wallpaperLyrics === false);
  var targetPreset = wallpaperSurfaceClamp(fx.preset, 0, presetMeta.length - 1, 0);
  setPreset(targetPreset, {
    silent:true,
    noSave:true,
    preserveCamera:false,
    skipTransition: previousPreset === targetPreset,
    commitPlaybackPreset:false
  });
  if (Math.abs(previousResolution - Number(fx.coverResolution || 0)) > 0.001) {
    applyCoverParticleResolution(fx.coverResolution, { reload:true });
  }
  if (freeCamera) {
    freeCamera.active = false;
    freeCamera.locked = false;
    freeCamera.keys = {};
  }
  wallpaperSurfaceForcePassiveScene();
  wallpaperSurfaceSyncOptionalLayers();
  syncFxUniforms();
  if (typeof applyCustomBackground === 'function') applyCustomBackground();
  if (typeof updateRenderPowerClasses === 'function') updateRenderPowerClasses();
  if (typeof applyRendererPowerMode === 'function') applyRendererPowerMode();
}

function wallpaperSurfacePaletteFromState(state) {
  var raw = state && (state.palette || state.colors) || {};
  if (state && state.lyrics && state.lyrics.colors) raw = state.lyrics.colors;
  return {
    primary: raw.primary || raw.main || '#d6f8ff',
    secondary: raw.secondary || '#9cffdf',
    highlight: raw.highlight || '#fff0b8',
    glowColor: raw.glowColor || raw.glow || raw.secondary || '#9cffdf'
  };
}

function wallpaperSurfaceApplyPalette(state) {
  var hasPalettePayload = !!(state && (state.palette || state.colors))
    || !!(state && state.lyrics && state.lyrics.colors);
  if (!hasPalettePayload) return;
  var palette = wallpaperSurfacePaletteFromState(state || {});
  var key = state && state.paletteRevision || wallpaperSurfaceStableString(palette);
  if (String(key) === wallpaperSurfaceRuntime.paletteKey) return;
  wallpaperSurfaceRuntime.paletteKey = String(key);
  stageLyrics.coverPalette = palette;
  setStageLyricPalette(palette);
  if (typeof syncSkullParticleColors === 'function') syncSkullParticleColors();
}

function wallpaperSurfaceNormalizeWord(word) {
  word = word || {};
  return {
    t: Math.max(0, Number(word.t) || 0),
    d: Math.max(0, Number(word.d != null ? word.d : word.duration) || 0),
    c0: Math.max(0, Number(word.c0) || 0),
    c1: Math.max(0, Number(word.c1) || 0),
    text: String(word.text || word.word || '')
  };
}

function wallpaperSurfaceNormalizeLine(line) {
  line = line || {};
  var text = String(line.text || '');
  var words = Array.isArray(line.words) ? line.words.map(wallpaperSurfaceNormalizeWord) : null;
  return {
    t: Math.max(0, Number(line.t != null ? line.t : line.time) || 0),
    duration: Math.max(0, Number(line.duration != null ? line.duration : line.d) || 0),
    text: text,
    trans: String(line.trans || line.translation || ''),
    charCount: Math.max(1, Number(line.charCount) || Array.from(text).length || 1),
    words: words && words.length ? words : null,
    fallback: !!line.fallback
  };
}

function wallpaperSurfaceLegacyLyricLine(lyrics, clock) {
  var text = String(lyrics && lyrics.text || '').trim();
  if (!text) return [];
  var span = wallpaperSurfaceClamp(lyrics.progressSpan, 0.75, 20, 4.8);
  var progress = wallpaperSurfaceClamp(lyrics.progress, 0, 1, 0);
  var position = Number(clock && (clock.position != null ? clock.position : clock.time)) || 0;
  return [{
    t: Math.max(0, position - progress * span),
    duration: span,
    text: text,
    trans: String(lyrics.trans || lyrics.translation || ''),
    charCount: Math.max(1, Array.from(text).length),
    words: null,
    fallback: false
  }];
}

function wallpaperSurfaceApplyLyrics(state) {
  var raw = state && state.lyrics && typeof state.lyrics === 'object' ? state.lyrics : {};
  var clock = state && state.clock || raw.playback || {};
  var hasStructuredLines = Array.isArray(raw.lines) || Array.isArray(state && state.lyricsLines);
  var lines = Array.isArray(raw.lines) ? raw.lines : (Array.isArray(state && state.lyricsLines) ? state.lyricsLines : null);
  if (!hasStructuredLines && Array.isArray(lyricsLines) && lyricsLines.length) return;
  if (!lines) lines = wallpaperSurfaceLegacyLyricLine(raw, clock);
  var normalized = lines.map(wallpaperSurfaceNormalizeLine).filter(function(line){ return !!line.text; });
  var key = state && (state.lyricsRevision || raw.revision) || [
    wallpaperSurfaceRuntime.trackKey,
    normalized.length,
    normalized[0] && normalized[0].text,
    normalized[normalized.length - 1] && normalized[normalized.length - 1].t,
    raw.text || ''
  ].join('|');
  if (String(key) === wallpaperSurfaceRuntime.lyricKey) return;
  wallpaperSurfaceRuntime.lyricKey = String(key);
  lyricsLines = normalized;
  lyricsHasNativeKaraoke = raw.hasNativeKaraoke === true || normalized.some(function(line){ return !!(line.words && line.words.length); });
  lyricsTimingSource = raw.timingSource || (lyricsHasNativeKaraoke ? 'yrc-word' : (normalized.length ? 'lrc-line' : 'none'));
  lyricsVisible = fx.wallpaperLyrics !== false && fx.particleLyrics !== false;
  if (stageLyrics) stageLyrics.currentIdx = -999;
  if (!lyricsVisible || !normalized.length) clearStageLyrics();
}

function wallpaperSurfaceClockFromState(state) {
  var lyrics = state && state.lyrics && typeof state.lyrics === 'object' ? state.lyrics : {};
  var raw = state && state.clock || state && state.playback || lyrics.playback || {};
  var position = raw.position;
  if (position == null) position = raw.currentTime;
  if (position == null) position = raw.time;
  var capturedAt = Number(raw.capturedAt || raw.sentAt || raw.wallTime || raw.timestamp) || Date.now();
  if (Math.abs(Date.now() - capturedAt) > 15000) capturedAt = Date.now();
  return {
    position: Math.max(0, Number(position) || 0),
    duration: Math.max(0, Number(raw.duration) || 0),
    rate: wallpaperSurfaceClamp(raw.rate != null ? raw.rate : raw.playbackRate, 0.25, 4, 1),
    playing: raw.playing != null ? !!raw.playing : !!(state && state.playing),
    capturedAt: capturedAt
  };
}

function wallpaperSurfaceCurrentTime() {
  var c = wallpaperSurfaceRuntime.clock;
  var t = c.position;
  if (c.playing) t += Math.max(0, Date.now() - c.capturedAt) * 0.001 * c.rate;
  if (c.duration > 0) t = Math.min(c.duration, t);
  return Math.max(0, t);
}

function wallpaperSurfaceApplyClock(state) {
  var next = wallpaperSurfaceClockFromState(state || {});
  var before = wallpaperSurfaceCurrentTime();
  wallpaperSurfaceRuntime.clock = next;
  var after = wallpaperSurfaceCurrentTime();
  playing = !!next.playing;
  if (audio) {
    audio.currentTime = after;
    audio.duration = next.duration;
    audio.playbackRate = next.rate;
    audio.paused = !playing;
    audio.ended = next.duration > 0 && after >= next.duration - 0.01;
  }
  if (Math.abs(after - before) > 0.35 && typeof syncBeatMapPlaybackCursor === 'function') {
    syncBeatMapPlaybackCursor(after, false);
    if (stageLyrics) stageLyrics.currentIdx = -999;
  }
}

function wallpaperSurfaceMotionFromState(state) {
  var lyrics = state && state.lyrics && typeof state.lyrics === 'object' ? state.lyrics : {};
  var raw = state && state.motion && typeof state.motion === 'object' ? state.motion : (lyrics.motion || {});
  var dynamics = raw.dynamics || state && state.dynamics || {};
  var bassValue = Number(raw.bass) || 0;
  var midValue = Number(raw.mid) || 0;
  var trebValue = Number(raw.treble) || 0;
  return {
    bass: wallpaperSurfaceClamp(bassValue, 0, 1.8, 0),
    mid: wallpaperSurfaceClamp(midValue, 0, 1.8, 0),
    treble: wallpaperSurfaceClamp(trebValue, 0, 1.8, 0),
    smoothBass: wallpaperSurfaceClamp(raw.smoothBass != null ? raw.smoothBass : bassValue, 0, 1.8, 0),
    smoothMid: wallpaperSurfaceClamp(raw.smoothMid != null ? raw.smoothMid : midValue, 0, 1.8, 0),
    smoothTreb: wallpaperSurfaceClamp(raw.smoothTreb != null ? raw.smoothTreb : trebValue, 0, 1.8, 0),
    smoothEnergy: wallpaperSurfaceClamp(raw.smoothEnergy != null ? raw.smoothEnergy : raw.audioEnergy, 0, 1.8, 0),
    audioEnergy: wallpaperSurfaceClamp(raw.audioEnergy != null ? raw.audioEnergy : raw.energy, 0, 1.8, 0),
    beatPulse: wallpaperSurfaceClamp(raw.beatPulse != null ? raw.beatPulse : raw.beat, 0, 1.8, 0),
    lyricSunEnergy: wallpaperSurfaceClamp(raw.lyricSunEnergy, 0, 1.8, 0),
    lyricSunHold: wallpaperSurfaceClamp(raw.lyricSunHold, 0, 1.8, 0),
    buildup: wallpaperSurfaceClamp(raw.buildup != null ? raw.buildup : dynamics.buildup, 0, 1.8, 0),
    chorus: wallpaperSurfaceClamp(raw.chorus != null ? raw.chorus : dynamics.chorus, 0, 1.8, 0),
    chorusEntryPulse: wallpaperSurfaceClamp(raw.chorusEntryPulse != null ? raw.chorusEntryPulse : dynamics.chorusEntryPulse, 0, 1.8, 0),
    beatGlow: wallpaperSurfaceClamp(raw.beatGlow, 0, 1.8, 0),
    highBloom: wallpaperSurfaceClamp(raw.highBloom, 0, 1.8, 0),
    camera: {
      punch: wallpaperSurfaceClamp(raw.camera && raw.camera.punch, -2, 2, 0),
      theta: wallpaperSurfaceClamp(raw.camera && raw.camera.theta, -1, 1, 0),
      phi: wallpaperSurfaceClamp(raw.camera && raw.camera.phi, -1, 1, 0),
      radius: wallpaperSurfaceClamp(raw.camera && raw.camera.radius, -2, 2, 0),
      roll: wallpaperSurfaceClamp(raw.camera && raw.camera.roll, -1, 1, 0)
    }
  };
}

function wallpaperSurfaceApplyBeatMap(state) {
  var lyrics = state && state.lyrics && typeof state.lyrics === 'object' ? state.lyrics : {};
  var key = state && state.beatMapKey || lyrics.beatMapKey || '';
  var ownsMap = state && Object.prototype.hasOwnProperty.call(state, 'beatMap');
  var raw = ownsMap ? state.beatMap : lyrics.beatMap;
  if (!key && raw) key = wallpaperSurfaceStableString(raw).slice(0, 160);
  if (String(key) === wallpaperSurfaceRuntime.beatMapKey) return;
  if (raw !== undefined) {
    currentBeatMap = raw ? unpackLocalBeatMap(raw) : null;
    currentDjBeatMap = null;
    djMode.active = false;
    beatMapBusy = false;
    if (currentBeatMap && typeof applyCinemaProfileFromBeatMap === 'function') applyCinemaProfileFromBeatMap(currentBeatMap);
    if (typeof syncBeatMapPlaybackCursor === 'function') syncBeatMapPlaybackCursor(wallpaperSurfaceCurrentTime(), false);
  }
  wallpaperSurfaceRuntime.beatMapKey = String(key);
}

function applyWallpaperSurfaceState(state) {
  if (!WALLPAPER_SURFACE || !state || typeof state !== 'object') return;
  var sequence = state.seq != null ? state.seq : state.sequence;
  if (sequence != null && Number(sequence) < wallpaperSurfaceRuntime.sequence) return;
  wallpaperSurfaceRuntime.sequence = Math.max(wallpaperSurfaceRuntime.sequence, Number(sequence) || 0);
  wallpaperSurfaceRuntime.receivedAt = Date.now();
  wallpaperSurfaceRuntime.enabled = state.enabled !== false;
  document.body.classList.toggle('wallpaper-surface-disabled', !wallpaperSurfaceRuntime.enabled);
  wallpaperSurfaceApplyFx(state);
  wallpaperSurfaceApplyTrack(state);
  wallpaperSurfaceApplyPalette(state);
  wallpaperSurfaceApplyBeatMap(state);
  wallpaperSurfaceApplyClock(state);
  wallpaperSurfaceApplyLyrics(state);
  wallpaperSurfaceRuntime.motion = wallpaperSurfaceMotionFromState(state);
}

function wallpaperSurfaceEase(current, target, dt, attack, release) {
  var rate = target > current ? attack : release;
  return current + (target - current) * (1 - Math.exp(-Math.max(0.001, dt) * rate));
}

function prepareWallpaperSurfaceFrame(dt) {
  if (!WALLPAPER_SURFACE) return;
  var target = wallpaperSurfaceRuntime.motion;
  var t = wallpaperSurfaceCurrentTime();
  playing = !!wallpaperSurfaceRuntime.clock.playing;
  if (!audio) {
    audio = { currentTime:t, duration:0, playbackRate:1, paused:!playing, ended:false, src:'', readyState:4 };
  }
  audio.currentTime = t;
  audio.duration = wallpaperSurfaceRuntime.clock.duration;
  audio.playbackRate = wallpaperSurfaceRuntime.clock.rate;
  audio.paused = !playing;
  audio.ended = audio.duration > 0 && t >= audio.duration - 0.01;
  smoothBass = wallpaperSurfaceEase(smoothBass, target.smoothBass, dt, 18, 8);
  smoothMid = wallpaperSurfaceEase(smoothMid, target.smoothMid, dt, 16, 7);
  smoothTreb = wallpaperSurfaceEase(smoothTreb, target.smoothTreb, dt, 16, 7);
  smoothEnergy = wallpaperSurfaceEase(smoothEnergy, target.smoothEnergy || target.audioEnergy, dt, 14, 6);
  beatPulse = wallpaperSurfaceEase(beatPulse, target.beatPulse, dt, 26, 11);
  lyricSunEnergy = wallpaperSurfaceEase(lyricSunEnergy, target.lyricSunEnergy, dt, 12, 5);
  lyricSunHold = wallpaperSurfaceEase(lyricSunHold, target.lyricSunHold, dt, 10, 4);
  adaptiveMusicDynamics.buildup = wallpaperSurfaceEase(adaptiveMusicDynamics.buildup || 0, target.buildup, dt, 9, 4);
  adaptiveMusicDynamics.chorus = wallpaperSurfaceEase(adaptiveMusicDynamics.chorus || 0, target.chorus, dt, 10, 4.5);
  adaptiveMusicDynamics.chorusEntryPulse = wallpaperSurfaceEase(adaptiveMusicDynamics.chorusEntryPulse || 0, target.chorusEntryPulse, dt, 20, 7);
  if (stageLyrics) {
    stageLyrics.beatGlow = wallpaperSurfaceEase(stageLyrics.beatGlow || 0, target.beatGlow, dt, 16, 7);
    stageLyrics.highBloom = wallpaperSurfaceEase(stageLyrics.highBloom || 0, target.highBloom, dt, 10, 5);
  }
  if (target.beatPulse > wallpaperSurfaceRuntime.lastBeatTarget + 0.12) beatOnsetFlag = true;
  wallpaperSurfaceRuntime.lastBeatTarget = target.beatPulse;
  if (playing && currentBeatMap && typeof tickBeatMap === 'function') tickBeatMap();
  if (scheduledBeatFlag) {
    beatOnsetFlag = true;
    scheduledBeatFlag = false;
  }
  if (scheduledBeatPulse > beatPulse) beatPulse = scheduledBeatPulse;
  scheduledBeatPulse *= Math.pow(0.32, Math.max(0.001, dt));
  if (target.camera && beatCam) {
    beatCam.punch = wallpaperSurfaceEase(beatCam.punch || 0, target.camera.punch, dt, 22, 10);
    beatCam.thetaKick = wallpaperSurfaceEase(beatCam.thetaKick || 0, target.camera.theta, dt, 20, 9);
    beatCam.phiKick = wallpaperSurfaceEase(beatCam.phiKick || 0, target.camera.phi, dt, 20, 9);
    beatCam.radiusKick = wallpaperSurfaceEase(beatCam.radiusKick || 0, target.camera.radius, dt, 20, 9);
    beatCam.rollKick = wallpaperSurfaceEase(beatCam.rollKick || 0, target.camera.roll, dt, 20, 9);
  }
  if (typeof updateCinemaDynamics === 'function') updateCinemaDynamics(target.audioEnergy, target.bass);
  wallpaperSurfaceRuntime.lastTime = t;
}

function wallpaperEngineBridgeSetStatus(connected, error) {
  wallpaperSurfaceRuntime.bridgeConnected = !!connected;
  wallpaperSurfaceRuntime.bridgeLastError = error ? String(error.message || error) : '';
  if (connected) wallpaperSurfaceRuntime.bridgeLastConnectedAt = Date.now();
  var value = connected ? 'connected' : (error ? 'disconnected' : 'connecting');
  document.documentElement.setAttribute('data-wallpaper-bridge', value);
  if (document.body) document.body.setAttribute('data-wallpaper-bridge', value);
}

function wallpaperEngineBridgeUnwrap(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); }
    catch (e) { return null; }
  }
  if (!value || typeof value !== 'object') return null;
  var eventType = String(value.type || value.event || '').toLowerCase();
  if (eventType === 'ping' || eventType === 'keepalive' || eventType === 'heartbeat') return null;
  if (value.state && typeof value.state === 'object') return value.state;
  if (value.payload && typeof value.payload === 'object') return value.payload;
  if (value.data && typeof value.data === 'object' && (eventType || value.ok === true)) return value.data;
  return value;
}

function wallpaperEngineBridgeApply(value, snapshot) {
  var state = wallpaperEngineBridgeUnwrap(value);
  if (!state) return false;
  var sessionKey = String(state.bridgeSession || state.sessionId || state.session || '');
  if (sessionKey && wallpaperEngineBridgeRuntime.sessionKey && sessionKey !== wallpaperEngineBridgeRuntime.sessionKey) {
    wallpaperSurfaceRuntime.sequence = 0;
  }
  if (sessionKey) wallpaperEngineBridgeRuntime.sessionKey = sessionKey;
  var incomingSequence = Number(state.seq != null ? state.seq : state.sequence);
  // A freshly fetched snapshot after the desktop App restarted is authoritative.
  if (snapshot && isFinite(incomingSequence) && incomingSequence < wallpaperSurfaceRuntime.sequence) {
    wallpaperSurfaceRuntime.sequence = 0;
  }
  applyWallpaperSurfaceState(state);
  wallpaperEngineBridgeSetStatus(true);
  return true;
}

function wallpaperEngineBridgeFetchSnapshot() {
  if (typeof fetch !== 'function') return Promise.reject(new Error('fetch unavailable'));
  var token = ++wallpaperEngineBridgeRuntime.requestToken;
  var controller = typeof AbortController === 'function' ? new AbortController() : null;
  var timeout = setTimeout(function(){
    if (controller) {
      try { controller.abort(); } catch (e) {}
    }
  }, 4500);
  var options = { cache:'no-store', mode:'cors' };
  if (controller) options.signal = controller.signal;
  return fetch(WALLPAPER_ENGINE_BRIDGE_ORIGIN + '/state?t=' + Date.now(), options)
    .then(function(response){
      if (!response.ok) throw new Error('bridge HTTP ' + response.status);
      return response.json();
    })
    .then(function(state){
      if (token !== wallpaperEngineBridgeRuntime.requestToken || wallpaperEngineBridgeRuntime.stopped) return false;
      return wallpaperEngineBridgeApply(state, true);
    })
    .finally(function(){ clearTimeout(timeout); });
}

function wallpaperEngineBridgeClearConnection() {
  if (wallpaperEngineBridgeRuntime.source) {
    try { wallpaperEngineBridgeRuntime.source.close(); } catch (e) {}
    wallpaperEngineBridgeRuntime.source = null;
  }
  if (wallpaperEngineBridgeRuntime.retryTimer) {
    clearTimeout(wallpaperEngineBridgeRuntime.retryTimer);
    wallpaperEngineBridgeRuntime.retryTimer = 0;
  }
  if (wallpaperEngineBridgeRuntime.pollTimer) {
    clearTimeout(wallpaperEngineBridgeRuntime.pollTimer);
    wallpaperEngineBridgeRuntime.pollTimer = 0;
  }
}

function wallpaperEngineBridgeScheduleReconnect(error) {
  if (wallpaperEngineBridgeRuntime.stopped || wallpaperEngineBridgeRuntime.retryTimer) return;
  wallpaperEngineBridgeSetStatus(false, error || new Error('bridge disconnected'));
  var attempt = Math.min(7, wallpaperEngineBridgeRuntime.attempt++);
  var delay = Math.min(15000, 650 * Math.pow(1.8, attempt));
  delay += Math.floor(Math.random() * Math.min(650, delay * 0.2));
  wallpaperEngineBridgeRuntime.retryTimer = setTimeout(function(){
    wallpaperEngineBridgeRuntime.retryTimer = 0;
    wallpaperEngineBridgeConnect();
  }, delay);
}

function wallpaperEngineBridgePoll() {
  if (wallpaperEngineBridgeRuntime.stopped) return;
  wallpaperEngineBridgeFetchSnapshot().then(function(){
    wallpaperEngineBridgeRuntime.attempt = 0;
    wallpaperEngineBridgeRuntime.pollTimer = setTimeout(wallpaperEngineBridgePoll, 1400);
  }).catch(function(error){
    wallpaperEngineBridgeScheduleReconnect(error);
  });
}

function wallpaperEngineBridgeConnect() {
  if (wallpaperEngineBridgeRuntime.stopped) return;
  wallpaperEngineBridgeClearConnection();
  wallpaperEngineBridgeSetStatus(false);

  if (typeof EventSource !== 'function') {
    wallpaperEngineBridgePoll();
    return;
  }

  // Snapshot first makes the surface useful immediately; SSE then carries only
  // lightweight clock/motion deltas and occasional structural updates.
  wallpaperEngineBridgeFetchSnapshot().catch(function(error){
    wallpaperSurfaceRuntime.bridgeLastError = String(error && (error.message || error) || 'snapshot unavailable');
  });

  var source;
  try {
    source = new EventSource(WALLPAPER_ENGINE_BRIDGE_ORIGIN + '/events');
  } catch (error) {
    wallpaperEngineBridgeScheduleReconnect(error);
    return;
  }
  wallpaperEngineBridgeRuntime.source = source;
  source.onopen = function(){
    if (source !== wallpaperEngineBridgeRuntime.source) return;
    wallpaperEngineBridgeRuntime.attempt = 0;
    wallpaperEngineBridgeSetStatus(true);
  };
  var receive = function(event){
    if (source !== wallpaperEngineBridgeRuntime.source || !event) return;
    wallpaperEngineBridgeApply(event.data, false);
  };
  source.onmessage = receive;
  ['state', 'snapshot', 'update'].forEach(function(name){
    try { source.addEventListener(name, receive); } catch (e) {}
  });
  source.onerror = function(){
    if (source !== wallpaperEngineBridgeRuntime.source) return;
    try { source.close(); } catch (e) {}
    wallpaperEngineBridgeRuntime.source = null;
    wallpaperEngineBridgeScheduleReconnect(new Error('Mineradio App is offline'));
  };
}

function startWallpaperEngineBridge() {
  wallpaperEngineBridgeRuntime.stopped = false;
  wallpaperSurfaceRuntime.host = 'wallpaper-engine';
  wallpaperEngineBridgeConnect();
}

function stopWallpaperEngineBridge() {
  wallpaperEngineBridgeRuntime.stopped = true;
  wallpaperEngineBridgeRuntime.requestToken++;
  wallpaperEngineBridgeClearConnection();
  wallpaperEngineBridgeSetStatus(false);
}

function initWallpaperSurfaceRuntime() {
  if (!WALLPAPER_SURFACE || wallpaperSurfaceRuntime.ready) return;
  wallpaperSurfaceRuntime.ready = true;
  document.documentElement.classList.add('wallpaper-surface');
  document.body.classList.add('wallpaper-surface', 'wallpaper-hosted', 'desktop-fullscreen');
  document.body.classList.remove('splash-active', 'splash-revealing', 'empty-home-active', 'controls-visible');
  var splash = document.getElementById('splash');
  if (splash) splash.style.display = 'none';
  audio = { currentTime:0, duration:0, playbackRate:1, paused:true, ended:false, src:'', readyState:4 };
  audioCtx = null;
  source = null;
  analyser = null;
  beatAnalyser = null;
  audioReady = false;
  playing = false;
  playlist = [];
  playQueue = [];
  currentIdx = -1;
  fx.desktopLyrics = false;
  fx.wallpaperMode = true;
  fx.shelf = 'off';
  fx.cam = 'off';
  if (freeCamera) {
    freeCamera.active = false;
    freeCamera.locked = false;
    freeCamera.keys = {};
  }
  wallpaperSurfaceForcePassiveScene();
  setPreset(fx.preset, { silent:true, noSave:true, preserveCamera:false, skipTransition:true, commitPlaybackPreset:false });
  wallpaperSurfaceSyncOptionalLayers();
  syncFxUniforms();
  if (uniforms && uniforms.uAlpha) uniforms.uAlpha.value = 1;
  applySavedLyricPaletteState();
  if (typeof applyCustomBackground === 'function') applyCustomBackground();
  var bridge = window.wallpaperSurface || window.desktopOverlay;
  if (bridge && typeof bridge.onWallpaperState === 'function') {
    bridge.onWallpaperState(applyWallpaperSurfaceState);
  } else {
    startWallpaperEngineBridge();
  }
  if (bridge && typeof bridge.ready === 'function') {
    try { bridge.ready(); } catch (e) {}
  }
  window.__mineradioWallpaperSurface = {
    state: wallpaperSurfaceRuntime,
    applyState: applyWallpaperSurfaceState,
    currentTime: wallpaperSurfaceCurrentTime,
    reconnect: wallpaperEngineBridgeConnect,
    disconnect: stopWallpaperEngineBridge
  };
}

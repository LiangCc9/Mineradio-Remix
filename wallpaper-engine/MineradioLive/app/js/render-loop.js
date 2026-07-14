'use strict';

// Mineradio split module: Fault-isolated render loop.
// Loaded as a classic script to preserve existing global handlers.

function runVisualSubsystem(name, fn, context, arg1, arg2, arg3) {
  if (typeof fn !== 'function') return false;
  var now = performance.now();
  var state = visualSubsystemHealth[name] || (visualSubsystemHealth[name] = { failures: 0, total: 0, disabledUntil: 0, lastLogAt: 0, lastError: '' });
  if (state.disabledUntil > now) return false;
  try {
    fn.call(context || null, arg1, arg2, arg3);
    state.failures = 0;
    return true;
  } catch (error) {
    state.failures += 1;
    state.total += 1;
    state.lastError = error && (error.stack || error.message) || String(error);
    if (state.failures >= 3) state.disabledUntil = now + 9000;
    if (now - state.lastLogAt > 5000 || state.failures === 3) {
      state.lastLogAt = now;
      console.warn('[VisualIsolation]', name, state.failures >= 3 ? 'temporarily disabled' : 'recovered next frame', error);
    }
    return false;
  }
}

function updateSceneParticleTransforms(dt) {
  var skullPresetActive = fx && fx.preset === SKULL_PRESET_INDEX;
  var wallpaperHosted = document.body.classList.contains('wallpaper-hosted');
  var wallpaperParticles = wallpaperHosted ? normalizeWallpaperParticleMode(fx.wallpaperParticleMode) : 'full';
  var coverParticlesVisible = wallpaperParticles === 'full';
  var ambientParticlesVisible = wallpaperParticles !== 'off';
  particles.visible = !skullPresetActive && coverParticlesVisible;
  if (bloomParticles) bloomParticles.visible = !skullPresetActive && coverParticlesVisible && fx.bloom && fx.bloomStrength > 0.01;
  if (floatGroup) floatGroup.visible = !skullPresetActive && ambientParticlesVisible;
  if (backCoverGroup) backCoverGroup.visible = !skullPresetActive && coverParticlesVisible;
  var targetRotY = orbit.centerLocked ? 0 : (headParallax.active ? headParallax.x * 0.5 : 0) + gestureRotation.y;
  var targetRotX = orbit.centerLocked ? 0 : (headParallax.active ? -headParallax.y * 0.35 : 0) + gestureRotation.x;
  var rotationEase = 1 - Math.exp(-3.4 * Math.max(1 / 240, Math.min(0.08, Number(dt) || 1 / 60)));
  particles.rotation.y += (targetRotY - particles.rotation.y) * rotationEase;
  particles.rotation.x += (targetRotX - particles.rotation.x) * rotationEase;
  if (bloomParticles) bloomParticles.rotation.copy(particles.rotation);
  if (floatGroup) floatGroup.rotation.copy(particles.rotation);
  if (backCoverGroup) backCoverGroup.rotation.copy(particles.rotation);
}

function renderMainScene() {
  renderer.render(scene, camera);
}

function installVisualRuntimeRecovery() {
  var canvas = renderer && renderer.domElement;
  if (!canvas || canvas._mineradioRecoveryBound) return;
  canvas._mineradioRecoveryBound = true;
  canvas.addEventListener('webglcontextlost', function(e){
    if (e && e.preventDefault) e.preventDefault();
    var state = visualSubsystemHealth.renderer || (visualSubsystemHealth.renderer = { failures: 0, total: 0, disabledUntil: 0, lastLogAt: 0, lastError: '' });
    state.disabledUntil = Number.MAX_SAFE_INTEGER;
    state.lastError = 'webgl context lost';
    console.warn('[VisualIsolation] WebGL context lost; audio playback remains active');
  }, false);
  canvas.addEventListener('webglcontextrestored', function(){
    delete visualSubsystemHealth.renderer;
    delete visualSubsystemHealth.frame;
    applyRendererPowerMode();
    scheduleMainRendererViewportRefresh('webgl-context-restored');
    console.info('[VisualIsolation] WebGL context restored');
  }, false);
}

function isMainSceneCoveredBySplash() {
  return document.body.classList.contains('splash-active') && !document.body.classList.contains('splash-revealing');
}

function getAdaptiveRenderFps() {
  if (RENDER_VISIBLE_VSYNC) return 0;
  var tier = (typeof getRenderLoadTier === 'function') ? getRenderLoadTier() : 0;
  if (typeof isRenderInteractionActive === 'function' && isRenderInteractionActive()) {
    if (tier >= 2) return RENDER_INTERACTION_HUGE_FPS;
    if (tier >= 1) return RENDER_INTERACTION_LARGE_FPS;
    return RENDER_INTERACTION_FPS;
  }
  if (tier >= 2) return RENDER_HUGE_FPS;
  if (tier >= 1) return RENDER_LARGE_FPS;
  return RENDER_ACTIVE_FPS;
}

function shouldSkipAdaptiveRenderFrame(now) {
  var fps = getAdaptiveRenderFps();
  renderPerfState.mode = fps ? (fps + 'fps') : 'vsync';
  if (!fps) {
    renderPerfState.lastRenderAt = now;
    return false;
  }
  var minGap = 1000 / fps;
  if (now - renderPerfState.lastRenderAt < minGap) {
    renderPerfState.skipped += 1;
    return true;
  }
  renderPerfState.lastRenderAt = now;
  return false;
}

function sampleRenderPerf(now, dt) {
  renderPerfState.frames += 1;
  if (dt > 0.034) renderPerfState.longFrames += 1;
  if (now - renderPerfState.lastSampleAt >= 1000) {
    renderPerfState.fps = Math.round(renderPerfState.frames * 1000 / Math.max(1, now - renderPerfState.lastSampleAt));
    renderPerfState.frames = 0;
    renderPerfState.lastSampleAt = now;
  }
  maybeTrimRuntimeCaches(now);
}

function renderAnimationFrame() {
  var now = performance.now();
  if (shouldSkipAdaptiveRenderFrame(now)) return;
  var dt = Math.min((now - prevTime) / 1000, 0.05);
  prevTime = now;
  sampleRenderPerf(now, dt);
  uniforms.uTime.value += dt;
  if (isMainSceneCoveredBySplash()) {
    if (now - splashWarmRenderLast > 520) {
      splashWarmRenderLast = now;
      runVisualSubsystem('renderer', renderMainScene);
    }
    return;
  }
  pointerParallax.x += (pointerTarget.x - pointerParallax.x) * 0.040;
  pointerParallax.y += (pointerTarget.y - pointerParallax.y) * 0.040;

  // 频谱分析 — v7.1: 真正分离 kick 和人声
  // bin = sampleRate / fftSize = 44100/2048 ≈ 21.5Hz
  // kick 60-150Hz → bin 3-7 (用前 5 个 bin)
  // vocal 200-3000Hz → bin 9-140 (尽量不计入 bass/mid 的"鼓点"判断)
  // 真正的 mid 乐器/和声: 3000-6000Hz → bin 140-280
  // treble: 6000Hz+ → bin 280+
  beatOnsetFlag = false;
  if (WALLPAPER_SURFACE) {
    // This renderer owns no media stream.  Its clock and smoothed bands are
    // supplied by the main App over IPC and interpolated locally.
    prepareWallpaperSurfaceFrame(dt);
  } else if (analyser && playing && audio && !audio.paused) {
    if (audioCtx && audioCtx.state === 'suspended') resumeAudioAnalysis();
    analyser.getByteFrequencyData(frequencyData);
    analyser.getByteTimeDomainData(timeDomainData);
    var len = frequencyData.length;
    // 精确频段
    var kickEnd  = 7;                          // 60-150 Hz, 鼓 kick
    var vocalEnd = Math.min(len, 140);         // 200-3000 Hz, 人声主体
    var midEnd   = Math.min(len, 280);         // 3-6 kHz, 中高乐器
    // 累积
    var bKick = 0, mInst = 0, tHigh = 0, voc = 0, rms = 0;
    for (var i = 0; i < kickEnd; i++) bKick += frequencyData[i] / 255;
    for (var i = kickEnd; i < vocalEnd; i++) voc += frequencyData[i] / 255;
    for (var i = vocalEnd; i < midEnd; i++) mInst += frequencyData[i] / 255;
    for (var i = midEnd; i < len; i++) tHigh += frequencyData[i] / 255;
    for (var j = 0; j < timeDomainData.length; j++) {
      var tv = (timeDomainData[j] - 128) / 128;
      rms += tv * tv;
    }
    bKick /= kickEnd;
    voc /= (vocalEnd - kickEnd);
    mInst /= Math.max(1, midEnd - vocalEnd);
    tHigh /= Math.max(1, len - midEnd);
    rms = Math.sqrt(rms / timeDomainData.length);

    // 动态峰值跟踪
    bassPeak = Math.max(bassPeak * 0.994, bKick, 0.030);
    midPeak  = Math.max(midPeak  * 0.993, mInst, 0.026);
    treblePeak = Math.max(treblePeak * 0.992, tHigh, 0.018);
    energyPeak = Math.max(energyPeak * 0.995, rms, 0.030);

    var rb = Math.min(1, Math.pow(bKick / Math.max(0.038, bassPeak * 0.66), 0.78));
    var rm = Math.min(1, Math.pow(mInst / Math.max(0.025, midPeak  * 0.70), 0.86));
    var rt = Math.min(1, Math.pow(tHigh / Math.max(0.020, treblePeak * 0.74), 0.92));
    var re = Math.min(1, Math.pow(rms / Math.max(0.034, energyPeak * 0.68), 0.82));
    var vocalNormForDynamics = Math.min(1, Math.pow(voc / Math.max(0.045, rtBeat.vocalPeak * 0.72), 0.86));
    var adaptiveBands = updateAdaptiveMusicDynamics(dt, rms, { low: rb, mid: rm, high: rt, vocal: vocalNormForDynamics, energy: re });
    rb = adaptiveBands.low;
    rm = adaptiveBands.mid;
    rt = adaptiveBands.high;
    re = adaptiveBands.energy;

    var bassOnset = Math.max(0, rb - smoothBass);
    var energyOnset = Math.max(0, re - prevEnergy);
    prevEnergy = prevEnergy * 0.88 + re * 0.12;

    var realtimeBeat = processRealtimeBeatEngine(dt);
    if (realtimeBeat && realtimeBeat.hit) {
      var dj = djMode.active;
      var djMapCoversCurrentTime = !dj || !currentDjBeatMap || !currentDjBeatMap.partialUntilSec || !audio || (audio.currentTime || 0) <= currentDjBeatMap.partialUntilSec - 1.25;
      var djBeatMapReadyForCamera = dj && currentDjBeatMap && currentDjBeatMap.cameraBeats && currentDjBeatMap.cameraBeats.length >= 4 && djMapCoversCurrentTime;
      var beatMapReadyForCamera = dj ? djBeatMapReadyForCamera : (currentBeatMap && currentBeatMap.cameraBeats && currentBeatMap.cameraBeats.length >= 4);
      var waitingForBeatMap = dj ? !djBeatMapReadyForCamera : (!beatMapReadyForCamera && (!!beatMapBusy || !!beatAnalysisTimer || ((audio && audio.currentTime) || 0) < 18));
      var liveKickFrame = dj
        ? (realtimeBeat.low > 0.48 && rb > 0.38 && bassOnset > 0.055 && energyOnset > 0.010 && (realtimeBeat.lowDominance || 0) > 0.82)
        : (realtimeBeat.low > 0.50 && rb > 0.42 && bassOnset > 0.070 && energyOnset > 0.016);
      var liveStrongHit = dj
        ? (realtimeBeat.confidence > 0.60 && realtimeBeat.strength > 0.56 && realtimeBeat.score > 0.50 && liveKickFrame)
        : (realtimeBeat.confidence > 0.76 && realtimeBeat.strength > 0.70 && realtimeBeat.score > 0.56 && liveKickFrame);
      var liveTempoHit = dj
        ? (realtimeBeat.tempoAssist && realtimeBeat.confidence > 0.62 && realtimeBeat.strength > 0.52 && realtimeBeat.low > 0.48 && (liveKickFrame || bassOnset > 0.046))
        : (realtimeBeat.tempoAssist && realtimeBeat.confidence > 0.80 && realtimeBeat.strength > 0.66 && realtimeBeat.low > 0.50 && bassOnset > 0.052);
      var liveFallbackOk = dj
        ? (liveStrongHit || liveTempoHit)
        : (waitingForBeatMap
          ? (liveStrongHit || liveTempoHit)
          : (realtimeBeat.confidence > 0.84 && realtimeBeat.strength > 0.80 && realtimeBeat.low > 0.54 && (liveKickFrame || realtimeBeat.score > 0.68)));
      if (!beatMapReadyForCamera && liveFallbackOk) {
        scheduleBeatCamera({
          time: realtimeBeat.time,
          strength: realtimeBeat.strength,
          confidence: realtimeBeat.confidence,
          low: realtimeBeat.low,
          body: realtimeBeat.body,
          snap: realtimeBeat.snap,
          mass: realtimeBeat.mass,
          sharpness: realtimeBeat.sharpness,
          combo: realtimeBeat.combo,
          impact: clamp01(realtimeBeat.strength * 0.46 + realtimeBeat.confidence * 0.20 + realtimeBeat.low * 0.28),
          preview: waitingForBeatMap,
          primary: true,
          dj: dj
        }, 'live');
      }
      if (!beatMapReadyForCamera && liveFallbackOk) {
        var previewPulseScale = waitingForBeatMap && !dj ? 0.68 : 1;
        var rtPulse = Math.min(dj ? 0.34 : (waitingForBeatMap ? 0.46 : 0.62), realtimeBeat.strength * (realtimeBeat.tempoAssist ? (dj ? 0.42 : 0.62) : (dj ? 0.48 : 0.68)) * previewPulseScale);
        if (rtPulse > beatPulse + 0.09) beatOnsetFlag = true;
        beatPulse = Math.max(beatPulse, rtPulse);
      }
    } else if (bassOnset > 0.075 && rb > 0.32 && energyOnset > 0.020) {
      beatPulse = Math.max(beatPulse, Math.min(0.12, bassOnset * 0.18));
    }
    beatPulse *= Math.pow(0.36, dt);

    // v7.2+: 预解析 beatmap 只在实时引擎暂时没锁住时补位.
    runVisualSubsystem('podcast-beatmap', tickPodcastDjBeatMap);
    runVisualSubsystem('beatmap', tickBeatMap);
    if (scheduledBeatFlag) {
      beatOnsetFlag = true;
      scheduledBeatFlag = false;
    }
    // scheduledBeatPulse 衰减并合并到 beatPulse
    if (scheduledBeatPulse > beatPulse) beatPulse = scheduledBeatPulse;
    scheduledBeatPulse *= Math.pow(0.32, dt);

    function env(prev, next, attack, release) {
      var k = next > prev ? attack : release;
      return prev + (next - prev) * k;
    }
    // smoothBass 主要由 kick 驱动 (不被人声干扰)
    smoothBass  = env(smoothBass, Math.min(0.82, rb * 0.78 + re * 0.025), 0.28, 0.075);
    // smoothMid 用 中高乐器, 不再混入人声
    smoothMid   = env(smoothMid,  Math.min(0.68, rm * 0.64 + re * 0.025), 0.18, 0.060);
    smoothTreb  = env(smoothTreb, Math.min(0.56, rt * 0.54), 0.18, 0.055);
    smoothEnergy= env(smoothEnergy, Math.min(0.72, re), 0.16, 0.055);
    updateCinemaDynamics(re, rb);
    updateCinemaTrackProfile({ energy: re, low: rb, vocal: voc, melody: rm, lowOnset: bassOnset, energyOnset: energyOnset });
    // 歌词阳光溢光: 独立于律动强度, 看持续能量 + 中高频抬升, 更像副歌/高音段落而不是单个鼓点.
    var sunEnergy = clamp01((smoothEnergy - 0.18) / 0.38);
    var sunVoice = clamp01((voc - 0.11) / 0.34);
    var sunMelody = clamp01((smoothMid - 0.16) / 0.27);
    var sunAir = clamp01((smoothTreb - 0.105) / 0.17);
    var sunRaw = clamp01(sunEnergy * 0.36 + sunVoice * 0.18 + sunMelody * 0.26 + sunAir * 0.20);
    sunRaw = sunRaw * sunRaw * (3 - 2 * sunRaw);
    lyricSunAvg += (sunRaw - lyricSunAvg) * 0.006;
    lyricSunPeak = Math.max(0.48, lyricSunPeak * 0.9985, sunRaw);
    var sunThreshold = Math.max(0.78, lyricSunAvg + 0.20, lyricSunPeak * 0.74);
    var sunGate = clamp01((sunRaw - sunThreshold) / Math.max(0.08, 1.0 - sunThreshold));
    sunGate = sunGate * sunGate * (3 - 2 * sunGate);
    lyricSunHold += (sunGate - lyricSunHold) * (sunGate > lyricSunHold ? 0.035 : 0.014);
    lyricSunTarget = lyricSunHold > 0.16 ? clamp01((lyricSunHold - 0.16) / 0.84) : 0;
    lyricSunEnergy += (lyricSunTarget - lyricSunEnergy) * (lyricSunTarget > lyricSunEnergy ? 0.075 : 0.030);
  } else {
    smoothBass *= 0.91; smoothMid *= 0.91; smoothTreb *= 0.91; smoothEnergy *= 0.91; beatPulse *= 0.82;
    adaptiveMusicDynamics.buildup *= 0.90;
    adaptiveMusicDynamics.chorus *= 0.94;
    adaptiveMusicDynamics.chorusHold = 0;
    adaptiveMusicDynamics.chorusEntryPulse *= 0.82;
    liveCamAvg *= 0.94;
    liveCamPeak = Math.max(0.28, liveCamPeak * 0.98);
    liveCamLastRaw *= 0.80;
    lyricSunTarget = 0;
    lyricSunHold *= 0.90;
    lyricSunEnergy *= 0.92;
    lyricSunAvg *= 0.995;
    lyricSunPeak = Math.max(0.48, lyricSunPeak * 0.997);
  }
  audioEnergy = Math.max(smoothEnergy, beatPulse * 0.30);
  var chorusLift = adaptiveMusicDynamics.chorus || 0;
  var buildupLift = adaptiveMusicDynamics.buildup || 0;
  if (beatOnsetFlag && chorusLift > 0.18) beatPulse = Math.min(1.24, beatPulse + chorusLift * 0.04);
  bass = Math.min(0.90, smoothBass * 1.05 + beatPulse * 0.05) * fx.intensity;
  mid  = Math.min(0.72, smoothMid * 1.12) * fx.intensity;
  treble = Math.min(0.62, smoothTreb * 1.20) * fx.intensity;
  audioEnergy = Math.min(1, audioEnergy * (1 + buildupLift * 0.10 + chorusLift * 0.32));
  if (fx.preset >= 4) {
    var wallpaperAudio = fx.preset === 5;
    var ringBass = smoothBass * (wallpaperAudio ? 1.10 : 1.58) + beatPulse * (wallpaperAudio ? 0.06 : 0.12) - smoothMid * 0.16 - smoothTreb * 0.06;
    var ringMid = smoothMid * (wallpaperAudio ? 1.16 : 1.82) - smoothBass * 0.14 - smoothTreb * 0.07;
    var ringTreble = smoothTreb * (wallpaperAudio ? 1.34 : 2.28) - smoothMid * 0.10 - smoothBass * 0.05;
    bass = Math.pow(clamp01((ringBass - 0.050) / 0.58), 0.72) * fx.intensity;
    mid = Math.pow(clamp01((ringMid - 0.045) / 0.46), 0.78) * fx.intensity;
    treble = Math.pow(clamp01((ringTreble - 0.030) / 0.34), 0.84) * fx.intensity;
    if (wallpaperAudio) {
      bass = Math.min(bass, 0.46 * fx.intensity);
      mid = Math.min(mid, 0.40 * fx.intensity);
      treble = Math.min(treble, 0.36 * fx.intensity);
      beatPulse *= 0.34;
    }
  }
  if (djMode.active) {
    bass = Math.min(1.00, bass * 1.06 + beatPulse * 0.085);
    mid = Math.min(0.76, mid * 1.00 + clamp01(djMode.sectionChange * 1.6) * 0.020);
    treble = Math.min(0.66, treble * 0.98);
    audioEnergy = Math.max(audioEnergy, beatPulse * 0.38, djMode.sectionEnergy * 0.54);
  }
  var emotionScale = fx.preset === 5 ? 0.48 : 1;
  bass = Math.min(1.26 * fx.intensity, bass * (1 + buildupLift * 0.08 + chorusLift * 0.14 * emotionScale));
  mid = Math.min(1.04 * fx.intensity, mid * (1 + buildupLift * 0.07 + chorusLift * 0.20 * emotionScale));
  treble = Math.min(0.90 * fx.intensity, treble * (1 + buildupLift * 0.05 + chorusLift * 0.16 * emotionScale));

  var vinylSpeedMul = isFinite(fx.speed) ? Math.max(0.05, fx.speed) : 1;
  var vinylSpinSpeed = (0.40 + smoothBass * 0.09) * vinylSpeedMul;
  uniforms.uVinylSpin.value = (uniforms.uVinylSpin.value + dt * vinylSpinSpeed) % (Math.PI * 2);

  runVisualSubsystem('particle-pointer', updateParticlePointerFrame);
  uniforms.uBass.value   = bass;
  uniforms.uMid.value    = mid;
  uniforms.uTreble.value = treble;
  uniforms.uBeat.value   = beatPulse;
  uniforms.uKick.value   = smoothBass;
  uniforms.uSection.value = Math.max(currentSectionVisualDrive(), chorusLift * 0.86);
  uniforms.uEnergy.value = audioEnergy;
  uniforms.uColorBoost.value = fx.color * (1 + buildupLift * 0.05 + chorusLift * 0.22);
  uniforms.uBloomStrength.value = fx.bloom ? Math.min(1.8, fx.bloomStrength * (1 + buildupLift * 0.08 + chorusLift * 0.30 + adaptiveMusicDynamics.chorusEntryPulse * 0.16)) : 0;
  uniforms.uMouseXY.value.set(mouseWorld.x, mouseWorld.y);
  uniforms.uMouseActive.value = mouseActive ? 1 : 0;
  var skullBackdropDim = fx && fx.preset === SKULL_PRESET_INDEX ? 0.58 : 1;
  var shelfDimTarget = shouldDimWallpaperForShelf() ? 0.48 : skullBackdropDim;
  var shelfDimEase = shelfDimTarget < uniforms.uParticleDim.value ? 0.18 : 0.10;
  uniforms.uParticleDim.value += (shelfDimTarget - uniforms.uParticleDim.value) * Math.min(1, shelfDimEase * Math.max(1, dt * 60));

  // 通用转场脉冲: 只作为切换预设时的短促提亮。
  if (adaptiveMusicDynamics.chorusEntryPulse > 0.10) uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value, adaptiveMusicDynamics.chorusEntryPulse * 0.16);
  uniforms.uBurstAmt.value *= 0.94;
  runVisualSubsystem('preset-transition', tickPresetTransition);

  runVisualSubsystem('ripples', updateRipples, null, dt);
  runVisualSubsystem('float-layer', updateFloatLayer, null, dt);
  if (shelfManager) runVisualSubsystem('shelf', shelfManager.update, shelfManager, dt);
  runVisualSubsystem('lyric-particles', tickLyricsParticles);
  runVisualSubsystem('home-visual', updateHomeAudioVisual, null, dt);

  // 电影镜头
  runVisualSubsystem('cinema-camera', updateCinema, null, dt);
  runVisualSubsystem('free-camera', updateFreeCamera, null, dt);
  runVisualSubsystem('camera', updateCamera, null, dt);
  runVisualSubsystem('skull-camera', applySkullCameraPose, null, dt);

  // v7.2 旋转 = 头部+眼球追踪 + 鼠标/手势拖动 + 惯性
  runVisualSubsystem('gesture-rotation', tickGestureRotation, null, dt);
  runVisualSubsystem('particle-transforms', updateSceneParticleTransforms, null, dt);
  runVisualSubsystem('skull-particles', updateSkullParticleLayer, null, dt);
  runVisualSubsystem('stage-lyrics', updateStageLyrics3D, null, dt);
  runVisualSubsystem('desktop-overlay', syncDesktopOverlayState);

  // 缩略图脉动
  if (currentIdx >= 0) {
    var s = 1 + bass * 0.02;
    var thumbCoverEl = document.getElementById('thumb-cover');
    if (thumbCoverEl) thumbCoverEl.style.transform = 'scale(' + s + ')';
  }

  runVisualSubsystem('renderer', renderMainScene);
}

function animate() {
  requestAnimationFrame(animate);
  runVisualSubsystem('frame', renderAnimationFrame);
}

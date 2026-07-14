const { app, BrowserWindow, ipcMain, shell, screen, session, globalShortcut, dialog } = require('electron');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');

let mainWindow = null;
let localServer = null;
let mainServerPort = 0;
let desktopLyricsWindow = null;
let desktopLyricsState = {};
let desktopLyricsUserBounds = null;
let desktopLyricsProgrammaticMove = false;
let desktopLyricsPointerCapture = false;
let desktopLyricsMouseIgnored = null;
let desktopLyricsMousePoller = null;
let desktopLyricsMousePollerBuffer = '';
let desktopLyricsHotBounds = null;
let desktopLyricsLastMiddleAt = 0;
let wallpaperWindow = null;
let wallpaperState = {};
let wallpaperAttachToken = 0;
let wallpaperWorkerWAttached = false;
let wallpaperSequence = 0;
let wallpaperAttachPromise = null;
let wallpaperRecoveryTimer = null;
let wallpaperHealthTimer = null;
let wallpaperLastAttachDiagnostic = null;
let wallpaperEngineBridgeServer = null;
let wallpaperEngineBridgeStartPromise = null;
let wallpaperEngineBridgeKeepAliveTimer = null;
const wallpaperEngineBridgeClients = new Set();
let wallpaperEngineHostLaunchPromise = null;
let wallpaperEngineHostLastAttemptAt = 0;
let wallpaperEngineHostLastResult = null;
let htmlFullscreenActive = false;
let windowFullscreenActive = false;
let mainWindowStateTimer = null;
const registeredGlobalHotkeys = new Map();

const WINDOWED_ASPECT = 16 / 9;
const WINDOWED_SCALE = 3 / 4;
const WINDOWED_MARGIN = 32;
const MIN_WINDOWED_WIDTH = 960;
const MIN_WINDOWED_HEIGHT = 540;
const APP_NAME = 'Mineradio Remix';
const APP_USER_MODEL_ID = 'com.liangcc9.mineradio.remix';
const APP_ICON_ICO = path.join(__dirname, '..', 'build', 'icon.ico');
const WALLPAPER_ENGINE_BRIDGE_HOST = '127.0.0.1';
const WALLPAPER_ENGINE_BRIDGE_PORT = 17368;
const WALLPAPER_ENGINE_BRIDGE_MODE = 'wallpaper-engine-bridge';
const WALLPAPER_ENGINE_HOST_RETRY_MS = 5000;
const NETEASE_LOGIN_PARTITION = 'persist:mineradio-netease-login';
const NETEASE_LOGIN_URL = 'https://music.163.com/#/login';
const QQ_LOGIN_PARTITION = 'persist:mineradio-qqmusic-login';
const QQ_LOGIN_URL = 'https://y.qq.com/n/ryqq/profile';

const CHROMIUM_PERFORMANCE_SWITCHES = [
  ['autoplay-policy', 'no-user-gesture-required'],
  ['ignore-gpu-blocklist'],
  ['enable-gpu-rasterization'],
  ['enable-oop-rasterization'],
  ['enable-zero-copy'],
  ['enable-accelerated-2d-canvas'],
  ['disable-background-timer-throttling'],
  ['disable-renderer-backgrounding'],
  ['disable-backgrounding-occluded-windows'],
  ['force_high_performance_gpu'],
  ['use-angle', 'd3d11'],
];
for (const [name, value] of CHROMIUM_PERFORMANCE_SWITCHES) {
  if (value == null) app.commandLine.appendSwitch(name);
  else app.commandLine.appendSwitch(name, value);
}
const gotSingleInstanceLock = app.requestSingleInstanceLock();

const QQ_LOGIN_COOKIE_PRIORITY = [
  'uin',
  'qqmusic_uin',
  'wxuin',
  'login_type',
  'qm_keyst',
  'qqmusic_key',
  'p_skey',
  'skey',
  'psrf_qqopenid',
  'psrf_qqunionid',
  'psrf_qqaccess_token',
  'psrf_qqrefresh_token',
  'wxopenid',
  'wxunionid',
  'wxrefresh_token',
  'wxskey',
  'p_uin',
  'ptcz',
  'RK',
];
const NETEASE_LOGIN_COOKIE_PRIORITY = [
  'MUSIC_U',
  '__csrf',
  'NMTID',
  'MUSIC_A',
  '__remember_me',
  '_ntes_nuid',
  '_ntes_nnid',
  'WEVNSM',
  'WNMCID',
  'JSESSIONID-WYYY',
];

function findOpenPort(startPort) {
  return new Promise((resolve, reject) => {
    function tryPort(port) {
      const tester = net.createServer();

      tester.once('error', (err) => {
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
          tryPort(port + 1);
          return;
        }
        reject(err);
      });

      tester.once('listening', () => {
        tester.close(() => resolve(port));
      });

      tester.listen(port, '127.0.0.1');
    }

    tryPort(startPort);
  });
}

function waitForServer(server) {
  if (!server || server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

function sendWindowState(win) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('desktop-window-state', getWindowState(win));
}

function sendGlobalHotkeyAction(action) {
  if (!mainWindow || mainWindow.isDestroyed() || !action) return;
  mainWindow.webContents.send('mineradio-global-hotkey', { action });
}

function unregisterMineradioGlobalHotkeys() {
  for (const accelerator of registeredGlobalHotkeys.keys()) {
    try { globalShortcut.unregister(accelerator); } catch (e) {}
  }
  registeredGlobalHotkeys.clear();
}

function configureMineradioGlobalHotkeys(bindings = []) {
  unregisterMineradioGlobalHotkeys();
  const results = [];
  const seen = new Set();
  for (const item of Array.isArray(bindings) ? bindings : []) {
    const action = item && String(item.action || '').trim();
    const accelerator = item && String(item.accelerator || '').trim();
    if (!action || !accelerator || seen.has(accelerator)) continue;
    seen.add(accelerator);
    let registered = false;
    try {
      registered = globalShortcut.register(accelerator, () => sendGlobalHotkeyAction(action));
    } catch (error) {
      registered = false;
    }
    if (registered) {
      registeredGlobalHotkeys.set(accelerator, action);
      results.push({ action, accelerator, ok: true });
    } else {
      results.push({
        action,
        accelerator,
        ok: false,
        conflict: {
          sourceName: '系统 / 其他软件',
          sourceIcon: 'warning',
          reason: '该组合键已被占用或被系统保留',
        },
      });
    }
  }
  return { ok: true, results };
}

function scheduleWindowStateSend(win, delay = 80) {
  if (!win || win.isDestroyed()) return;
  if (mainWindowStateTimer) clearTimeout(mainWindowStateTimer);
  mainWindowStateTimer = setTimeout(() => {
    mainWindowStateTimer = null;
    sendWindowState(win);
  }, delay);
}

function rectsOverlapOnY(a, b) {
  if (!a || !b) return false;
  const aTop = Number(a.y) || 0;
  const bTop = Number(b.y) || 0;
  const aBottom = aTop + (Number(a.height) || 0);
  const bBottom = bTop + (Number(b.height) || 0);
  return aBottom > bTop && bBottom > aTop;
}

function getDisplayState(win) {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const display = win && !win.isDestroyed()
    ? screen.getDisplayMatching(win.getBounds())
    : primary;
  const bounds = display && display.bounds ? display.bounds : primary.bounds;
  const displayId = display && display.id;
  const primaryId = primary && primary.id;
  const edgeTolerance = 2;
  const hasDisplayOnLeft = displays.some((candidate) => {
    if (!candidate || candidate.id === displayId || !candidate.bounds) return false;
    return rectsOverlapOnY(bounds, candidate.bounds)
      && Math.abs((candidate.bounds.x + candidate.bounds.width) - bounds.x) <= edgeTolerance;
  });
  const hasDisplayOnRight = displays.some((candidate) => {
    if (!candidate || candidate.id === displayId || !candidate.bounds) return false;
    return rectsOverlapOnY(bounds, candidate.bounds)
      && Math.abs((bounds.x + bounds.width) - candidate.bounds.x) <= edgeTolerance;
  });
  return {
    displayId,
    primaryDisplayId: primaryId,
    isPrimaryDisplay: !!(display && primary && display.id === primary.id),
    hasDisplayOnLeft,
    hasDisplayOnRight,
    displayBounds: bounds ? {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    } : null,
  };
}

function getWindowState(win) {
  if (!win || win.isDestroyed()) return {
    isMaximized: false,
    isNativeFullScreen: false,
    isHtmlFullScreen: false,
    isWindowFullScreen: false,
    isFullScreen: false,
    isMinimized: false,
    isVisible: false,
    isFocused: false,
    isPrimaryDisplay: true,
    hasDisplayOnLeft: false,
    hasDisplayOnRight: false,
    displayBounds: null,
  };
  return {
    isMaximized: win.isMaximized(),
    isNativeFullScreen: win.isFullScreen(),
    isHtmlFullScreen: htmlFullscreenActive,
    isWindowFullScreen: windowFullscreenActive,
    isFullScreen: win.isFullScreen() || htmlFullscreenActive || windowFullscreenActive,
    isMinimized: win.isMinimized(),
    isVisible: win.isVisible(),
    isFocused: win.isFocused(),
    ...getDisplayState(win),
  };
}

function getSenderWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  sendWindowState(mainWindow);
  return true;
}

function getUpdateDownloadDir() {
  return path.join(app.getPath('userData'), 'updates');
}

function shouldEnsureDesktopShortcut() {
  if (process.platform !== 'win32') return false;
  if (process.env.MINERADIO_NO_DESKTOP_SHORTCUT === '1') return false;
  return app.isPackaged || process.env.MINERADIO_CREATE_DESKTOP_SHORTCUT === '1';
}

function ensureDesktopShortcut() {
  if (!shouldEnsureDesktopShortcut()) return { ok: false, skipped: true };
  try {
    const shortcutPath = path.join(app.getPath('desktop'), `${APP_NAME}.lnk`);
    const target = process.execPath;
    const shortcut = {
      target,
      cwd: path.dirname(target),
      args: '',
      description: 'Mineradio Remix desktop music player',
      icon: fs.existsSync(APP_ICON_ICO) ? APP_ICON_ICO : target,
      iconIndex: 0,
      appUserModelId: APP_USER_MODEL_ID,
    };

    if (fs.existsSync(shortcutPath) && shell.readShortcutLink) {
      try {
        const existing = shell.readShortcutLink(shortcutPath);
        if (existing && path.resolve(existing.target || '') === path.resolve(target) && String(existing.args || '') === '') {
          return { ok: true, path: shortcutPath, existing: true };
        }
      } catch (_) {}
      shell.writeShortcutLink(shortcutPath, 'replace', shortcut);
    } else {
      shell.writeShortcutLink(shortcutPath, 'create', shortcut);
    }
    return { ok: true, path: shortcutPath, created: true };
  } catch (e) {
    console.warn('Desktop shortcut creation skipped:', e.message);
    return { ok: false, error: e.message || 'DESKTOP_SHORTCUT_FAILED' };
  }
}

function parseCookieHeader(cookieText) {
  const out = {};
  String(cookieText || '').split(';').forEach((part) => {
    const raw = String(part || '').trim();
    if (!raw) return;
    const idx = raw.indexOf('=');
    if (idx <= 0) return;
    out[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
  });
  return out;
}

function qqCookieHasLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  const rawUin = Number(obj.login_type) === 2
    ? (obj.wxuin || obj.uin || obj.p_uin || '')
    : (obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin || '');
  const uin = String(rawUin).replace(/\D/g, '');
  const musicKey = obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.p_skey || obj.skey ||
    obj.psrf_qqaccess_token || obj.psrf_qqrefresh_token || obj.wxrefresh_token || obj.wxskey || '';
  return !!(uin && musicKey);
}

function qqCookieHasPlaybackLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  const rawUin = Number(obj.login_type) === 2
    ? (obj.wxuin || obj.uin || obj.p_uin || '')
    : (obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin || '');
  const uin = String(rawUin).replace(/\D/g, '');
  const playbackKey = obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.wxskey || '';
  return !!(uin && playbackKey);
}

function neteaseCookieHasLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  return !!obj.MUSIC_U;
}

function isQQCookieDomain(domain) {
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === 'qq.com' || normalized.endsWith('.qq.com') || normalized.endsWith('qqmusic.qq.com');
}

function isNeteaseCookieDomain(domain) {
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === '163.com' || normalized.endsWith('.163.com') ||
    normalized === 'music.163.com' || normalized.endsWith('.music.163.com') ||
    normalized === 'netease.com' || normalized.endsWith('.netease.com');
}

function buildCookieHeaderFor(cookies, isAllowedDomain, priority) {
  const picked = new Map();
  (cookies || []).forEach((cookie) => {
    if (!cookie || !cookie.name || !isAllowedDomain(cookie.domain)) return;
    picked.set(cookie.name, cookie.value || '');
  });

  const ordered = [];
  (priority || []).forEach((name) => {
    if (picked.has(name)) {
      ordered.push([name, picked.get(name)]);
      picked.delete(name);
    }
  });
  picked.forEach((value, name) => ordered.push([name, value]));

  return ordered
    .filter(([name, value]) => name && value != null && String(value) !== '')
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function buildCookieHeader(cookies) {
  return buildCookieHeaderFor(cookies, isQQCookieDomain, QQ_LOGIN_COOKIE_PRIORITY);
}

async function readQQLoginCookieHeader(cookieSession) {
  const cookies = await cookieSession.cookies.get({});
  return buildCookieHeader(cookies);
}

async function readNeteaseLoginCookieHeader(cookieSession) {
  const cookies = await cookieSession.cookies.get({});
  return buildCookieHeaderFor(cookies, isNeteaseCookieDomain, NETEASE_LOGIN_COOKIE_PRIORITY);
}

async function openNeteaseMusicLoginWindow(owner) {
  const cookieSession = session.fromPartition(NETEASE_LOGIN_PARTITION);
  const initialCookie = await readNeteaseLoginCookieHeader(cookieSession);
  if (neteaseCookieHasLogin(initialCookie)) return { ok: true, cookie: initialCookie, reused: true };

  return new Promise((resolve) => {
    let settled = false;
    let pollTimer = null;

    const loginWindow = new BrowserWindow({
      width: 940,
      height: 760,
      minWidth: 780,
      minHeight: 580,
      parent: owner && !owner.isDestroyed() ? owner : undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      title: '网易云音乐登录',
      backgroundColor: '#111111',
      icon: APP_ICON_ICO,
      webPreferences: {
        partition: NETEASE_LOGIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const finish = async (result) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
      resolve(result);
    };

    const checkCookies = async () => {
      try {
        const cookie = await readNeteaseLoginCookieHeader(cookieSession);
        if (neteaseCookieHasLogin(cookie)) {
          finish({ ok: true, cookie });
        }
      } catch (e) {
        console.warn('Netease login cookie check failed:', e.message);
      }
    };

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\/([^/]+\.)?(163|music\.163|netease)\.com/i.test(url)) {
        loginWindow.loadURL(url).catch((e) => console.warn('Netease login popup navigation failed:', e.message));
      } else if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url).catch(() => {});
      }
      return { action: 'deny' };
    });

    loginWindow.webContents.on('did-finish-load', () => {
      checkCookies();
      loginWindow.webContents.executeJavaScript(`
        setTimeout(() => {
          const docs = [document];
          document.querySelectorAll('iframe').forEach((frame) => {
            try { if (frame.contentDocument) docs.push(frame.contentDocument); } catch (_) {}
          });
          for (const doc of docs) {
            const nodes = Array.from(doc.querySelectorAll('a, button, span, div'));
            const loginNode = nodes.find((node) => {
              const text = (node.textContent || '').trim();
              if (!/登录|立即登录/.test(text)) return false;
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
            if (loginNode) { loginNode.click(); return true; }
          }
          return false;
        }, 900);
      `, true).catch(() => {});
    });

    loginWindow.on('ready-to-show', () => loginWindow.show());
    loginWindow.on('closed', async () => {
      if (settled) return;
      if (pollTimer) clearInterval(pollTimer);
      try {
        const cookie = await readNeteaseLoginCookieHeader(cookieSession);
        resolve(neteaseCookieHasLogin(cookie)
          ? { ok: true, cookie, partial: !qqCookieHasPlaybackLogin(cookie) }
          : { ok: false, cancelled: true, message: '网易云登录窗口已关闭' });
      } catch (e) {
        resolve({ ok: false, error: e.message || '网易云登录窗口已关闭' });
      }
    });

    pollTimer = setInterval(checkCookies, 1200);
    loginWindow.loadURL(NETEASE_LOGIN_URL).catch((e) => finish({ ok: false, error: e.message }));
  });
}

async function openQQMusicLoginWindow(owner) {
  const cookieSession = session.fromPartition(QQ_LOGIN_PARTITION);
  const initialCookie = await readQQLoginCookieHeader(cookieSession);
  if (qqCookieHasPlaybackLogin(initialCookie)) return { ok: true, cookie: initialCookie, reused: true };

  return new Promise((resolve) => {
    let settled = false;
    let pollTimer = null;
    let warmupStarted = false;

    const loginWindow = new BrowserWindow({
      width: 900,
      height: 720,
      minWidth: 760,
      minHeight: 560,
      parent: owner && !owner.isDestroyed() ? owner : undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      title: 'QQ 音乐登录',
      backgroundColor: '#111111',
      icon: APP_ICON_ICO,
      webPreferences: {
        partition: QQ_LOGIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const finish = async (result) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
      resolve(result);
    };

    const checkCookies = async () => {
      try {
        const cookie = await readQQLoginCookieHeader(cookieSession);
        if (qqCookieHasPlaybackLogin(cookie)) {
          finish({ ok: true, cookie });
        } else if (qqCookieHasLogin(cookie) && !warmupStarted) {
          warmupStarted = true;
          setTimeout(() => {
            if (!settled && loginWindow && !loginWindow.isDestroyed()) {
              loginWindow.loadURL('https://y.qq.com/n/ryqq/player').catch((e) => console.warn('QQ login warmup navigation failed:', e.message));
            }
          }, 900);
        }
      } catch (e) {
        console.warn('QQ login cookie check failed:', e.message);
      }
    };

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        loginWindow.loadURL(url).catch((e) => console.warn('QQ login popup navigation failed:', e.message));
      } else {
        shell.openExternal(url).catch(() => {});
      }
      return { action: 'deny' };
    });

    loginWindow.webContents.on('did-finish-load', () => {
      checkCookies();
      loginWindow.webContents.executeJavaScript(`
        setTimeout(() => {
          const nodes = Array.from(document.querySelectorAll('a, button, span, div'));
          const loginNode = nodes.find((node) => {
            const text = (node.textContent || '').trim();
            if (!/登录|登陆/.test(text)) return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          if (loginNode) loginNode.click();
        }, 700);
      `, true).catch(() => {});
    });

    loginWindow.on('ready-to-show', () => loginWindow.show());
    loginWindow.on('closed', async () => {
      if (settled) return;
      if (pollTimer) clearInterval(pollTimer);
      try {
        const cookie = await readQQLoginCookieHeader(cookieSession);
        resolve(qqCookieHasLogin(cookie)
          ? { ok: true, cookie }
          : { ok: false, cancelled: true, message: 'QQ 登录窗口已关闭' });
      } catch (e) {
        resolve({ ok: false, error: e.message || 'QQ 登录窗口已关闭' });
      }
    });

    pollTimer = setInterval(checkCookies, 1200);
    loginWindow.loadURL(QQ_LOGIN_URL).catch((e) => finish({ ok: false, error: e.message }));
  });
}

async function clearQQMusicLoginSession() {
  const cookieSession = session.fromPartition(QQ_LOGIN_PARTITION);
  await cookieSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'],
  });
  return { ok: true };
}

async function clearNeteaseMusicLoginSession() {
  const cookieSession = session.fromPartition(NETEASE_LOGIN_PARTITION);
  await cookieSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'],
  });
  return { ok: true };
}

function getWindowedBounds(win) {
  const display = win && !win.isDestroyed()
    ? screen.getDisplayMatching(win.getBounds())
    : screen.getPrimaryDisplay();
  const area = display.workArea;
  const basis = display.bounds || area;
  const maxWidth = Math.max(640, area.width - WINDOWED_MARGIN);
  const maxHeight = Math.max(360, area.height - WINDOWED_MARGIN);

  let width = Math.round(basis.width * WINDOWED_SCALE);
  let height = Math.round(width / WINDOWED_ASPECT);
  const scaledHeight = Math.round(basis.height * WINDOWED_SCALE);

  if (height > scaledHeight) {
    height = scaledHeight;
    width = Math.round(height * WINDOWED_ASPECT);
  }

  if (width < MIN_WINDOWED_WIDTH && maxWidth >= MIN_WINDOWED_WIDTH && maxHeight >= MIN_WINDOWED_HEIGHT) {
    width = MIN_WINDOWED_WIDTH;
    height = MIN_WINDOWED_HEIGHT;
  }

  if (width > maxWidth) {
    width = maxWidth;
    height = Math.round(width / WINDOWED_ASPECT);
  }
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * WINDOWED_ASPECT);
  }

  width = Math.round(width);
  height = Math.round(height);

  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

function applyWindowedBounds(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized()) win.unmaximize();
  win.setMinimumSize(MIN_WINDOWED_WIDTH, MIN_WINDOWED_HEIGHT);
  win.setBounds(getWindowedBounds(win), false);
  sendWindowState(win);
}

function exitFullscreenToWindow(win) {
  if (!win || win.isDestroyed()) return;
  windowFullscreenActive = false;

  if (!win.isFullScreen()) {
    applyWindowedBounds(win);
    return;
  }

  let applied = false;
  const applyOnce = () => {
    if (applied || !win || win.isDestroyed() || win.isFullScreen()) return;
    applied = true;
    applyWindowedBounds(win);
  };

  win.once('leave-full-screen', () => setTimeout(applyOnce, 50));
  win.setFullScreen(false);
  setTimeout(applyOnce, 500);
}

function toggleFullscreen(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isFullScreen() || windowFullscreenActive) {
    exitFullscreenToWindow(win);
    return;
  }
  windowFullscreenActive = true;
  win.setFullScreen(true);
  sendWindowState(win);
}

function overlayUrl(page) {
  const port = mainServerPort || process.env.PORT || 3000;
  return `http://127.0.0.1:${port}/${page}`;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function desktopLyricsDefaultBounds(payload = desktopLyricsState) {
  const display = desktopLyricsUserBounds
    ? screen.getDisplayMatching(desktopLyricsUserBounds)
    : screen.getPrimaryDisplay();
  const bounds = display.bounds;
  const yRatio = clampNumber(payload.y, 0.08, 0.92, 0.76);
  const width = Math.round(Math.min(Math.max(880, bounds.width * 0.72), bounds.width - 96));
  const height = Math.round(Math.min(Math.max(340, bounds.height * 0.38), 560, bounds.height - 96));
  return {
    x: Math.round(bounds.x + (bounds.width - width) / 2),
    y: Math.round(bounds.y + bounds.height * yRatio - height / 2),
    width,
    height,
  };
}

function constrainDesktopLyricsBounds(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const area = display.bounds;
  const next = {
    ...bounds,
    width: Math.round(Math.min(Math.max(320, bounds.width), area.width)),
    height: Math.round(Math.min(Math.max(180, bounds.height), area.height)),
  };
  const maxX = area.x + Math.max(0, area.width - next.width);
  const maxY = area.y + Math.max(0, area.height - next.height);
  next.x = Math.round(clampNumber(next.x, area.x, maxX, area.x));
  next.y = Math.round(clampNumber(next.y, area.y, maxY, area.y));
  return next;
}

function setDesktopLyricsBounds(bounds) {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const nextBounds = constrainDesktopLyricsBounds(bounds);
  const currentBounds = desktopLyricsWindow.getBounds();
  if (
    currentBounds.x === nextBounds.x
    && currentBounds.y === nextBounds.y
    && currentBounds.width === nextBounds.width
    && currentBounds.height === nextBounds.height
  ) {
    return;
  }
  desktopLyricsProgrammaticMove = true;
  desktopLyricsWindow.setBounds(nextBounds, false);
  setTimeout(() => {
    desktopLyricsProgrammaticMove = false;
  }, 120);
}

function rememberDesktopLyricsBounds() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed() || desktopLyricsProgrammaticMove) return;
  desktopLyricsUserBounds = desktopLyricsWindow.getBounds();
}

function applyDesktopLyricsMouseBehavior() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const locked = desktopLyricsState.clickThrough !== false;
  const shouldIgnore = locked || !desktopLyricsPointerCapture;
  if (desktopLyricsMouseIgnored === shouldIgnore) return;
  desktopLyricsMouseIgnored = shouldIgnore;
  desktopLyricsWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true });
}

function desktopLyricsHotBoundsOnScreen() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return null;
  const winBounds = desktopLyricsWindow.getBounds();
  const rel = desktopLyricsHotBounds;
  if (!rel) return winBounds;
  return {
    x: winBounds.x + rel.left,
    y: winBounds.y + rel.top,
    width: Math.max(1, rel.right - rel.left),
    height: Math.max(1, rel.bottom - rel.top),
  };
}

function pointInBounds(point, bounds) {
  if (!point || !bounds) return false;
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height;
}

function handleDesktopLyricsGlobalMiddleClick() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  if (!desktopLyricsState.enabled) return;
  const now = Date.now();
  if (now - desktopLyricsLastMiddleAt < 260) return;
  const point = screen.getCursorScreenPoint();
  if (!pointInBounds(point, desktopLyricsHotBoundsOnScreen())) return;
  desktopLyricsLastMiddleAt = now;
  const nextLocked = desktopLyricsState.clickThrough === false;
  desktopLyricsState = { ...desktopLyricsState, clickThrough: nextLocked };
  desktopLyricsPointerCapture = !nextLocked;
  applyDesktopLyricsMouseBehavior();
  broadcastDesktopLyricsLockState();
}

function startDesktopLyricsMousePoller() {
  if (process.platform !== 'win32' || desktopLyricsMousePoller) return;
  const script = `
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class MineradioMousePoll {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
"@
$prev = $false
while ($true) {
  $down = (([MineradioMousePoll]::GetAsyncKeyState(4) -band 0x8000) -ne 0)
  if ($down -and -not $prev) {
    [Console]::Out.WriteLine("MMB")
    [Console]::Out.Flush()
  }
  $prev = $down
  Start-Sleep -Milliseconds 24
}
`;
  try {
    desktopLyricsMousePoller = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    desktopLyricsMousePoller.stdout.on('data', (chunk) => {
      desktopLyricsMousePollerBuffer += chunk.toString('utf8');
      const lines = desktopLyricsMousePollerBuffer.split(/\r?\n/);
      desktopLyricsMousePollerBuffer = lines.pop() || '';
      lines.forEach((line) => {
        if (line.trim() === 'MMB') handleDesktopLyricsGlobalMiddleClick();
      });
    });
    desktopLyricsMousePoller.on('exit', () => {
      desktopLyricsMousePoller = null;
      desktopLyricsMousePollerBuffer = '';
    });
    desktopLyricsMousePoller.on('error', () => {
      desktopLyricsMousePoller = null;
      desktopLyricsMousePollerBuffer = '';
    });
  } catch (e) {
    desktopLyricsMousePoller = null;
    desktopLyricsMousePollerBuffer = '';
  }
}

function stopDesktopLyricsMousePoller() {
  if (!desktopLyricsMousePoller) return;
  try {
    desktopLyricsMousePoller.kill();
  } catch (e) {}
  desktopLyricsMousePoller = null;
  desktopLyricsMousePollerBuffer = '';
}

function broadcastDesktopLyricsLockState() {
  const locked = desktopLyricsState.clickThrough !== false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mineradio-desktop-lyrics-lock-state', { locked });
  }
  sendDesktopLyricsState();
}

function broadcastDesktopLyricsEnabledState(enabled) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mineradio-desktop-lyrics-enabled-state', { enabled: !!enabled });
  }
}

function positionDesktopLyricsWindow(payload = desktopLyricsState, options = {}) {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const shouldUseManualBounds = desktopLyricsUserBounds && !options.force;
  setDesktopLyricsBounds(shouldUseManualBounds ? desktopLyricsUserBounds : desktopLyricsDefaultBounds(payload));
  if (typeof desktopLyricsWindow.setOpacity === 'function') {
    desktopLyricsWindow.setOpacity(clampNumber(payload.opacity, 0.28, 1, 0.92));
  }
}

function sendDesktopLyricsState() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  desktopLyricsWindow.webContents.send('mineradio-desktop-lyrics-state', desktopLyricsState);
}

function createDesktopLyricsWindow(payload = {}) {
  const previousY = desktopLyricsState.y;
  const previousOpacity = desktopLyricsState.opacity;
  desktopLyricsState = { ...desktopLyricsState, ...payload, enabled: true };
  const hasY = Object.prototype.hasOwnProperty.call(payload || {}, 'y');
  const nextY = clampNumber(desktopLyricsState.y, 0.08, 0.92, 0.76);
  const yChanged = hasY && Number.isFinite(Number(previousY)) && Math.abs(nextY - clampNumber(previousY, 0.08, 0.92, 0.76)) > 0.001;
  const opacityChanged = Object.prototype.hasOwnProperty.call(payload || {}, 'opacity')
    && Math.abs(clampNumber(desktopLyricsState.opacity, 0.28, 1, 0.92) - clampNumber(previousOpacity, 0.28, 1, 0.92)) > 0.001;
  if (yChanged) desktopLyricsUserBounds = null;
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    if (yChanged) {
      positionDesktopLyricsWindow(desktopLyricsState, { force: yChanged });
    } else if (opacityChanged && typeof desktopLyricsWindow.setOpacity === 'function') {
      desktopLyricsWindow.setOpacity(clampNumber(desktopLyricsState.opacity, 0.28, 1, 0.92));
    }
    applyDesktopLyricsMouseBehavior();
    sendDesktopLyricsState();
    return desktopLyricsWindow;
  }

  desktopLyricsWindow = new BrowserWindow({
    width: 920,
    height: 190,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: true,
    focusable: false,
    skipTaskbar: true,
    show: false,
    title: 'Mineradio Desktop Lyrics',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  try {
    desktopLyricsWindow.setAlwaysOnTop(true, 'screen-saver');
    desktopLyricsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (e) {
    console.warn('Desktop lyrics topmost setup skipped:', e.message);
  }
  startDesktopLyricsMousePoller();
  applyDesktopLyricsMouseBehavior();
  positionDesktopLyricsWindow(desktopLyricsState, { force: yChanged || !desktopLyricsUserBounds });
  desktopLyricsWindow.once('ready-to-show', () => {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
    desktopLyricsWindow.showInactive();
    sendDesktopLyricsState();
  });
  desktopLyricsWindow.webContents.once('did-finish-load', sendDesktopLyricsState);
  desktopLyricsWindow.on('closed', () => {
    desktopLyricsWindow = null;
    desktopLyricsMouseIgnored = null;
  });
  desktopLyricsWindow.on('moved', rememberDesktopLyricsBounds);
  desktopLyricsWindow.loadURL(overlayUrl('desktop-lyrics.html')).catch((e) => console.warn('Desktop lyrics load failed:', e.message));
  return desktopLyricsWindow;
}

function closeDesktopLyricsWindow() {
  desktopLyricsState = { ...desktopLyricsState, enabled: false };
  desktopLyricsPointerCapture = false;
  desktopLyricsMouseIgnored = null;
  desktopLyricsHotBounds = null;
  stopDesktopLyricsMousePoller();
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    sendDesktopLyricsState();
    desktopLyricsWindow.close();
  }
  desktopLyricsWindow = null;
  broadcastDesktopLyricsEnabledState(false);
}

function nativeWindowHandleDecimal(win) {
  const handle = win.getNativeWindowHandle();
  // HWND follows the process pointer width. Windows ARM64 is 64-bit too; only
  // ia32 may safely read the four-byte form.
  if (process.arch === 'ia32') return String(handle.readUInt32LE(0));
  return handle.readBigUInt64LE(0).toString();
}

function writeWallpaperAttachDiagnostic(diagnostic = {}) {
  try {
    const safe = {
      at: new Date().toISOString(),
      ok: diagnostic.ok === true,
      mode: String(diagnostic.mode || ''),
      error: String(diagnostic.error || '').slice(0, 2400),
      attempt: Number(diagnostic.attempt) || 0,
      target: String(diagnostic.target || ''),
      host: String(diagnostic.host || ''),
      parent: String(diagnostic.parent || ''),
      shell: String(diagnostic.shell || ''),
      icon: String(diagnostic.icon || ''),
      worker: String(diagnostic.worker || ''),
      width: Number(diagnostic.width) || 0,
      height: Number(diagnostic.height) || 0,
      visible: diagnostic.visible === true,
      raised: diagnostic.raised === true,
    };
    fs.writeFileSync(
      path.join(app.getPath('userData'), 'wallpaper-attach-diagnostic.json'),
      JSON.stringify(safe, null, 2),
      'utf8'
    );
  } catch (e) {}
}

function captureWallpaperRendererDiagnostic(win) {
  if (!win || win.isDestroyed() || win.__mineradioDiagnosticCaptureScheduled) return;
  win.__mineradioDiagnosticCaptureScheduled = true;
  setTimeout(async () => {
    if (!win || win.isDestroyed()) return;
    try {
      const state = await win.webContents.executeJavaScript(`(() => ({
        at: new Date().toISOString(),
        href: location.href,
        readyState: document.readyState,
        surface: window.__MINERADIO_SURFACE__ || '',
        htmlClass: document.documentElement.className,
        bodyClass: document.body ? document.body.className : '',
        bodyParticles: document.body ? document.body.getAttribute('data-wallpaper-particles') : '',
        wallpaper: window.__mineradioWallpaperSurface ? {
          ready: !!window.__mineradioWallpaperSurface.state.ready,
          enabled: !!window.__mineradioWallpaperSurface.state.enabled,
          sequence: Number(window.__mineradioWallpaperSurface.state.sequence) || 0,
          trackKey: String(window.__mineradioWallpaperSurface.state.trackKey || ''),
          receivedAt: Number(window.__mineradioWallpaperSurface.state.receivedAt) || 0
        } : null,
        canvas: Array.from(document.querySelectorAll('canvas')).slice(0, 8).map((node) => ({
          id: node.id || '', width: node.width || 0, height: node.height || 0,
          clientWidth: node.clientWidth || 0, clientHeight: node.clientHeight || 0
        }))
      }))()`);
      fs.writeFileSync(
        path.join(app.getPath('userData'), 'wallpaper-render-diagnostic.json'),
        JSON.stringify(state || {}, null, 2),
        'utf8'
      );
      const image = await win.webContents.capturePage();
      if (image && !image.isEmpty()) {
        fs.writeFileSync(path.join(app.getPath('userData'), 'wallpaper-render-diagnostic.png'), image.toPNG());
      }
    } catch (e) {
      try {
        fs.writeFileSync(
          path.join(app.getPath('userData'), 'wallpaper-render-diagnostic.json'),
          JSON.stringify({ at: new Date().toISOString(), error: String(e && e.message || e || 'CAPTURE_FAILED') }, null, 2),
          'utf8'
        );
      } catch (ignored) {}
    }
  }, 1600);
}

function attachWallpaperToWorkerW(win, attemptNumber, done) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) {
    if (typeof done === 'function') done(false, { error: 'UNSUPPORTED_WALLPAPER_HOST' });
    return;
  }
  const hwnd = nativeWindowHandleDecimal(win);
  const displayBounds = screen.getPrimaryDisplay().bounds;
  const script = `
$ErrorActionPreference = "Stop"
if (-not ("MineradioNativeWin" -as [type])) {
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class MineradioNativeWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetShellWindow();
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowName);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetParent(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)] public static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);
  [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", SetLastError=true)] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool RedrawWindow(IntPtr hWnd, IntPtr updateRect, IntPtr updateRegion, uint flags);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
}
$progman = [MineradioNativeWin]::FindWindow("Progman", $null)
$shellWindow = [MineradioNativeWin]::GetShellWindow()
$messageHost = if ($progman -ne [IntPtr]::Zero) { $progman } else { $shellWindow }
if ($messageHost -eq [IntPtr]::Zero) { throw "Windows desktop shell window was not found" }

# Windows 11 24H2 and newer use the raised-desktop path (0xD, 0/1), while
# older Explorer builds may still require the legacy zero-parameter message.
# Do not send the legacy message on 24H2+: it can rebuild/cover the raised host
# we just requested on some Insider Explorer builds.
$result = [IntPtr]::Zero
[MineradioNativeWin]::SendMessageTimeout($messageHost, 0x052C, [IntPtr]::new(0xD), [IntPtr]::Zero, 0, 1000, [ref]$result) | Out-Null
[MineradioNativeWin]::SendMessageTimeout($messageHost, 0x052C, [IntPtr]::new(0xD), [IntPtr]::new(1), 0, 1000, [ref]$result) | Out-Null
$osBuild = [Environment]::OSVersion.Version.Build
if ($osBuild -lt 26100) {
  [MineradioNativeWin]::SendMessageTimeout($messageHost, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 0, 1000, [ref]$result) | Out-Null
}
Start-Sleep -Milliseconds 70

$script:shellView = [IntPtr]::Zero
$script:shellTop = [IntPtr]::Zero
$script:classicWorker = [IntPtr]::Zero
$script:firstVisibleEmptyWorker = [IntPtr]::Zero
$script:firstEmptyWorker = [IntPtr]::Zero
$enum = [MineradioNativeWin+EnumWindowsProc]{
  param([IntPtr]$top, [IntPtr]$param)
  $shell = [MineradioNativeWin]::FindWindowEx($top, [IntPtr]::Zero, "SHELLDLL_DefView", $null)
  if ($shell -ne [IntPtr]::Zero) {
    if ($script:shellView -eq [IntPtr]::Zero) {
      $script:shellView = $shell
      $script:shellTop = $top
      $script:classicWorker = [MineradioNativeWin]::FindWindowEx([IntPtr]::Zero, $top, "WorkerW", $null)
    }
  } else {
    $className = New-Object System.Text.StringBuilder 64
    [MineradioNativeWin]::GetClassName($top, $className, $className.Capacity) | Out-Null
    if ($className.ToString() -eq "WorkerW") {
      if ($script:firstEmptyWorker -eq [IntPtr]::Zero) { $script:firstEmptyWorker = $top }
      if ($script:firstVisibleEmptyWorker -eq [IntPtr]::Zero -and [MineradioNativeWin]::IsWindowVisible($top)) {
        $script:firstVisibleEmptyWorker = $top
      }
    }
  }
  return $true
}
[MineradioNativeWin]::EnumWindows($enum, [IntPtr]::Zero) | Out-Null

# On raised desktop builds SHELLDLL_DefView can be a layered child of Progman
# or of the handle returned by GetShellWindow (newer Explorer builds may not
# expose a top-level window whose class is literally "Progman"). In either
# layout, parent beside the icon view. Classic builds continue to use the empty
# WorkerW after DefView.
$shellParent = if ($script:shellView -ne [IntPtr]::Zero) { [MineradioNativeWin]::GetParent($script:shellView) } else { [IntPtr]::Zero }
$raisedWallpaperWorker = [IntPtr]::Zero
if ($shellParent -ne [IntPtr]::Zero) {
  $workerCursor = [IntPtr]::Zero
  while ($true) {
    $workerCursor = [MineradioNativeWin]::FindWindowEx($shellParent, $workerCursor, "WorkerW", $null)
    if ($workerCursor -eq [IntPtr]::Zero) { break }
    if ([MineradioNativeWin]::IsWindowVisible($workerCursor)) {
      $raisedWallpaperWorker = $workerCursor
      break
    }
  }
}
$iconView = if ($script:shellView -ne [IntPtr]::Zero) { [MineradioNativeWin]::FindWindowEx($script:shellView, [IntPtr]::Zero, "SysListView32", "FolderView") } else { [IntPtr]::Zero }
if ($iconView -eq [IntPtr]::Zero -and $script:shellView -ne [IntPtr]::Zero) {
  $iconView = [MineradioNativeWin]::FindWindowEx($script:shellView, [IntPtr]::Zero, "SysListView32", $null)
}
if ($iconView -eq [IntPtr]::Zero -and $script:shellView -ne [IntPtr]::Zero) {
  $iconView = [MineradioNativeWin]::FindWindowEx($script:shellView, [IntPtr]::Zero, "DirectUIHWND", $null)
}
$shellHostEx = if ($shellParent -ne [IntPtr]::Zero) { [MineradioNativeWin]::GetWindowLong($shellParent, -20) } else { 0 }
$shellEx = if ($script:shellView -ne [IntPtr]::Zero) { [MineradioNativeWin]::GetWindowLong($script:shellView, -20) } else { 0 }
$raisedDesktop = $script:shellView -ne [IntPtr]::Zero -and $shellParent -ne [IntPtr]::Zero -and (
  ($progman -eq [IntPtr]::Zero) -or
  ($shellParent -eq $progman) -or
  ($shellWindow -ne [IntPtr]::Zero -and $shellParent -eq $shellWindow) -or
  (($shellHostEx -band 0x00200000) -ne 0) -or
  (($shellEx -band 0x00080000) -ne 0)
)
$wallpaperHost = [IntPtr]::Zero
$insertAfter = [IntPtr]::new(1)
$mode = ""
if ($raisedDesktop) {
  # Windows 11's raised desktop keeps a full-size child WorkerW under Progman:
  # that WorkerW paints the stock wallpaper, while DefView/SysListView32 remain
  # a sibling icon layer above it. A child of this WorkerW is therefore above
  # the stock image but still below desktop icons.
  if ($raisedWallpaperWorker -ne [IntPtr]::Zero) {
    $wallpaperHost = $raisedWallpaperWorker
    $insertAfter = [IntPtr]::new(1)
    $mode = "raised-workerw-child"
  } else {
    $wallpaperHost = $script:shellView
    $insertAfter = if ($iconView -ne [IntPtr]::Zero) { $iconView } else { [IntPtr]::new(1) }
    $mode = "raised-defview-fallback"
  }
} elseif ($script:classicWorker -ne [IntPtr]::Zero) {
  $wallpaperHost = $script:classicWorker
  $mode = "classic-workerw"
} elseif ($script:firstVisibleEmptyWorker -ne [IntPtr]::Zero) {
  $wallpaperHost = $script:firstVisibleEmptyWorker
  $mode = "visible-workerw"
} elseif ($script:firstEmptyWorker -ne [IntPtr]::Zero) {
  $wallpaperHost = $script:firstEmptyWorker
  $mode = "workerw-fallback"
} elseif ($script:shellView -ne [IntPtr]::Zero -and $shellParent -ne [IntPtr]::Zero) {
  $wallpaperHost = $shellParent
  $insertAfter = $script:shellView
  $mode = "shell-parent"
} elseif ($shellWindow -ne [IntPtr]::Zero) {
  $wallpaperHost = $shellWindow
  $mode = "shell-window-fallback"
} else {
  $wallpaperHost = $progman
  $mode = "progman-fallback"
}
if ($wallpaperHost -eq [IntPtr]::Zero -or -not [MineradioNativeWin]::IsWindow($wallpaperHost)) { throw "Windows desktop wallpaper host was not found" }

$target = [IntPtr]::new([Int64]${hwnd})
if (-not [MineradioNativeWin]::IsWindow($target)) { throw "Wallpaper HWND is no longer valid" }
[MineradioNativeWin]::ShowWindow($wallpaperHost, 8) | Out-Null
$setParentResult = [MineradioNativeWin]::SetParent($target, $wallpaperHost)
$setParentError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()

# SetParent does not update WS_POPUP / WS_CHILD itself.  Keeping Electron's
# top-level WS_POPUP style makes Windows' "Show desktop" hide the overlay even
# though its HWND has a WorkerW parent.  Make it a real child/tool window so it
# behaves like wallpaper and remains behind the desktop icons.
$style = [MineradioNativeWin]::GetWindowLong($target, -16)
$style = ($style -band 0x7FFFFFFF) -bor 0x40000000
[MineradioNativeWin]::SetWindowLong($target, -16, $style) | Out-Null
$exStyle = [MineradioNativeWin]::GetWindowLong($target, -20)
# Electron creates transparent top-level windows with WS_EX_LAYERED and
# WS_EX_NOREDIRECTIONBITMAP. Once reparented into Explorer those flags can keep
# Chromium's DirectComposition surface alive internally while preventing it
# from being submitted into the desktop child-window tree. Clear both together
# with the top-level-only bits; click-through is still enforced by Electron.
$exStyle = ($exStyle -band (-bnot 0x002C0008)) -bor 0x08000080
[MineradioNativeWin]::SetWindowLong($target, -20, $exStyle) | Out-Null
$appliedStyle = [MineradioNativeWin]::GetWindowLong($target, -16)
if (($appliedStyle -band 0x40000000) -eq 0 -or ($appliedStyle -band 0x80000000) -ne 0) {
  throw "Wallpaper window styles did not switch from WS_POPUP to WS_CHILD"
}
$parent = [MineradioNativeWin]::GetParent($target)
if ($parent -ne $wallpaperHost) {
  throw ("SetParent did not attach the wallpaper window to the selected desktop host; target={0}; host={1}; returned={2}; parent={3}; win32={4}; mode={5}; shell={6}; shellParent={7}" -f $target.ToInt64(), $wallpaperHost.ToInt64(), $setParentResult.ToInt64(), $parent.ToInt64(), $setParentError, $mode, $script:shellView.ToInt64(), $shellParent.ToInt64())
}

$client = New-Object MineradioNativeWin+RECT
$clientOk = [MineradioNativeWin]::GetClientRect($wallpaperHost, [ref]$client)
$width = if ($clientOk -and ($client.Right - $client.Left) -gt 0) { $client.Right - $client.Left } else { ${displayBounds.width} }
$height = if ($clientOk -and ($client.Bottom - $client.Top) -gt 0) { $client.Bottom - $client.Top } else { ${displayBounds.height} }

# Apply the style, size, z-order and visibility atomically.  Native ShowWindow
# is required here because Electron created the BrowserWindow with show:false;
# relying on BrowserWindow.showInactive after reparenting is unreliable on
# raised desktop builds and can also disturb the icon-layer z-order.
$positioned = [MineradioNativeWin]::SetWindowPos($target, $insertAfter, 0, 0, $width, $height, 0x0070)
if (-not $positioned) { throw "SetWindowPos failed while finalizing the wallpaper window" }
[MineradioNativeWin]::ShowWindow($target, 8) | Out-Null
[MineradioNativeWin]::RedrawWindow($target, [IntPtr]::Zero, [IntPtr]::Zero, 0x0101) | Out-Null
$visible = [MineradioNativeWin]::IsWindowVisible($target)
if (-not $visible) { throw "Wallpaper window remained hidden after native ShowWindow" }

[ordered]@{
  ok = $true
  mode = $mode
  target = $target.ToInt64().ToString()
  host = $wallpaperHost.ToInt64().ToString()
  parent = ([MineradioNativeWin]::GetParent($target)).ToInt64().ToString()
  shell = $script:shellView.ToInt64().ToString()
  icon = $iconView.ToInt64().ToString()
  worker = $raisedWallpaperWorker.ToInt64().ToString()
  width = $width
  height = $height
  visible = $visible
  raised = $raisedDesktop
} | ConvertTo-Json -Compress
`;
  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
    timeout: 7000,
  }, (error, stdout, stderr) => {
    let diagnostic = null;
    const output = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
    if (output.length) {
      try { diagnostic = JSON.parse(output[output.length - 1]); } catch (e) {}
    }
    if (!diagnostic) diagnostic = {};
    if (error) {
      diagnostic.error = String((stderr || error.message || 'WORKERW_ATTACH_FAILED')).trim();
      console.warn('Wallpaper WorkerW attach failed:', diagnostic.error);
    }
    diagnostic.ok = !error && diagnostic.ok === true;
    diagnostic.attempt = Number(attemptNumber) || 0;
    writeWallpaperAttachDiagnostic(diagnostic);
    if (typeof done === 'function') done(!error && diagnostic.ok === true, diagnostic);
  });
}

function clearWallpaperRecoveryTimers() {
  if (wallpaperRecoveryTimer) clearTimeout(wallpaperRecoveryTimer);
  if (wallpaperHealthTimer) clearTimeout(wallpaperHealthTimer);
  wallpaperRecoveryTimer = null;
  wallpaperHealthTimer = null;
}

function scheduleWallpaperRecovery(label, delay = 6500) {
  if (wallpaperRecoveryTimer) clearTimeout(wallpaperRecoveryTimer);
  wallpaperRecoveryTimer = setTimeout(() => {
    wallpaperRecoveryTimer = null;
    if (!wallpaperState.enabled || !wallpaperWindow || wallpaperWindow.isDestroyed()) return;
    attachAndShowWallpaperWindow(wallpaperWindow, sendWallpaperState, label || 'Wallpaper recovery', { force: true })
      .then((result) => {
        if (!result || !result.ok) scheduleWallpaperRecovery(label, 9000);
      });
  }, Math.max(800, delay));
}

function scheduleWallpaperHealthCheck() {
  if (wallpaperHealthTimer) clearTimeout(wallpaperHealthTimer);
  wallpaperHealthTimer = setTimeout(() => {
    wallpaperHealthTimer = null;
    if (!wallpaperState.enabled || !wallpaperWindow || wallpaperWindow.isDestroyed()) return;
    // Explorer recreates its WorkerW hierarchy after theme, virtual-desktop and
    // shell changes. Reassert the parent/z-order at a low cadence so the live
    // surface recovers without asking the user to toggle the feature off/on.
    attachAndShowWallpaperWindow(wallpaperWindow, sendWallpaperState, 'Wallpaper health check', { force: true })
      .then((result) => {
        if (!result || !result.ok) scheduleWallpaperRecovery('Wallpaper health recovery', 2500);
      });
  }, 30000);
}

function attachAndShowWallpaperWindow(win, onShown, label, options = {}) {
  if (!win || win.isDestroyed()) return Promise.resolve({ ok: false, error: 'NO_WALLPAPER_WINDOW' });
  if (wallpaperAttachPromise) return wallpaperAttachPromise;
  if (!options.force && wallpaperWorkerWAttached && win.isVisible()) {
    return Promise.resolve({ ok: true, ...(wallpaperLastAttachDiagnostic || {}) });
  }

  const token = ++wallpaperAttachToken;
  const wasAttached = wallpaperWorkerWAttached;
  wallpaperWorkerWAttached = false;
  let attempt = 0;
  if (!wasAttached && win.isVisible()) win.hide();
  if (typeof win.setFocusable === 'function') win.setFocusable(false);
  win.setSkipTaskbar(true);
  win.setIgnoreMouseEvents(true, { forward: true });
  // BrowserWindow bounds are screen-relative only while it is top-level. The
  // native attach step sizes the child to its actual desktop host afterwards.
  if (!wasAttached) positionWallpaperWindow();

  wallpaperAttachPromise = new Promise((resolve) => {
    const finish = (result) => {
      if (wallpaperAttachPromise) wallpaperAttachPromise = null;
      resolve(result);
    };
    const tryAttach = () => {
      if (!win || win.isDestroyed() || token !== wallpaperAttachToken || wallpaperWindow !== win) {
        finish({ ok: false, cancelled: true, error: 'WALLPAPER_ATTACH_CANCELLED' });
        return;
      }
      attempt += 1;
      attachWallpaperToWorkerW(win, attempt, (attached, diagnostic) => {
        if (!win || win.isDestroyed() || token !== wallpaperAttachToken || wallpaperWindow !== win) {
          finish({ ok: false, cancelled: true, error: 'WALLPAPER_ATTACH_CANCELLED' });
          return;
        }
        wallpaperLastAttachDiagnostic = { ...(diagnostic || {}), attempt };
        if (attached) {
          wallpaperWorkerWAttached = true;
          if (typeof win.setFocusable === 'function') win.setFocusable(false);
          win.setSkipTaskbar(true);
          win.setIgnoreMouseEvents(true, { forward: true });
          try { win.webContents.invalidate(); } catch (e) {}
          console.info(`${label || 'Wallpaper'} attached:`, wallpaperLastAttachDiagnostic);
          if (typeof onShown === 'function') onShown();
          captureWallpaperRendererDiagnostic(win);
          scheduleWallpaperHealthCheck();
          finish({ ok: true, ...wallpaperLastAttachDiagnostic });
          return;
        }
        if (attempt < 4) {
          setTimeout(tryAttach, Math.min(1000, attempt * 240));
          return;
        }
        wallpaperWorkerWAttached = false;
        const error = wallpaperLastAttachDiagnostic.error || 'WORKERW_ATTACH_FAILED';
        console.warn(`${label || 'Wallpaper'} WorkerW attach failed after ${attempt} attempts; retry remains armed.`);
        scheduleWallpaperRecovery(label, 6500);
        finish({ ok: false, pending: true, error, ...wallpaperLastAttachDiagnostic });
      });
    };
    tryAttach();
  });
  return wallpaperAttachPromise;
}

function positionWallpaperWindow() {
  if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;
  const bounds = screen.getPrimaryDisplay().bounds;
  const current = wallpaperWindow.getBounds();
  if (current.x !== bounds.x || current.y !== bounds.y || current.width !== bounds.width || current.height !== bounds.height) {
    wallpaperWindow.setBounds(bounds, false);
  }
}

function sendWallpaperState(payload = wallpaperState) {
  if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;
  wallpaperWindow.webContents.send('mineradio-wallpaper-state', payload);
}

function mergeWallpaperState(payload = {}) {
  const next = { ...wallpaperState, ...payload };
  if (payload && payload.colors) next.colors = { ...(wallpaperState.colors || {}), ...payload.colors };
  if (payload && payload.motion) next.motion = { ...(wallpaperState.motion || {}), ...payload.motion };
  if (payload && payload.visual) next.visual = { ...(wallpaperState.visual || {}), ...payload.visual };
  if (payload && payload.lyrics) next.lyrics = { ...(wallpaperState.lyrics || {}), ...payload.lyrics };
  wallpaperState = next;
  return next;
}

function stampWallpaperState(payload = {}) {
  const incoming = Number(payload && (payload.seq != null ? payload.seq : payload.sequence));
  const validIncoming = Number.isSafeInteger(incoming) && incoming >= 0 ? incoming : 0;
  // The App renderer's local counter restarts after a reload, while the
  // dedicated wallpaper renderer can stay alive. Keep the sequence monotonic
  // in the main process so a surviving surface never rejects the new session's
  // frames as stale for several minutes.
  wallpaperSequence = Math.max(wallpaperSequence + 1, validIncoming);
  return { ...(payload || {}), seq: wallpaperSequence };
}

function serializeWallpaperEngineBridgePayload(payload) {
  try {
    const serialized = JSON.stringify(payload && typeof payload === 'object' ? payload : {});
    return serialized == null ? '{}' : serialized;
  } catch (e) {
    console.warn('Wallpaper Engine bridge could not serialize state:', e.message);
    return '{}';
  }
}

function writeWallpaperEngineBridgeJson(res, statusCode, payload) {
  const body = serializeWallpaperEngineBridgePayload(payload);
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Cache-Control, Content-Type, Last-Event-ID',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function writeWallpaperEngineBridgeEvent(res, payload) {
  if (!res || res.destroyed || res.writableEnded) return false;
  try {
    return res.write(`data: ${serializeWallpaperEngineBridgePayload(payload)}\n\n`);
  } catch (e) {
    return false;
  }
}

function broadcastWallpaperEngineState(payload) {
  for (const client of Array.from(wallpaperEngineBridgeClients)) {
    if (!client || client.destroyed || client.writableEnded) {
      wallpaperEngineBridgeClients.delete(client);
      continue;
    }
    if (!writeWallpaperEngineBridgeEvent(client, payload)) {
      // A false return can also mean ordinary backpressure, so keep the client
      // unless Node has actually closed the response.
      if (client.destroyed || client.writableEnded) wallpaperEngineBridgeClients.delete(client);
    }
  }
}

function handleWallpaperEngineBridgeRequest(req, res) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Cache-Control, Content-Type, Last-Event-ID',
      'Access-Control-Max-Age': '86400',
      'Cache-Control': 'no-store',
    });
    res.end();
    return;
  }
  if (method !== 'GET') {
    writeWallpaperEngineBridgeJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  let pathname = '/';
  try {
    pathname = new URL(req.url || '/', `http://${WALLPAPER_ENGINE_BRIDGE_HOST}:${WALLPAPER_ENGINE_BRIDGE_PORT}`).pathname;
  } catch (e) {}

  if (pathname === '/health') {
    writeWallpaperEngineBridgeJson(res, 200, {
      ok: true,
      app: APP_NAME,
      mode: WALLPAPER_ENGINE_BRIDGE_MODE,
      enabled: wallpaperState.enabled === true,
      seq: Number(wallpaperState.seq) || 0,
      clients: wallpaperEngineBridgeClients.size,
    });
    return;
  }
  if (pathname === '/state') {
    writeWallpaperEngineBridgeJson(res, 200, wallpaperState);
    return;
  }
  if (pathname === '/events') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Cache-Control, Content-Type, Last-Event-ID',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 1500\n\n');
    wallpaperEngineBridgeClients.add(res);
    writeWallpaperEngineBridgeEvent(res, wallpaperState);
    const forgetClient = () => wallpaperEngineBridgeClients.delete(res);
    req.on('close', forgetClient);
    res.on('close', forgetClient);
    res.on('error', forgetClient);
    return;
  }
  writeWallpaperEngineBridgeJson(res, 404, { ok: false, error: 'NOT_FOUND' });
}

function startWallpaperEngineBridge() {
  if (wallpaperEngineBridgeServer && wallpaperEngineBridgeServer.listening) {
    return Promise.resolve({
      host: WALLPAPER_ENGINE_BRIDGE_HOST,
      port: WALLPAPER_ENGINE_BRIDGE_PORT,
      mode: WALLPAPER_ENGINE_BRIDGE_MODE,
    });
  }
  if (wallpaperEngineBridgeStartPromise) return wallpaperEngineBridgeStartPromise;

  const server = http.createServer(handleWallpaperEngineBridgeRequest);
  wallpaperEngineBridgeServer = server;
  wallpaperEngineBridgeStartPromise = new Promise((resolve, reject) => {
    const onStartupError = (error) => {
      if (wallpaperEngineBridgeServer === server) wallpaperEngineBridgeServer = null;
      reject(error);
    };
    server.once('error', onStartupError);
    server.listen(WALLPAPER_ENGINE_BRIDGE_PORT, WALLPAPER_ENGINE_BRIDGE_HOST, () => {
      server.removeListener('error', onStartupError);
      server.on('error', (error) => console.warn('Wallpaper Engine bridge error:', error.message));
      if (wallpaperEngineBridgeKeepAliveTimer) clearInterval(wallpaperEngineBridgeKeepAliveTimer);
      wallpaperEngineBridgeKeepAliveTimer = setInterval(() => {
        for (const client of Array.from(wallpaperEngineBridgeClients)) {
          if (!client || client.destroyed || client.writableEnded) {
            wallpaperEngineBridgeClients.delete(client);
            continue;
          }
          try { client.write(`: keepalive ${Date.now()}\n\n`); } catch (e) { wallpaperEngineBridgeClients.delete(client); }
        }
      }, 15000);
      console.info(`Wallpaper Engine bridge listening on http://${WALLPAPER_ENGINE_BRIDGE_HOST}:${WALLPAPER_ENGINE_BRIDGE_PORT}`);
      resolve({
        host: WALLPAPER_ENGINE_BRIDGE_HOST,
        port: WALLPAPER_ENGINE_BRIDGE_PORT,
        mode: WALLPAPER_ENGINE_BRIDGE_MODE,
      });
    });
  }).finally(() => {
    wallpaperEngineBridgeStartPromise = null;
  });
  return wallpaperEngineBridgeStartPromise;
}

function closeWallpaperEngineBridge() {
  if (wallpaperEngineBridgeKeepAliveTimer) clearInterval(wallpaperEngineBridgeKeepAliveTimer);
  wallpaperEngineBridgeKeepAliveTimer = null;
  for (const client of Array.from(wallpaperEngineBridgeClients)) {
    wallpaperEngineBridgeClients.delete(client);
    try { client.end(); } catch (e) {}
  }
  const server = wallpaperEngineBridgeServer;
  wallpaperEngineBridgeServer = null;
  if (server) {
    try { server.close(); } catch (e) {}
  }
}

function firstExistingFile(candidates) {
  const seen = new Set();
  for (const candidate of candidates || []) {
    if (!candidate) continue;
    const key = process.platform === 'win32' ? String(candidate).toLowerCase() : String(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (e) {}
  }
  return '';
}

function wallpaperEngineInstallRoots() {
  const roots = [];
  const addSteamRoot = (steamRoot) => {
    if (!steamRoot) return;
    roots.push(path.join(steamRoot, 'steamapps', 'common', 'wallpaper_engine'));
  };
  addSteamRoot(process.env.STEAM_PATH);
  addSteamRoot(process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Steam'));
  addSteamRoot(process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Steam'));
  addSteamRoot('C:\\Program Files (x86)\\Steam');
  addSteamRoot('C:\\Program Files\\Steam');
  addSteamRoot('C:\\Steam');
  addSteamRoot('C:\\SteamLibrary');
  addSteamRoot('D:\\SteamLibrary');
  addSteamRoot('D:\\Steam');
  addSteamRoot('E:\\SteamLibrary');
  addSteamRoot('E:\\Steam');
  return roots;
}

function locateWallpaperEngineExecutable(installRoots) {
  const roots = installRoots || wallpaperEngineInstallRoots();
  const candidates = [];
  if (process.env.MINERADIO_WALLPAPER_ENGINE_EXE) candidates.push(process.env.MINERADIO_WALLPAPER_ENGINE_EXE);
  // Prefer the standard 32-bit host: it is Wallpaper Engine's active renderer
  // on this install and its control command reuses the existing process.
  for (const executable of ['wallpaper32.exe', 'wallpaper64.exe']) {
    for (const root of roots) candidates.push(path.join(root, executable));
  }
  return firstExistingFile(candidates);
}

function locateMineradioWallpaperEngineProject(installRoots) {
  const roots = installRoots || wallpaperEngineInstallRoots();
  const candidates = [];
  if (process.env.MINERADIO_WALLPAPER_ENGINE_PROJECT) candidates.push(process.env.MINERADIO_WALLPAPER_ENGINE_PROJECT);
  for (const root of roots) {
    candidates.push(path.join(root, 'projects', 'myprojects', 'MineradioLive', 'project.json'));
    candidates.push(path.join(root, 'projects', 'myprojects', 'Mineradio Live', 'project.json'));
  }

  // Development checkout, unpacked app, and packaged-extraResources layouts.
  candidates.push(path.resolve(__dirname, '..', 'wallpaper-engine', 'MineradioLive', 'project.json'));
  candidates.push(path.resolve(__dirname, '..', '..', 'wallpaper-engine', 'MineradioLive', 'project.json'));
  candidates.push(path.resolve(__dirname, '..', '..', '..', 'wallpaper-engine', 'MineradioLive', 'project.json'));
  candidates.push(path.resolve(__dirname, '..', 'wallpaper-engine', 'project.json'));
  candidates.push(path.resolve(__dirname, '..', '..', '..', 'wallpaper-engine', 'project.json'));
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'wallpaper-engine', 'MineradioLive', 'project.json'));
    candidates.push(path.join(process.resourcesPath, 'app', 'wallpaper-engine', 'MineradioLive', 'project.json'));
  }
  return firstExistingFile(candidates);
}

function applyWallpaperEngineHost() {
  if (process.platform !== 'win32') {
    return Promise.resolve({ hostApplied: false, hostError: 'WALLPAPER_ENGINE_WINDOWS_ONLY' });
  }
  if (wallpaperEngineHostLaunchPromise) return wallpaperEngineHostLaunchPromise;
  const now = Date.now();
  if (wallpaperEngineHostLastResult && now - wallpaperEngineHostLastAttemptAt < WALLPAPER_ENGINE_HOST_RETRY_MS) {
    return Promise.resolve({ ...wallpaperEngineHostLastResult, deduped: true });
  }
  wallpaperEngineHostLastAttemptAt = now;

  wallpaperEngineHostLaunchPromise = (async () => {
    const installRoots = wallpaperEngineInstallRoots();
    const executable = locateWallpaperEngineExecutable(installRoots);
    if (!executable) return { hostApplied: false, hostError: 'WALLPAPER_ENGINE_EXECUTABLE_NOT_FOUND' };
    const projectFile = locateMineradioWallpaperEngineProject(installRoots);
    if (!projectFile) return { hostApplied: false, hostError: 'MINERADIO_LIVE_PROJECT_NOT_FOUND' };

    return new Promise((resolve) => {
      let child = null;
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };
      const timeout = setTimeout(() => {
        finish({ hostApplied: false, hostError: 'WALLPAPER_ENGINE_LAUNCH_TIMEOUT' });
      }, 4000);
      try {
        child = spawn(executable, [
          '-control', 'openWallpaper',
          '-file', projectFile,
          '-monitor', '0',
        ], {
          windowsHide: true,
          detached: true,
          stdio: 'ignore',
        });
        child.once('error', (error) => {
          finish({ hostApplied: false, hostError: error.message || 'WALLPAPER_ENGINE_LAUNCH_FAILED' });
        });
        child.once('spawn', () => {
          console.info('Wallpaper Engine MineradioLive project activation requested.');
          finish({ hostApplied: true, hostError: '' });
        });
        child.unref();
      } catch (e) {
        finish({ hostApplied: false, hostError: e.message || 'WALLPAPER_ENGINE_LAUNCH_FAILED' });
      }
    });
  })().then((result) => {
    wallpaperEngineHostLastResult = result;
    return result;
  }).catch((error) => {
    const result = { hostApplied: false, hostError: error.message || 'WALLPAPER_ENGINE_LAUNCH_FAILED' };
    wallpaperEngineHostLastResult = result;
    return result;
  }).finally(() => {
    wallpaperEngineHostLaunchPromise = null;
  });
  return wallpaperEngineHostLaunchPromise;
}

function createWallpaperWindow(payload = {}) {
  mergeWallpaperState({ ...payload, enabled: true });
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    sendWallpaperState();
    if (!wallpaperWorkerWAttached || !wallpaperWindow.isVisible()) {
      attachAndShowWallpaperWindow(wallpaperWindow, sendWallpaperState, 'Wallpaper surface');
    }
    return wallpaperWindow;
  }
  clearWallpaperRecoveryTimers();
  wallpaperAttachPromise = null;
  wallpaperWorkerWAttached = false;
  wallpaperLastAttachDiagnostic = null;
  const bounds = screen.getPrimaryDisplay().bounds;
  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    title: 'Mineradio Wallpaper',
    webPreferences: {
      preload: path.join(__dirname, 'wallpaper-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      paintWhenInitiallyHidden: true,
    },
  });
  wallpaperWindow = win;
  win.setIgnoreMouseEvents(true, { forward: true });
  if (typeof win.setFocusable === 'function') win.setFocusable(false);
  win.setSkipTaskbar(true);
  win.webContents.setAudioMuted(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const activateSurface = (label) => {
    if (!wallpaperWindow || wallpaperWindow !== win || win.isDestroyed()) return;
    attachAndShowWallpaperWindow(win, () => {
      if (!wallpaperWindow || wallpaperWindow !== win || win.isDestroyed()) return;
      sendWallpaperState();
    }, label || 'Wallpaper surface');
  };
  // Some initially-hidden BrowserWindows do not emit
  // ready-to-show consistently. did-finish-load and an immediate native attach
  // are both valid fallbacks; attachAndShow deduplicates concurrent attempts.
  win.once('ready-to-show', () => activateSurface('Wallpaper ready surface'));
  win.webContents.once('did-finish-load', () => {
    if (wallpaperWindow !== win) return;
    sendWallpaperState();
    activateSurface('Wallpaper loaded surface');
  });
  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame === false || wallpaperWindow !== win) return;
    console.warn('Wallpaper renderer failed to load:', code, description, url);
    scheduleWallpaperRecovery('Wallpaper load recovery', 2500);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    if (wallpaperWindow !== win || !wallpaperState.enabled) return;
    console.warn('Wallpaper renderer exited:', details && details.reason);
    setTimeout(() => {
      if (wallpaperWindow === win && !win.isDestroyed() && wallpaperState.enabled) win.webContents.reload();
    }, 900);
  });
  win.on('closed', () => {
    if (wallpaperWindow !== win) return;
    const shouldRecover = wallpaperState.enabled === true && !!mainWindow && !mainWindow.isDestroyed();
    wallpaperWindow = null;
    wallpaperWorkerWAttached = false;
    wallpaperAttachPromise = null;
    wallpaperAttachToken += 1;
    clearWallpaperRecoveryTimers();
    if (shouldRecover) {
      setTimeout(() => {
        if (wallpaperState.enabled && (!wallpaperWindow || wallpaperWindow.isDestroyed())) createWallpaperWindow(wallpaperState);
      }, 1200);
    }
  });
  win.loadURL(overlayUrl('index.html?surface=wallpaper')).catch((e) => console.warn('Wallpaper load failed:', e.message));
  activateSurface('Wallpaper initial surface');
  return win;
}

function closeWallpaperWindow() {
  wallpaperState = { ...wallpaperState, enabled: false };
  clearWallpaperRecoveryTimers();
  const win = wallpaperWindow;
  if (win && !win.isDestroyed()) {
    sendWallpaperState();
    win.close();
  }
  wallpaperWindow = null;
  wallpaperWorkerWAttached = false;
  wallpaperAttachPromise = null;
  wallpaperLastAttachDiagnostic = null;
  wallpaperAttachToken += 1;
}

function closeOverlayWindows() {
  closeDesktopLyricsWindow();
  closeWallpaperWindow();
}

ipcMain.handle('desktop-window-minimize', (event) => {
  getSenderWindow(event)?.minimize();
});

ipcMain.handle('desktop-window-toggle-maximize', (event) => {
  toggleFullscreen(getSenderWindow(event));
});

ipcMain.handle('desktop-window-toggle-fullscreen', (event) => {
  toggleFullscreen(getSenderWindow(event));
});

ipcMain.handle('desktop-window-exit-fullscreen-windowed', (event) => {
  exitFullscreenToWindow(getSenderWindow(event));
});

ipcMain.handle('desktop-window-get-state', (event) => {
  return getWindowState(getSenderWindow(event));
});

ipcMain.handle('desktop-window-close', (event) => {
  getSenderWindow(event)?.close();
});

ipcMain.handle('mineradio-hotkeys-configure-global', (_event, bindings) => {
  return configureMineradioGlobalHotkeys(bindings);
});

ipcMain.handle('mineradio-export-json-file', async (event, payload = {}) => {
  try {
    const owner = getSenderWindow(event);
    const defaultName = String(payload.defaultName || 'mineradio-export.json').replace(/[\\/:*?"<>|]+/g, '-');
    const result = await dialog.showSaveDialog(owner, {
      title: '导出 Mineradio 存档',
      defaultPath: defaultName.toLowerCase().endsWith('.json') ? defaultName : `${defaultName}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const text = typeof payload.text === 'string' ? payload.text : JSON.stringify(payload.data || {}, null, 2);
    fs.writeFileSync(result.filePath, text, 'utf8');
    return { ok: true, filePath: result.filePath };
  } catch (e) {
    return { ok: false, error: e.message || 'EXPORT_FAILED' };
  }
});

ipcMain.handle('mineradio-import-json-file', async (event) => {
  try {
    const owner = getSenderWindow(event);
    const result = await dialog.showOpenDialog(owner, {
      title: '导入 Mineradio 存档',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true };
    const filePath = result.filePaths[0];
    const text = fs.readFileSync(filePath, 'utf8');
    return { ok: true, filePath, text };
  } catch (e) {
    return { ok: false, error: e.message || 'IMPORT_FAILED' };
  }
});

ipcMain.handle('netease-music-open-login', async (event) => {
  return openNeteaseMusicLoginWindow(getSenderWindow(event));
});

ipcMain.handle('netease-music-clear-login', async () => {
  return clearNeteaseMusicLoginSession();
});

ipcMain.handle('qq-music-open-login', async (event) => {
  return openQQMusicLoginWindow(getSenderWindow(event));
});

ipcMain.handle('qq-music-clear-login', async () => {
  return clearQQMusicLoginSession();
});

ipcMain.handle('mineradio-open-update-installer', async (_event, filePath) => {
  try {
    const target = path.resolve(String(filePath || ''));
    const updateDir = path.resolve(getUpdateDownloadDir());
    if (!target || !target.startsWith(updateDir + path.sep)) {
      return { ok: false, error: 'INVALID_UPDATE_PATH' };
    }
    if (!fs.existsSync(target)) return { ok: false, error: 'UPDATE_FILE_MISSING' };
    const error = await shell.openPath(target);
    return error ? { ok: false, error } : { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'OPEN_UPDATE_FAILED' };
  }
});

ipcMain.handle('mineradio-restart-app', async () => {
  try {
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'RESTART_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-set-enabled', async (_event, enabled, payload) => {
  try {
    if (enabled) {
      createDesktopLyricsWindow(payload || {});
      broadcastDesktopLyricsEnabledState(true);
    } else {
      closeDesktopLyricsWindow();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-update', async (_event, payload) => {
  try {
    const nextState = { ...desktopLyricsState, ...(payload || {}) };
    if (nextState.enabled) {
      createDesktopLyricsWindow(payload || {});
    } else if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
      desktopLyricsState = nextState;
      sendDesktopLyricsState();
    } else {
      desktopLyricsState = nextState;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_UPDATE_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-set-dragging', async () => {
  return { ok: true };
});

ipcMain.handle('mineradio-desktop-lyrics-set-pointer-capture', async (_event, active) => {
  try {
    desktopLyricsPointerCapture = !!active;
    applyDesktopLyricsMouseBehavior();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_POINTER_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-set-hot-bounds', async (_event, bounds) => {
  try {
    const left = clampNumber(bounds && bounds.left, -2000, 4000, 0);
    const top = clampNumber(bounds && bounds.top, -2000, 4000, 0);
    const right = clampNumber(bounds && bounds.right, left + 1, 6000, left + 1);
    const bottom = clampNumber(bounds && bounds.bottom, top + 1, 6000, top + 1);
    desktopLyricsHotBounds = { left, top, right, bottom };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_HOT_BOUNDS_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-set-lock-state', async (_event, locked) => {
  try {
    desktopLyricsState = { ...desktopLyricsState, clickThrough: !!locked };
    if (desktopLyricsState.clickThrough !== false) desktopLyricsPointerCapture = false;
    applyDesktopLyricsMouseBehavior();
    broadcastDesktopLyricsLockState();
    return { ok: true, locked: desktopLyricsState.clickThrough !== false };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_LOCK_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-move-by', async (_event, dx, dy) => {
  try {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return { ok: false, error: 'NO_DESKTOP_LYRICS_WINDOW' };
    if (desktopLyricsState.clickThrough !== false) return { ok: false, error: 'DESKTOP_LYRICS_LOCKED' };
    const bounds = desktopLyricsWindow.getBounds();
    const next = {
      ...bounds,
      x: Math.round(bounds.x + clampNumber(dx, -160, 160, 0)),
      y: Math.round(bounds.y + clampNumber(dy, -160, 160, 0)),
    };
    desktopLyricsWindow.setBounds(next, false);
    desktopLyricsUserBounds = desktopLyricsWindow.getBounds();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_MOVE_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-set-enabled', async (event, enabled, payload) => {
  try {
    if (!mainWindow || mainWindow.isDestroyed() || getSenderWindow(event) !== mainWindow) {
      return { ok: false, error: 'UNAUTHORIZED_WALLPAPER_SENDER' };
    }
    mergeWallpaperState(stampWallpaperState({ ...(payload || {}), enabled: !!enabled }));
    if (enabled) {
      const bridge = await startWallpaperEngineBridge();
      // This command also starts Wallpaper Engine when its Steam autostart is
      // disabled, then asks it to apply our local web-wallpaper project.
      const host = await applyWallpaperEngineHost();
      broadcastWallpaperEngineState(wallpaperState);
      return {
        ok: true,
        pending: false,
        enabled: true,
        // Wallpaper Engine owns the desktop surface. "attached" is reserved for
        // the retired native WorkerW BrowserWindow path and must stay false.
        attached: false,
        mode: WALLPAPER_ENGINE_BRIDGE_MODE,
        host: bridge.host,
        port: bridge.port,
        hostApplied: host.hostApplied === true,
        hostError: host.hostError || '',
        error: '',
      };
    }
    closeWallpaperWindow();
    broadcastWallpaperEngineState(wallpaperState);
    return { ok: true, enabled: false, attached: false, mode: WALLPAPER_ENGINE_BRIDGE_MODE };
  } catch (e) {
    return { ok: false, error: e.message || 'WALLPAPER_FAILED' };
  }
});

ipcMain.on('mineradio-wallpaper-state-push', (event, payload) => {
  if (!mainWindow || mainWindow.isDestroyed() || getSenderWindow(event) !== mainWindow) return;
  const raw = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const next = stampWallpaperState(raw);
  mergeWallpaperState(next);
  // Forward the incremental 30 Hz frame as-is. wallpaperState remains the
  // complete cached snapshot used for a newly loaded/recovered surface. Sending
  // that cache here would clone the full lyric list, beat map and background on
  // every frame and can stall both Electron renderers.
  sendWallpaperState(next);
  broadcastWallpaperEngineState(next);
});

ipcMain.handle('mineradio-wallpaper-ready', (event) => {
  if (!wallpaperWindow || wallpaperWindow.isDestroyed() || getSenderWindow(event) !== wallpaperWindow) {
    return { ok: false, error: 'UNAUTHORIZED_WALLPAPER_SENDER' };
  }
  sendWallpaperState();
  return {
    ok: true,
    attached: !!wallpaperWorkerWAttached,
    mode: wallpaperLastAttachDiagnostic && wallpaperLastAttachDiagnostic.mode || '',
  };
});

async function createWindow() {
  htmlFullscreenActive = false;
  windowFullscreenActive = false;
  const port = await findOpenPort(3000);
  mainServerPort = port;

  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(port);
  process.env.COOKIE_FILE = path.join(app.getPath('userData'), '.cookie');
  process.env.QQ_COOKIE_FILE = path.join(app.getPath('userData'), '.qq-cookie');
  process.env.MINERADIO_UPDATE_DIR = getUpdateDownloadDir();
  try {
    const legacyQQCookie = path.join(__dirname, '..', '.qq-cookie');
    if (fs.existsSync(legacyQQCookie)) {
      if (!fs.existsSync(process.env.QQ_COOKIE_FILE)) {
        fs.copyFileSync(legacyQQCookie, process.env.QQ_COOKIE_FILE);
      }
      fs.unlinkSync(legacyQQCookie);
    }
  } catch (e) {
    console.warn('QQ cookie migration skipped:', e.message);
  }

  localServer = require(path.join(__dirname, '..', 'server.js'));
  await waitForServer(localServer);

  const initialBounds = getWindowedBounds();

  mainWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: 960,
    minHeight: 540,
    show: false,
    frame: false,
    fullscreen: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    autoHideMenuBar: true,
    title: APP_NAME,
    icon: APP_ICON_ICO,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.once('did-finish-load', () => {
    sendWindowState(mainWindow);
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'Escape' || input.code === 'Escape') && mainWindow.isFullScreen()) {
      event.preventDefault();
      exitFullscreenToWindow(mainWindow);
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    sendWindowState(mainWindow);
  });

  mainWindow.on('maximize', () => sendWindowState(mainWindow));
  mainWindow.on('unmaximize', () => sendWindowState(mainWindow));
  mainWindow.on('minimize', () => sendWindowState(mainWindow));
  mainWindow.on('restore', () => sendWindowState(mainWindow));
  mainWindow.on('show', () => sendWindowState(mainWindow));
  mainWindow.on('hide', () => sendWindowState(mainWindow));
  mainWindow.on('focus', () => sendWindowState(mainWindow));
  mainWindow.on('blur', () => sendWindowState(mainWindow));
  mainWindow.on('move', () => scheduleWindowStateSend(mainWindow));
  mainWindow.on('resize', () => scheduleWindowStateSend(mainWindow));
  mainWindow.on('closed', () => {
    if (mainWindowStateTimer) {
      clearTimeout(mainWindowStateTimer);
      mainWindowStateTimer = null;
    }
    closeOverlayWindows();
    mainWindow = null;
  });
  mainWindow.on('enter-full-screen', () => {
    windowFullscreenActive = true;
    sendWindowState(mainWindow);
  });
  mainWindow.on('leave-full-screen', () => {
    windowFullscreenActive = false;
    setTimeout(() => applyWindowedBounds(mainWindow), 50);
  });
  mainWindow.on('enter-html-full-screen', () => {
    htmlFullscreenActive = true;
    sendWindowState(mainWindow);
  });
  mainWindow.on('leave-html-full-screen', () => {
    htmlFullscreenActive = false;
    setTimeout(() => applyWindowedBounds(mainWindow), 50);
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!focusMainWindow()) {
      app.whenReady().then(() => createWindow()).catch((e) => console.error('Second instance window restore failed:', e));
    }
  });

  app.whenReady().then(async () => {
    // Wallpaper Engine can start before Mineradio. Keep the loopback endpoint
    // available for it from the beginning, even while wallpaper mode is off.
    await startWallpaperEngineBridge().catch((e) => {
      console.warn('Wallpaper Engine bridge startup failed:', e.message);
    });
    screen.on('display-metrics-changed', () => {
      positionDesktopLyricsWindow();
      if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
        attachAndShowWallpaperWindow(wallpaperWindow, sendWallpaperState, 'Wallpaper display refresh', { force: true });
      }
      scheduleWindowStateSend(mainWindow);
    });
    screen.on('display-added', () => {
      if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
        attachAndShowWallpaperWindow(wallpaperWindow, sendWallpaperState, 'Wallpaper display added', { force: true });
      }
      scheduleWindowStateSend(mainWindow);
    });
    screen.on('display-removed', () => {
      if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
        attachAndShowWallpaperWindow(wallpaperWindow, sendWallpaperState, 'Wallpaper display removed', { force: true });
      }
      scheduleWindowStateSend(mainWindow);
    });
    await createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else focusMainWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    unregisterMineradioGlobalHotkeys();
    closeOverlayWindows();
    closeWallpaperEngineBridge();
    if (localServer && localServer.close) localServer.close();
  });
}

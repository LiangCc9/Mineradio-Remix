const { contextBridge, ipcRenderer } = require('electron');

function bind(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload || {});
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('wallpaperSurface', {
  onWallpaperState: (callback) => bind('mineradio-wallpaper-state', callback),
  ready: () => ipcRenderer.invoke('mineradio-wallpaper-ready'),
});

// Compatibility alias for the lightweight wallpaper renderer. The dedicated
// surface remains state-only and cannot control playback or window placement.
contextBridge.exposeInMainWorld('desktopOverlay', {
  onWallpaperState: (callback) => bind('mineradio-wallpaper-state', callback),
  ready: () => ipcRenderer.invoke('mineradio-wallpaper-ready'),
});

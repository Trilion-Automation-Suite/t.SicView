/**
 * Preload script for the t.SicView Electron app.
 *
 * Runs in the renderer process before any web page scripts.
 * Exposes a minimal API to the renderer via contextBridge.
 */

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('gomsicElectron', {
  isElectron: true,
  platform: process.platform,
});

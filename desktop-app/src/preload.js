/* Runs before the website's own scripts in every RankerNode window (sandboxed). */
'use strict';
const { contextBridge, webFrame } = require('electron');

/* Voice typing needs Google's speech service, which only the Chrome
   browser has. Hide it so the AI Doubt Solver doesn't show a mic
   button that can never work (typing, paste, photos and files do). */
function hideVoice() {
  try { delete window.SpeechRecognition; } catch (e) {}
  try { delete window.webkitSpeechRecognition; } catch (e) {}
}
try {
  if (typeof contextBridge.executeInMainWorld === 'function') contextBridge.executeInMainWorld({ func: hideVoice });
  else webFrame.executeJavaScript('(' + hideVoice.toString() + ')()');
} catch (_) {
  try { webFrame.executeJavaScript('(' + hideVoice.toString() + ')()'); } catch (__) {}
}

/* Lets the website know it runs inside the desktop app. */
try {
  contextBridge.exposeInMainWorld('RankerNodeDesktop', Object.freeze({
    platform: process.platform,
    isDesktopApp: true
  }));
} catch (_) {}

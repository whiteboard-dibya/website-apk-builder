const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const buildEngine = require('./builder/engine');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    frame: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
  
  // Auto-detect SDK
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '';
  const javaHome = process.env.JAVA_HOME || '';
  mainWindow.webContents.send('env-status', { androidHome: !!androidHome, javaHome: !!javaHome, androidHome, javaHome });
}

app.whenReady().then(createWindow);

// IPC Handlers
ipcMain.handle('start-build', async (_, config) => {
  try {
    const buildId = uuidv4();
    const outputDir = path.join(__dirname, 'output');
    fs.ensureDirSync(outputDir);

    // Stream progress to renderer
    const onProgress = (stage, pct, log) => {
      mainWindow.webContents.send('build-progress', { stage, pct, log, id: buildId });
    };

    const apkPath = await buildEngine.generate(config, outputDir, onProgress);
    
    return { success: true, apkPath, buildId };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-history', (_, entry) => {
  const historyFile = path.join(__dirname, 'data', 'history.json');
  fs.ensureDirSync(path.join(__dirname, 'data'));
  const data = fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : [];
  data.unshift(entry);
  if (data.length > 20) data.pop();
  fs.writeJsonSync(historyFile, data, { spaces: 2 });
  return true;
});

ipcMain.handle('get-history', () => {
  const historyFile = path.join(__dirname, 'data', 'history.json');
  return fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : [];
});

ipcMain.handle('open-output-folder', () => {
  shell.openPath(path.join(__dirname, 'output'));
});

ipcMain.handle('reveal-apk', (_, apkPath) => {
  if (fs.existsSync(apkPath)) shell.showItemInFolder(apkPath);
});

app.on('window-all-closed', () => app.quit());

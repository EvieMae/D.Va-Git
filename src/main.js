const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const core = require('./main/core');
const { S } = core;

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'icon-dva.ico');
  const iconPng = path.join(__dirname, '..', 'icon-dva.png');
  const iconToUse = fs.existsSync(iconPath) ? iconPath : (fs.existsSync(iconPng) ? iconPng : undefined);

  const saved = core.loadWindowState();
  const opts = {
    width: saved?.width || 1500,
    height: saved?.height || 950,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#1a1224',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: iconToUse,
  };
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    opts.x = saved.x; opts.y = saved.y;
  }
  S.mainWindow = new BrowserWindow(opts);
  if (saved?.maximized) S.mainWindow.maximize();

  S.mainWindow.loadFile(path.join(__dirname, 'index.html'));
  Menu.setApplicationMenu(null);

  if (iconToUse && app.setAppUserModelId) app.setAppUserModelId('com.dvagit');

  const persist = () => core.saveWindowState();
  S.mainWindow.on('resize', persist);
  S.mainWindow.on('move', persist);
  S.mainWindow.on('close', persist);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

require('./main/git-ops')(core);            // window, repo open/init/clone, core git ops
require('./main/repo-io')(core);            // remotes, file io, stash, log, tree, settings, session
require('./main/history-people')(core);     // commit ops, tags, push, compare, history, blame, tools, people
require('./main/integrations-build')(core); // integrations, discord, repo-state, submodules, gpg, build, rebase
require('./main/repostats')(core);          // repo stats panel (object count, contributors, files)

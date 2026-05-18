const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // window
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),

  // repo
  pickFolder: () => ipcRenderer.invoke('repo:pickFolder'),
  pickCloneDir: () => ipcRenderer.invoke('repo:pickCloneDir'),
  openRepo: (p) => ipcRenderer.invoke('repo:open', p),
  initRepo: (p) => ipcRenderer.invoke('repo:init', p),
  cloneRepo: (args) => ipcRenderer.invoke('repo:clone', args),
  recentRepos: () => ipcRenderer.invoke('repo:recent'),
  currentRepo: () => ipcRenderer.invoke('repo:current'),

  // git
  status: () => ipcRenderer.invoke('git:status'),
  log: (opts) => ipcRenderer.invoke('git:log', opts),
  branches: () => ipcRenderer.invoke('git:branches'),
  remotes: () => ipcRenderer.invoke('git:remotes'),
  tags: () => ipcRenderer.invoke('git:tags'),
  stashList: () => ipcRenderer.invoke('git:stashList'),
  diff: (args) => ipcRenderer.invoke('git:diff', args),
  diffCommit: (hash) => ipcRenderer.invoke('git:diffCommit', hash),
  commitFiles: (hash) => ipcRenderer.invoke('git:commitFiles', hash),
  fileDiffAtCommit: (args) => ipcRenderer.invoke('git:fileDiffAtCommit', args),
  stage: (files) => ipcRenderer.invoke('git:stage', files),
  unstage: (files) => ipcRenderer.invoke('git:unstage', files),
  commit: (args) => ipcRenderer.invoke('git:commit', args),
  push: (args) => ipcRenderer.invoke('git:push', args),
  pull: (args) => ipcRenderer.invoke('git:pull', args),
  fetch: (args) => ipcRenderer.invoke('git:fetch', args),
  checkout: (ref) => ipcRenderer.invoke('git:checkout', ref),
  createBranch: (name) => ipcRenderer.invoke('git:createBranch', name),
  deleteBranch: (args) => ipcRenderer.invoke('git:deleteBranch', args),
  renameBranch: (args) => ipcRenderer.invoke('git:renameBranch', args),
  deleteRemoteBranch: (args) => ipcRenderer.invoke('git:deleteRemoteBranch', args),
  merge: (ref) => ipcRenderer.invoke('git:merge', ref),
  mergeOpts: (args) => ipcRenderer.invoke('git:merge', args),
  rebase: (onto) => ipcRenderer.invoke('git:rebase', onto),
  stash: (msg) => ipcRenderer.invoke('git:stash', msg),
  stashPop: () => ipcRenderer.invoke('git:stashPop'),
  stashApply: (i) => ipcRenderer.invoke('git:stashApply', i),
  stashDrop: (i) => ipcRenderer.invoke('git:stashDrop', i),
  discardFile: (f) => ipcRenderer.invoke('git:discardFile', f),
  userConfig: () => ipcRenderer.invoke('git:userConfig'),
  setUserConfig: (args) => ipcRenderer.invoke('git:setUserConfig', args),

  // remotes
  remoteAdd: (args) => ipcRenderer.invoke('git:remoteAdd', args),
  remoteRemove: (name) => ipcRenderer.invoke('git:remoteRemove', name),
  remoteRename: (args) => ipcRenderer.invoke('git:remoteRename', args),
  remoteSetUrl: (args) => ipcRenderer.invoke('git:remoteSetUrl', args),

  // file editor
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  readBinary: (p) => ipcRenderer.invoke('file:readBinary', p),
  writeFile: (args) => ipcRenderer.invoke('file:write', args),
  repoTree: (opts) => ipcRenderer.invoke('repo:tree', opts),

  // LFS
  lfsFiles: () => ipcRenderer.invoke('git:lfsFiles'),

  // stash variants
  stashStaged: (msg) => ipcRenderer.invoke('git:stashStaged', msg),

  // log filtering
  logBranch: (args) => ipcRenderer.invoke('git:logBranch', args),

  // settings
  settingsRead: () => ipcRenderer.invoke('settings:read'),
  settingsWrite: (data) => ipcRenderer.invoke('settings:write', data),

  // session (open repo tabs)
  sessionRead: () => ipcRenderer.invoke('session:read'),
  sessionWrite: (data) => ipcRenderer.invoke('session:write', data),

  // commit ops
  cherryPick: (hash) => ipcRenderer.invoke('git:cherryPick', hash),
  revertCommit: (args) => ipcRenderer.invoke('git:revert', args),
  resetTo: (args) => ipcRenderer.invoke('git:reset', args),
  reword: (args) => ipcRenderer.invoke('git:reword', args),
  rewordCommit: (args) => ipcRenderer.invoke('git:rewordCommit', args),
  branchFromCommit: (args) => ipcRenderer.invoke('git:branchFromCommit', args),
  restoreFromCommit: (args) => ipcRenderer.invoke('git:restoreFromCommit', args),

  // tags
  tagCreate: (args) => ipcRenderer.invoke('git:tagCreate', args),
  tagDelete: (name) => ipcRenderer.invoke('git:tagDelete', name),
  tagPush: (args) => ipcRenderer.invoke('git:tagPush', args),

  // push with options
  pushOpts: (args) => ipcRenderer.invoke('git:pushOpts', args),

  // compare any two refs
  diffRefs: (args) => ipcRenderer.invoke('git:diffRefs', args),

  // file history / blame / reflog
  logFile: (args) => ipcRenderer.invoke('git:logFile', args),
  blame: (args) => ipcRenderer.invoke('git:blame', args),
  reflog: (args) => ipcRenderer.invoke('git:reflog', args),

  // shell / external
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  showInFolder: (p) => ipcRenderer.invoke('shell:showInFolder', p),
  openTerminal: (p) => ipcRenderer.invoke('shell:openTerminal', p),
  openInVSCode: (p) => ipcRenderer.invoke('shell:openInVSCode', p),

  // in-app console
  consoleExec: (args) => ipcRenderer.invoke('console:exec', args),
  consoleHistoryRead: () => ipcRenderer.invoke('console:historyRead'),
  consoleHistoryWrite: (list) => ipcRenderer.invoke('console:historyWrite', list),
  consoleOutputRead: () => ipcRenderer.invoke('console:outputRead'),
  consoleOutputWrite: (lines) => ipcRenderer.invoke('console:outputWrite', lines),

  // clipboard
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),

  // notification
  notify: (args) => ipcRenderer.invoke('notify', args),

  // status
  upstreamCounts: () => ipcRenderer.invoke('git:upstreamCounts'),
  branchTracking: () => ipcRenderer.invoke('git:branchTracking'),

  // op-in-progress state + abort/continue
  opState: () => ipcRenderer.invoke('git:opState'),
  mergeAbort: () => ipcRenderer.invoke('git:mergeAbort'),
  mergeContinue: () => ipcRenderer.invoke('git:mergeContinue'),
  rebaseAbort: () => ipcRenderer.invoke('git:rebaseAbort'),
  rebaseContinue: () => ipcRenderer.invoke('git:rebaseContinue'),
  cherryPickAbort: () => ipcRenderer.invoke('git:cherryPickAbort'),
  cherryPickContinue: () => ipcRenderer.invoke('git:cherryPickContinue'),

  // file-at-commit (text + binary for image diff)
  treeAt: (args) => ipcRenderer.invoke('git:treeAt', args),
  showText: (args) => ipcRenderer.invoke('git:showText', args),
  showBinary: (args) => ipcRenderer.invoke('git:showBinary', args),

  // hunk staging
  applyCached: (args) => ipcRenderer.invoke('git:applyCached', args),
  diffOpts: (args) => ipcRenderer.invoke('git:diffOpts', args),

  // submodules
  submodules: () => ipcRenderer.invoke('git:submodules'),
  submoduleUpdate: (args) => ipcRenderer.invoke('git:submoduleUpdate', args),

  // worktrees
  worktrees: () => ipcRenderer.invoke('git:worktrees'),
  worktreeAdd: (args) => ipcRenderer.invoke('git:worktreeAdd', args),
  worktreeRemove: (p) => ipcRenderer.invoke('git:worktreeRemove', p),

  // signing
  signingInfo: () => ipcRenderer.invoke('git:signingInfo'),
  setSigning: (args) => ipcRenderer.invoke('git:setSigning', args),

  // interactive rebase
  rebaseInteractive: (args) => ipcRenderer.invoke('git:rebaseInteractive', args),

  // people (custom avatars + Discord)
  peopleRead: () => ipcRenderer.invoke('people:read'),
  peopleWrite: (data) => ipcRenderer.invoke('people:write', data),
  discordFetchUser: (args) => ipcRenderer.invoke('discord:fetchUser', args),

  // integrations (GitHub / GitLab / GitLab self / Bitbucket)
  integrationsRead: () => ipcRenderer.invoke('integrations:read'),
  integrationsWrite: (data) => ipcRenderer.invoke('integrations:write', data),
  githubDeviceStart: () => ipcRenderer.invoke('github:deviceStart'),
  githubDevicePoll: (args) => ipcRenderer.invoke('github:devicePoll', args),
  githubListRepos: () => ipcRenderer.invoke('github:listRepos'),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),
  readAbsBinary: (abs) => ipcRenderer.invoke('file:readAbsBinary', abs),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // build / install
  buildReadState: () => ipcRenderer.invoke('build:readState'),
  buildWriteState: (data) => ipcRenderer.invoke('build:writeState', data),
  buildRun: () => ipcRenderer.invoke('build:run'),
  buildRunInstaller: (p) => ipcRenderer.invoke('build:runInstaller', p),
  buildPickInstallPath: () => ipcRenderer.invoke('build:pickInstallPath'),
  onBuildLog: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('build:log', handler);
    return () => ipcRenderer.removeListener('build:log', handler);
  },
});

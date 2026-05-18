; Force the default install directory to C:\Program Files (x86)\DvaGit
; ($PROGRAMFILES32 = "C:\Program Files (x86)" on 64-bit Windows).
; electron-builder reads $INSTDIR from the InstallLocation registry value
; written here, so this sets the path the installer pre-fills.
!macro preInit
  SetRegView 64
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES32\DvaGit"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES32\DvaGit"
  SetRegView 32
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES32\DvaGit"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES32\DvaGit"
!macroend

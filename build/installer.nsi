; Per-user Windows installer. Buildable on Linux without executing Windows code.
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "${PROJECT_DIR}/build/generated/installer-files.nsh"

Name "${PRODUCT_NAME}"
InstallDir "$LOCALAPPDATA\Programs\Mlynek POS"
InstallDirRegKey HKCU "Software\Mlynek POS" "InstallDir"
RequestExecutionLevel user
ShowInstDetails show
ShowUninstDetails show

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${PRODUCT_FILENAME}.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Uruchom Młynek POS"
!define MUI_FINISHPAGE_TEXT "Program został zainstalowany. Dane kawiarni są przechowywane oddzielnie w profilu użytkownika."

!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE ValidateInstallDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "Polish"

Function .onInit
  SetShellVarContext current
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Ta wersja wymaga 64-bitowego systemu Windows 10 lub 11."
    Abort
  ${EndIf}
FunctionEnd

; Never install over an unrelated, nonempty folder chosen by the user.
Function ValidateInstallDirectory
  IfFileExists "$INSTDIR\.mlynek-pos-install" valid_directory
  FindFirst $0 $1 "$INSTDIR\*"
  IfErrors valid_directory
  check_entry:
    StrCmp $1 "" empty_directory
    StrCmp $1 "." next_entry
    StrCmp $1 ".." next_entry
    FindClose $0
    MessageBox MB_ICONEXCLAMATION "Wybierz pusty folder lub folder istniejącej instalacji Młynek POS."
    Abort
  next_entry:
    FindNext $0 $1
    Goto check_entry
  empty_directory:
    FindClose $0
  valid_directory:
FunctionEnd

Section "Młynek POS"
  Call ValidateInstallDirectory
  SetOutPath "$INSTDIR"
  ClearErrors
  File /r "${MLYNEK_APP_DIR}/*"
  IfErrors 0 copied
    MessageBox MB_ICONSTOP "Nie udało się skopiować plików. Zamknij działający POS i uruchom instalator ponownie."
    Abort
  copied:
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  FileOpen $0 "$INSTDIR\.mlynek-pos-install" w
  FileWrite $0 "pl.mlynek.pos"
  FileClose $0
  CreateShortCut "$DESKTOP\Młynek POS.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe"
  CreateShortCut "$SMPROGRAMS\Młynek POS.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe"
  WriteRegStr HKCU "Software\Mlynek POS" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\pl.mlynek.pos" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\pl.mlynek.pos" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\pl.mlynek.pos" "Publisher" "Młynek POS"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\pl.mlynek.pos" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\pl.mlynek.pos" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\pl.mlynek.pos" "DisplayIcon" "$INSTDIR\${PRODUCT_FILENAME}.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\pl.mlynek.pos" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\pl.mlynek.pos" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\pl.mlynek.pos" "NoRepair" 1
SectionEnd

Function un.onInit
  SetShellVarContext current
  IfFileExists "$INSTDIR\.mlynek-pos-install" known_install
    MessageBox MB_ICONSTOP "Nie znaleziono oznaczenia instalacji. Odinstalowanie zostało przerwane."
    Abort
  known_install:
FunctionEnd

Section "Uninstall"
  ; The generated list uses exact filenames. Extra user files are retained.
  !insertmacro MlynekRemoveInstalledFiles
  Delete "$DESKTOP\Młynek POS.lnk"
  Delete "$SMPROGRAMS\Młynek POS.lnk"
  Delete "$INSTDIR\.mlynek-pos-install"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\pl.mlynek.pos"
  DeleteRegKey HKCU "Software\Mlynek POS"
  ; The user profile, sales database and backups are intentionally retained.
SectionEnd

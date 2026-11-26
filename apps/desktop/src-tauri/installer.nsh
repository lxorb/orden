!define ORDEN_NAME "Orden"
!define ORDEN_OLD_BINARY "nib.exe"
!define ORDEN_UNINSTKEYS "Software\Microsoft\Windows\CurrentVersion\Uninstall"
!define ORDEN_HOOKS "${__FILEDIR__}"

Var OrdenOldDir
Var OrdenOldAsked

!define MUI_CUSTOMFUNCTION_GUIINIT OrdenFindOldInstall

Function OrdenFindOldInstall
  StrCmp $OrdenOldAsked "1" orden_find_done
  StrCpy $OrdenOldAsked "1"

  Push $R9
  ReadRegStr $OrdenOldDir SHCTX "${ORDEN_UNINSTKEYS}\${ORDEN_NAME}" "InstallLocation"
  StrCpy $R9 $OrdenOldDir 1
  StrCmp $R9 '"' 0 orden_find_unquoted
    StrCpy $OrdenOldDir $OrdenOldDir "" 1
    StrCpy $OrdenOldDir $OrdenOldDir -1
  orden_find_unquoted:
  StrCmp $OrdenOldDir "" orden_find_none
  IfFileExists "$OrdenOldDir\uninstall.exe" orden_find_none
    StrCpy $OrdenOldDir ""
  orden_find_none:
  Pop $R9
  StrCmp $OrdenOldDir "" orden_find_done
  StrCmp $INSTDIR "$LOCALAPPDATA\${ORDEN_NAME}" 0 orden_find_done
  StrCpy $INSTDIR $OrdenOldDir
  orden_find_done:
FunctionEnd

!macro ORDEN_CLOSE_RUNNING
  InitPluginsDir
  File "/oname=$PLUGINSDIR\orden-close.ps1" "${ORDEN_HOOKS}\installer-close.ps1"
  StrCpy $R8 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  IfFileExists $R8 +2
    StrCpy $R8 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  StrCpy $R8 '"$R8" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\orden-close.ps1" -Dirs "$INSTDIR|$OrdenOldDir"'
  nsExec::ExecToStack $R8
  Pop $R6
  Pop $R5
  StrCmp $R6 "10" 0 orden_close_done
  IfSilent orden_close_now
  StrCmp $PassiveMode "1" orden_close_now
  MessageBox MB_OKCANCEL|MB_ICONINFORMATION "${PRODUCTNAME} is open. Click OK to close it and continue." IDOK orden_close_now
  Abort "${PRODUCTNAME} is still open. Close it and run Setup again."
  orden_close_now:
    DetailPrint "Closing ${PRODUCTNAME}"
    nsExec::ExecToStack "$R8 -Close"
    Pop $R6
    Pop $R5
    StrCmp $R6 "11" 0 orden_close_done
    DetailPrint "Still running: $R5"
    IfSilent orden_close_failed
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${PRODUCTNAME} could not be closed. Still running:$\n$\n$R5$\nClose these, then click Retry." IDRETRY orden_close_now
  orden_close_failed:
    Abort "${PRODUCTNAME} could not be closed: $R5"
  orden_close_done:
!macroend

!macro ORDEN_RETARGET_SHORTCUT LNK ID
  IfFileExists "${LNK}" 0 orden_retarget_${ID}_done
  !insertmacro IsShortcutTarget "${LNK}" "$INSTDIR\${ORDEN_OLD_BINARY}"
  Pop $0
  StrCmp $0 1 orden_retarget_${ID}_moved
  StrCmp $OrdenOldDir "" orden_retarget_${ID}_done
  StrCmp $OrdenOldDir $INSTDIR orden_retarget_${ID}_done
  !insertmacro IsShortcutTarget "${LNK}" "$OrdenOldDir\${ORDEN_OLD_BINARY}"
  Pop $0
  StrCmp $0 1 orden_retarget_${ID}_moved
  !insertmacro IsShortcutTarget "${LNK}" "$OrdenOldDir\${MAINBINARYNAME}.exe"
  Pop $0
  StrCmp $0 1 0 orden_retarget_${ID}_done
  orden_retarget_${ID}_moved:
    Delete "${LNK}"
    CreateShortcut "${LNK}" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "${LNK}"
  orden_retarget_${ID}_done:
!macroend

!macro ORDEN_CLAIM_SHORTCUT LNK ID
  IfFileExists "${LNK}" 0 orden_claim_${ID}_done
  !insertmacro IsShortcutTarget "${LNK}" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  StrCmp $0 1 0 orden_claim_${ID}_done
    !insertmacro SetLnkAppUserModelId "${LNK}"
  orden_claim_${ID}_done:
!macroend

!define ORDEN_PINNED "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"

!macro ORDEN_RETARGET_SHORTCUTS
  !insertmacro ORDEN_RETARGET_SHORTCUT "$SMPROGRAMS\${PRODUCTNAME}.lnk" start
  !insertmacro ORDEN_RETARGET_SHORTCUT "$DESKTOP\${PRODUCTNAME}.lnk" desktop
  !insertmacro ORDEN_CLAIM_SHORTCUT "$SMPROGRAMS\${PRODUCTNAME}.lnk" start
  !insertmacro ORDEN_CLAIM_SHORTCUT "$DESKTOP\${PRODUCTNAME}.lnk" desktop
  FindFirst $R4 $R5 "${ORDEN_PINNED}\*.lnk"
  orden_pins_next:
    StrCmp $R5 "" orden_pins_done
    !insertmacro ORDEN_RETARGET_SHORTCUT "${ORDEN_PINNED}\$R5" pinned
    FindNext $R4 $R5
    Goto orden_pins_next
  orden_pins_done:
  FindClose $R4
  ClearErrors
!macroend

!macro ORDEN_FORGET_STALE_SHORTCUT LNK ID
  IfFileExists "${LNK}" 0 orden_stale_${ID}_done
  !insertmacro IsShortcutTarget "${LNK}" "$INSTDIR\${ORDEN_OLD_BINARY}"
  Pop $0
  StrCmp $0 1 0 orden_stale_${ID}_done
    Delete "${LNK}"
  orden_stale_${ID}_done:
!macroend

!macro NSIS_HOOK_PREINSTALL
  StrCmp $OrdenOldAsked "1" orden_pre_asked
    StrCpy $R9 $INSTDIR
    Call OrdenFindOldInstall
    StrCmp $INSTDIR $R9 orden_pre_asked
      SetOutPath $INSTDIR
      RMDir $R9
  orden_pre_asked:

  !insertmacro ORDEN_CLOSE_RUNNING

  StrCmp $OrdenOldDir "" orden_pre_moved
  StrCmp $OrdenOldDir $INSTDIR orden_pre_moved
    ExecWait '"$OrdenOldDir\uninstall.exe" /S /UPDATE _?=$OrdenOldDir'
    IfFileExists "$OrdenOldDir\${MAINBINARYNAME}.exe" orden_pre_stay
    IfFileExists "$OrdenOldDir\${ORDEN_OLD_BINARY}" orden_pre_stay
    Delete "$OrdenOldDir\uninstall.exe"
    RMDir "$OrdenOldDir"
    Goto orden_pre_moved
  orden_pre_stay:
    StrCpy $R9 $INSTDIR
    StrCpy $INSTDIR $OrdenOldDir
    SetOutPath $INSTDIR
    RMDir $R9
  orden_pre_moved:
  ClearErrors
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro ORDEN_CLOSE_RUNNING
!macroend

!macro ORDEN_FORGET_EXTENSION EXT
  ReadRegStr $R0 SHCTX "Software\Classes\.${EXT}" ""
  StrCmp $R0 "Markdown" 0 orden_forget_${EXT}_backup
    ReadRegStr $R1 SHCTX "Software\Classes\.${EXT}" "Markdown_backup"
    StrCmp $R1 "" orden_forget_${EXT}_unset
      WriteRegStr SHCTX "Software\Classes\.${EXT}" "" $R1
      Goto orden_forget_${EXT}_backup
    orden_forget_${EXT}_unset:
      DeleteRegValue SHCTX "Software\Classes\.${EXT}" ""
  orden_forget_${EXT}_backup:
  DeleteRegValue SHCTX "Software\Classes\.${EXT}" "Markdown_backup"
!macroend

!macro ORDEN_FORGET_FILES
  ReadRegStr $R2 SHCTX "Software\Classes\Markdown\shell\open\command" ""
  StrCmp $R2 '$INSTDIR\${MAINBINARYNAME}.exe "%1"' orden_forget_extensions
  StrCmp $R2 '$INSTDIR\${ORDEN_OLD_BINARY} "%1"' orden_forget_extensions
  StrCmp $R2 "" orden_forget_extensions orden_forget_progid_kept
  orden_forget_extensions:
    !insertmacro ORDEN_FORGET_EXTENSION "md"
    !insertmacro ORDEN_FORGET_EXTENSION "markdown"
    !insertmacro ORDEN_FORGET_EXTENSION "mdown"
    !insertmacro ORDEN_FORGET_EXTENSION "mkd"
    StrCmp $R2 "" orden_forget_progid_kept
      DeleteRegKey SHCTX "Software\Classes\Markdown"
  orden_forget_progid_kept:

  DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities\FileAssociations"

  ClearErrors
!macroend

!macro ORDEN_FORGET_OLD_PROG_IDS
  DeleteRegKey SHCTX "Software\Classes\NibURL"
  DeleteRegKey SHCTX "Software\Classes\NibPDF"
  DeleteRegValue SHCTX "Software\Classes\.pdf\OpenWithProgids" "NibPDF"
!macroend

!macro ORDEN_PDF_OPEN_WITH
  WriteRegStr SHCTX "Software\Classes\OrdenPDF" "" "${PRODUCTNAME} PDF"
  WriteRegStr SHCTX "Software\Classes\OrdenPDF\Application" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\OrdenPDF\Application" "ApplicationIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\OrdenPDF\DefaultIcon" "" "$INSTDIR\documents\pdf.ico"
  WriteRegStr SHCTX "Software\Classes\OrdenPDF\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr SHCTX "Software\Classes\.pdf\OpenWithProgids" "OrdenPDF" ""
!macroend

!macro ORDEN_PDF_FORGET
  ReadRegStr $R7 SHCTX "Software\Classes\OrdenPDF\shell\open\command" ""
  StrCmp $R7 '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"' 0 orden_pdf_kept
    DeleteRegKey SHCTX "Software\Classes\OrdenPDF"
    DeleteRegValue SHCTX "Software\Classes\.pdf\OpenWithProgids" "OrdenPDF"
  orden_pdf_kept:
  ClearErrors
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Delete "$INSTDIR\${ORDEN_OLD_BINARY}"
  !insertmacro ORDEN_PDF_OPEN_WITH

  WriteRegStr SHCTX "Software\Classes\OrdenURL" "" "${PRODUCTNAME} URL"
  WriteRegStr SHCTX "Software\Classes\OrdenURL\Application" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\OrdenURL\Application" "ApplicationIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\OrdenURL\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\OrdenURL\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" --url "%1"'

  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}" "" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe"'
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities" "ApplicationDescription" "Notes and the web in one window."
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities" "ApplicationIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities\Startmenu" "StartMenuInternet" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities\URLAssociations" "http" "OrdenURL"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities\URLAssociations" "https" "OrdenURL"
  WriteRegStr SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}" "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities"

  !insertmacro ORDEN_FORGET_FILES
  !insertmacro ORDEN_FORGET_OLD_PROG_IDS

  !insertmacro ORDEN_RETARGET_SHORTCUTS
  ClearErrors

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\${ORDEN_OLD_BINARY}"
  !insertmacro ORDEN_FORGET_STALE_SHORTCUT "$SMPROGRAMS\${PRODUCTNAME}.lnk" start
  !insertmacro ORDEN_FORGET_STALE_SHORTCUT "$DESKTOP\${PRODUCTNAME}.lnk" desktop
  !insertmacro ORDEN_PDF_FORGET

  !insertmacro ORDEN_FORGET_FILES

  ReadRegStr $R7 SHCTX "Software\Classes\OrdenURL\shell\open\command" ""
  StrCmp $R7 '"$INSTDIR\${MAINBINARYNAME}.exe" --url "%1"' 0 orden_browser_kept
    DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}"
    DeleteRegKey SHCTX "Software\Classes\OrdenURL"
    DeleteRegValue SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}"
  orden_browser_kept:
  !insertmacro ORDEN_FORGET_OLD_PROG_IDS
  ClearErrors

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

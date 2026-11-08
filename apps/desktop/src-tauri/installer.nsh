!define ORDEN_OLD_NAME_1 "Nib"
!define ORDEN_OLD_NAME_2 "nibeditor"
!define ORDEN_NAME "Orden"
!define ORDEN_OLD_BINARY "nib.exe"
!define ORDEN_UNINSTKEYS "Software\Microsoft\Windows\CurrentVersion\Uninstall"

Var OrdenOldDir
Var OrdenOldAsked

!define MUI_CUSTOMFUNCTION_GUIINIT OrdenFindOldInstall

!macro ORDEN_FIND_UNDER OLD ID
  StrCmp $OrdenOldDir "" 0 orden_find_${ID}_done
  ReadRegStr $OrdenOldDir SHCTX "${ORDEN_UNINSTKEYS}\${OLD}" "InstallLocation"
  StrCpy $R9 $OrdenOldDir 1
  StrCmp $R9 '"' 0 orden_find_${ID}_unquoted
    StrCpy $OrdenOldDir $OrdenOldDir "" 1
    StrCpy $OrdenOldDir $OrdenOldDir -1
  orden_find_${ID}_unquoted:
  StrCmp $OrdenOldDir "" orden_find_${ID}_done
  IfFileExists "$OrdenOldDir\uninstall.exe" orden_find_${ID}_done
    StrCpy $OrdenOldDir ""
  orden_find_${ID}_done:
!macroend

Function OrdenFindOldInstall
  StrCmp $OrdenOldAsked "1" orden_find_done
  StrCpy $OrdenOldAsked "1"

  Push $R9
  StrCpy $OrdenOldDir ""
  !insertmacro ORDEN_FIND_UNDER "${ORDEN_OLD_NAME_2}" 2
  !insertmacro ORDEN_FIND_UNDER "${ORDEN_OLD_NAME_1}" 1
  Pop $R9
  StrCmp $OrdenOldDir "" orden_find_done
    StrCmp $INSTDIR "$LOCALAPPDATA\${ORDEN_NAME}" 0 orden_find_done
    StrCpy $INSTDIR $OrdenOldDir
  orden_find_done:
FunctionEnd

!macro ORDEN_RENAME_SHORTCUT DIR OLD ID
  IfFileExists "${DIR}\${OLD}.lnk" 0 orden_lnk_${ID}_done
  !insertmacro IsShortcutTarget "${DIR}\${OLD}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  StrCmp $0 1 orden_lnk_${ID}_here
  !insertmacro IsShortcutTarget "${DIR}\${OLD}.lnk" "$INSTDIR\${ORDEN_OLD_BINARY}"
  Pop $0
  StrCmp $0 1 orden_lnk_${ID}_here
  StrCmp $OrdenOldDir "" orden_lnk_${ID}_done
  !insertmacro IsShortcutTarget "${DIR}\${OLD}.lnk" "$OrdenOldDir\${MAINBINARYNAME}.exe"
  Pop $0
  StrCmp $0 1 orden_lnk_${ID}_gone
  !insertmacro IsShortcutTarget "${DIR}\${OLD}.lnk" "$OrdenOldDir\${ORDEN_OLD_BINARY}"
  Pop $0
  StrCmp $0 1 orden_lnk_${ID}_gone orden_lnk_${ID}_done
  orden_lnk_${ID}_here:
    IfFileExists "${DIR}\${PRODUCTNAME}.lnk" orden_lnk_${ID}_gone
    Rename "${DIR}\${OLD}.lnk" "${DIR}\${PRODUCTNAME}.lnk"
    !insertmacro SetLnkAppUserModelId "${DIR}\${PRODUCTNAME}.lnk"
    Goto orden_lnk_${ID}_done
  orden_lnk_${ID}_gone:
    Delete "${DIR}\${OLD}.lnk"
  orden_lnk_${ID}_done:
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

!define ORDEN_PINNED "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"

!macro ORDEN_RETARGET_SHORTCUTS
  !insertmacro ORDEN_RETARGET_SHORTCUT "$SMPROGRAMS\${PRODUCTNAME}.lnk" start
  !insertmacro ORDEN_RETARGET_SHORTCUT "$DESKTOP\${PRODUCTNAME}.lnk" desktop
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

!macro ORDEN_FORGET_OLD_BROWSER OLD ID
  ReadRegStr $R7 SHCTX "Software\Clients\StartMenuInternet\${OLD}\shell\open\command" ""
  StrCmp $R7 "" orden_browser_${ID}_done
  StrCmp $R7 '"$INSTDIR\${MAINBINARYNAME}.exe"' orden_browser_${ID}_forget
  StrCmp $R7 '"$OrdenOldDir\${MAINBINARYNAME}.exe"' orden_browser_${ID}_forget
  StrCmp $R7 '"$INSTDIR\${ORDEN_OLD_BINARY}"' orden_browser_${ID}_forget
  StrCmp $R7 '"$OrdenOldDir\${ORDEN_OLD_BINARY}"' orden_browser_${ID}_forget
  StrCpy $R6 $R7 "" 1
  StrCpy $R6 $R6 -1
  IfFileExists $R6 orden_browser_${ID}_done
  orden_browser_${ID}_forget:
    DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\${OLD}"
    DeleteRegValue SHCTX "Software\RegisteredApplications" "${OLD}"
  orden_browser_${ID}_done:
!macroend

!macro ORDEN_FORGET_OLD_NAME OLD ID
  !insertmacro ORDEN_RENAME_SHORTCUT "$SMPROGRAMS" "${OLD}" start_${ID}
  !insertmacro ORDEN_RENAME_SHORTCUT "$DESKTOP" "${OLD}" desktop_${ID}
  DeleteRegKey SHCTX "${ORDEN_UNINSTKEYS}\${OLD}"
  DeleteRegKey SHCTX "Software\${MANUFACTURER}\${OLD}"
  !insertmacro ORDEN_FORGET_OLD_BROWSER "${OLD}" install_${ID}
!macroend

!macro ORDEN_FORGET_OLD_MSI
  IfSilent orden_msi_done
  StrCpy $R8 0
  orden_msi_loop:
    EnumRegKey $R7 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" $R8
    StrCmp $R7 "" orden_msi_done
    IntOp $R8 $R8 + 1
    ReadRegStr $R6 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$R7" "DisplayName"
    ReadRegStr $R5 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$R7" "Publisher"
    StrCmp "$R6$R5" "${ORDEN_OLD_NAME_1}${MANUFACTURER}" orden_msi_old
    StrCmp "$R6$R5" "${ORDEN_OLD_NAME_2}${MANUFACTURER}" orden_msi_old orden_msi_loop
    orden_msi_old:
    ReadRegStr $R6 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$R7" "UninstallString"
    ${StrCase} $R5 $R6 "L"
    ${StrLoc} $R5 $R5 "msiexec" ">"
    StrCmp $R5 0 0 orden_msi_loop
    ExecWait '$R6'
    StrCpy $WixMode 1
  orden_msi_done:
  ClearErrors
!macroend

!macro NSIS_HOOK_PREINSTALL
  StrCmp $OrdenOldAsked "1" orden_pre_asked
    StrCpy $R9 $INSTDIR
    Call OrdenFindOldInstall
    StrCmp $INSTDIR $R9 orden_pre_asked
      SetOutPath $INSTDIR
      RMDir $R9
  orden_pre_asked:

  StrCmp $OrdenOldDir "" orden_pre_moved
  StrCmp $OrdenOldDir $INSTDIR orden_pre_moved
    ExecWait '"$OrdenOldDir\uninstall.exe" /S /UPDATE _?=$OrdenOldDir'
    Delete "$OrdenOldDir\uninstall.exe"
    RMDir "$OrdenOldDir"
  orden_pre_moved:

  !insertmacro ORDEN_FORGET_OLD_MSI
  !insertmacro CheckIfAppIsRunning "${ORDEN_OLD_BINARY}" "${PRODUCTNAME}"
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

  DeleteRegKey SHCTX "Software\Classes\Nib.markdown"
  DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities\FileAssociations"
  DeleteRegKey SHCTX "Software\Nib"

  ClearErrors
!macroend

!macro ORDEN_PDF_OPEN_WITH
  WriteRegStr SHCTX "Software\Classes\NibPDF" "" "${PRODUCTNAME} PDF"
  WriteRegStr SHCTX "Software\Classes\NibPDF\Application" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\NibPDF\Application" "ApplicationIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\NibPDF\DefaultIcon" "" "$INSTDIR\documents\pdf.ico"
  WriteRegStr SHCTX "Software\Classes\NibPDF\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr SHCTX "Software\Classes\.pdf\OpenWithProgids" "NibPDF" ""
!macroend

!macro ORDEN_PDF_FORGET
  ReadRegStr $R7 SHCTX "Software\Classes\NibPDF\shell\open\command" ""
  StrCmp $R7 '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"' 0 orden_pdf_kept
    DeleteRegKey SHCTX "Software\Classes\NibPDF"
    DeleteRegValue SHCTX "Software\Classes\.pdf\OpenWithProgids" "NibPDF"
  orden_pdf_kept:
  ClearErrors
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Delete "$INSTDIR\${ORDEN_OLD_BINARY}"
  !insertmacro ORDEN_PDF_OPEN_WITH

  WriteRegStr SHCTX "Software\Classes\NibURL" "" "${PRODUCTNAME} URL"
  WriteRegStr SHCTX "Software\Classes\NibURL\Application" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\NibURL\Application" "ApplicationIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\NibURL\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\NibURL\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" --url "%1"'

  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}" "" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe"'
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities" "ApplicationDescription" "Notes and the web in one window."
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities" "ApplicationIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities\Startmenu" "StartMenuInternet" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities\URLAssociations" "http" "NibURL"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities\URLAssociations" "https" "NibURL"
  WriteRegStr SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}" "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities"

  !insertmacro ORDEN_FORGET_FILES

  !insertmacro ORDEN_FORGET_OLD_NAME "${ORDEN_OLD_NAME_1}" 1
  !insertmacro ORDEN_FORGET_OLD_NAME "${ORDEN_OLD_NAME_2}" 2
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

  ReadRegStr $R7 SHCTX "Software\Classes\NibURL\shell\open\command" ""
  StrCmp $R7 '"$INSTDIR\${MAINBINARYNAME}.exe" --url "%1"' 0 orden_browser_kept
    DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}"
    DeleteRegKey SHCTX "Software\Classes\NibURL"
    DeleteRegValue SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}"
  orden_browser_kept:
  !insertmacro ORDEN_FORGET_OLD_BROWSER "${ORDEN_OLD_NAME_1}" uninstall_1
  !insertmacro ORDEN_FORGET_OLD_BROWSER "${ORDEN_OLD_NAME_2}" uninstall_2
  ClearErrors

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

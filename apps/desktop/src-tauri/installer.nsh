!define NIB_OLD_NAME_1 "Nib"
!define NIB_OLD_NAME_2 "nibeditor"
!define NIB_NAME "Orden"
!define NIB_UNINSTKEYS "Software\Microsoft\Windows\CurrentVersion\Uninstall"

Var NibOldDir
Var NibOldAsked

!define MUI_CUSTOMFUNCTION_GUIINIT NibFindOldInstall

!macro NIB_FIND_UNDER OLD ID
  StrCmp $NibOldDir "" 0 nib_find_${ID}_done
  ReadRegStr $NibOldDir SHCTX "${NIB_UNINSTKEYS}\${OLD}" "InstallLocation"
  StrCpy $R9 $NibOldDir 1
  StrCmp $R9 '"' 0 nib_find_${ID}_unquoted
    StrCpy $NibOldDir $NibOldDir "" 1
    StrCpy $NibOldDir $NibOldDir -1
  nib_find_${ID}_unquoted:
  StrCmp $NibOldDir "" nib_find_${ID}_done
  IfFileExists "$NibOldDir\uninstall.exe" nib_find_${ID}_done
    StrCpy $NibOldDir ""
  nib_find_${ID}_done:
!macroend

Function NibFindOldInstall
  StrCmp $NibOldAsked "1" nib_find_done
  StrCpy $NibOldAsked "1"

  Push $R9
  StrCpy $NibOldDir ""
  !insertmacro NIB_FIND_UNDER "${NIB_OLD_NAME_2}" 2
  !insertmacro NIB_FIND_UNDER "${NIB_OLD_NAME_1}" 1
  Pop $R9
  StrCmp $NibOldDir "" nib_find_done
    StrCmp $INSTDIR "$LOCALAPPDATA\${NIB_NAME}" 0 nib_find_done
    StrCpy $INSTDIR $NibOldDir
  nib_find_done:
FunctionEnd

!macro NIB_RENAME_SHORTCUT DIR OLD ID
  IfFileExists "${DIR}\${OLD}.lnk" 0 nib_lnk_${ID}_done
  !insertmacro IsShortcutTarget "${DIR}\${OLD}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  StrCmp $0 1 nib_lnk_${ID}_here
  StrCmp $NibOldDir "" nib_lnk_${ID}_done
  !insertmacro IsShortcutTarget "${DIR}\${OLD}.lnk" "$NibOldDir\${MAINBINARYNAME}.exe"
  Pop $0
  StrCmp $0 1 nib_lnk_${ID}_gone nib_lnk_${ID}_done
  nib_lnk_${ID}_here:
    IfFileExists "${DIR}\${PRODUCTNAME}.lnk" nib_lnk_${ID}_gone
    Rename "${DIR}\${OLD}.lnk" "${DIR}\${PRODUCTNAME}.lnk"
    !insertmacro SetLnkAppUserModelId "${DIR}\${PRODUCTNAME}.lnk"
    Goto nib_lnk_${ID}_done
  nib_lnk_${ID}_gone:
    Delete "${DIR}\${OLD}.lnk"
  nib_lnk_${ID}_done:
!macroend

!macro NIB_FORGET_OLD_BROWSER OLD ID
  ReadRegStr $R7 SHCTX "Software\Clients\StartMenuInternet\${OLD}\shell\open\command" ""
  StrCmp $R7 "" nib_browser_${ID}_done
  StrCmp $R7 '"$INSTDIR\${MAINBINARYNAME}.exe"' nib_browser_${ID}_forget
  StrCmp $R7 '"$NibOldDir\${MAINBINARYNAME}.exe"' nib_browser_${ID}_forget
  StrCpy $R6 $R7 "" 1
  StrCpy $R6 $R6 -1
  IfFileExists $R6 nib_browser_${ID}_done
  nib_browser_${ID}_forget:
    DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\${OLD}"
    DeleteRegValue SHCTX "Software\RegisteredApplications" "${OLD}"
  nib_browser_${ID}_done:
!macroend

!macro NIB_FORGET_OLD_NAME OLD ID
  !insertmacro NIB_RENAME_SHORTCUT "$SMPROGRAMS" "${OLD}" start_${ID}
  !insertmacro NIB_RENAME_SHORTCUT "$DESKTOP" "${OLD}" desktop_${ID}
  DeleteRegKey SHCTX "${NIB_UNINSTKEYS}\${OLD}"
  DeleteRegKey SHCTX "Software\${MANUFACTURER}\${OLD}"
  !insertmacro NIB_FORGET_OLD_BROWSER "${OLD}" install_${ID}
!macroend

!macro NIB_FORGET_OLD_MSI
  IfSilent nib_msi_done
  StrCpy $R8 0
  nib_msi_loop:
    EnumRegKey $R7 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" $R8
    StrCmp $R7 "" nib_msi_done
    IntOp $R8 $R8 + 1
    ReadRegStr $R6 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$R7" "DisplayName"
    ReadRegStr $R5 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$R7" "Publisher"
    StrCmp "$R6$R5" "${NIB_OLD_NAME_1}${MANUFACTURER}" nib_msi_old
    StrCmp "$R6$R5" "${NIB_OLD_NAME_2}${MANUFACTURER}" nib_msi_old nib_msi_loop
    nib_msi_old:
    ReadRegStr $R6 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$R7" "UninstallString"
    ${StrCase} $R5 $R6 "L"
    ${StrLoc} $R5 $R5 "msiexec" ">"
    StrCmp $R5 0 0 nib_msi_loop
    ExecWait '$R6'
    StrCpy $WixMode 1
  nib_msi_done:
  ClearErrors
!macroend

!macro NSIS_HOOK_PREINSTALL
  StrCmp $NibOldAsked "1" nib_pre_asked
    StrCpy $R9 $INSTDIR
    Call NibFindOldInstall
    StrCmp $INSTDIR $R9 nib_pre_asked
      SetOutPath $INSTDIR
      RMDir $R9
  nib_pre_asked:

  StrCmp $NibOldDir "" nib_pre_moved
  StrCmp $NibOldDir $INSTDIR nib_pre_moved
    ExecWait '"$NibOldDir\uninstall.exe" /S /UPDATE _?=$NibOldDir'
    Delete "$NibOldDir\uninstall.exe"
    RMDir "$NibOldDir"
  nib_pre_moved:

  !insertmacro NIB_FORGET_OLD_MSI
!macroend

!macro NIB_FORGET_EXTENSION EXT
  ReadRegStr $R0 SHCTX "Software\Classes\.${EXT}" ""
  StrCmp $R0 "Markdown" 0 nib_forget_${EXT}_backup
    ReadRegStr $R1 SHCTX "Software\Classes\.${EXT}" "Markdown_backup"
    StrCmp $R1 "" nib_forget_${EXT}_unset
      WriteRegStr SHCTX "Software\Classes\.${EXT}" "" $R1
      Goto nib_forget_${EXT}_backup
    nib_forget_${EXT}_unset:
      DeleteRegValue SHCTX "Software\Classes\.${EXT}" ""
  nib_forget_${EXT}_backup:
  DeleteRegValue SHCTX "Software\Classes\.${EXT}" "Markdown_backup"
!macroend

!macro NIB_FORGET_FILES
  ReadRegStr $R2 SHCTX "Software\Classes\Markdown\shell\open\command" ""
  StrCmp $R2 '$INSTDIR\${MAINBINARYNAME}.exe "%1"' nib_forget_extensions
  StrCmp $R2 "" nib_forget_extensions nib_forget_progid_kept
  nib_forget_extensions:
    !insertmacro NIB_FORGET_EXTENSION "md"
    !insertmacro NIB_FORGET_EXTENSION "markdown"
    !insertmacro NIB_FORGET_EXTENSION "mdown"
    !insertmacro NIB_FORGET_EXTENSION "mkd"
    StrCmp $R2 "" nib_forget_progid_kept
      DeleteRegKey SHCTX "Software\Classes\Markdown"
  nib_forget_progid_kept:

  DeleteRegKey SHCTX "Software\Classes\Nib.markdown"
  DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities\FileAssociations"
  DeleteRegKey SHCTX "Software\Nib"

  ClearErrors
!macroend

!macro NIB_PDF_OPEN_WITH
  WriteRegStr SHCTX "Software\Classes\NibPDF" "" "${PRODUCTNAME} PDF"
  WriteRegStr SHCTX "Software\Classes\NibPDF\Application" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\NibPDF\Application" "ApplicationIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\NibPDF\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\NibPDF\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr SHCTX "Software\Classes\.pdf\OpenWithProgids" "NibPDF" ""
!macroend

!macro NIB_PDF_FORGET
  ReadRegStr $R7 SHCTX "Software\Classes\NibPDF\shell\open\command" ""
  StrCmp $R7 '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"' 0 nib_pdf_kept
    DeleteRegKey SHCTX "Software\Classes\NibPDF"
    DeleteRegValue SHCTX "Software\Classes\.pdf\OpenWithProgids" "NibPDF"
  nib_pdf_kept:
  ClearErrors
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro NIB_PDF_OPEN_WITH

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

  !insertmacro NIB_FORGET_FILES

  !insertmacro NIB_FORGET_OLD_NAME "${NIB_OLD_NAME_1}" 1
  !insertmacro NIB_FORGET_OLD_NAME "${NIB_OLD_NAME_2}" 2
  ClearErrors

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro NIB_PDF_FORGET

  !insertmacro NIB_FORGET_FILES

  ReadRegStr $R7 SHCTX "Software\Classes\NibURL\shell\open\command" ""
  StrCmp $R7 '"$INSTDIR\${MAINBINARYNAME}.exe" --url "%1"' 0 nib_browser_kept
    DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}"
    DeleteRegKey SHCTX "Software\Classes\NibURL"
    DeleteRegValue SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}"
  nib_browser_kept:
  !insertmacro NIB_FORGET_OLD_BROWSER "${NIB_OLD_NAME_1}" uninstall_1
  !insertmacro NIB_FORGET_OLD_BROWSER "${NIB_OLD_NAME_2}" uninstall_2
  ClearErrors

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

; Registers Nib the way Windows expects of an application that can open a file
; type: a ProgID saying how to launch it, a Capabilities block listing the
; extensions it handles, and an entry in RegisteredApplications so that Nib
; appears under Settings > Default apps.
;
; Windows 8 and later will not let an installer claim a file type on its own.
; The assignment is sealed with a per-user hash the shell verifies, so the most
; an installer can honestly do is register. The choice itself is made under
; Settings > Default apps, and the installer does not ask about it.
;
; Only core instructions here. Hook files are included before the template
; pulls in LogicLib, so ${If} and friends are not available yet.

!macro NSIS_HOOK_POSTINSTALL
  ; How to open a markdown file with Nib. Deliberately not added to the
  ; OpenWithProgids list of any extension - Tauri's own file associations
  ; already do that, and a second entry would show Nib twice in "Open with".
  WriteRegStr SHCTX "Software\Classes\Nib.markdown" "" "Markdown document"
  WriteRegStr SHCTX "Software\Classes\Nib.markdown\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\Nib.markdown\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'

  ; What Nib is capable of opening, which is what Default apps reads.
  WriteRegStr SHCTX "Software\Nib\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Nib\Capabilities" "ApplicationDescription" "A markdown editor, and nothing else."
  WriteRegStr SHCTX "Software\Nib\Capabilities\FileAssociations" ".md" "Nib.markdown"
  WriteRegStr SHCTX "Software\Nib\Capabilities\FileAssociations" ".markdown" "Nib.markdown"
  WriteRegStr SHCTX "Software\Nib\Capabilities\FileAssociations" ".mdown" "Nib.markdown"
  WriteRegStr SHCTX "Software\Nib\Capabilities\FileAssociations" ".mkd" "Nib.markdown"
  WriteRegStr SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}" "Software\Nib\Capabilities"

  ; Explorer caches file-type icons and handlers until it is told otherwise.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey SHCTX "Software\Classes\Nib.markdown"
  DeleteRegKey SHCTX "Software\Nib"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}"

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

; Cockpit look: dark welcome, finish and header areas, header art on the right.
; Tauri includes this file before it defines the installer pages.
!define MUI_BGCOLOR "0B0E12"
!define MUI_TEXTCOLOR "E4EBF1"
!define MUI_HEADERIMAGE_RIGHT
; Themed checkboxes ignore the text colour; classic ones stay readable on dark.
!define MUI_FORCECLASSICCONTROLS

; Removing the app also stops it starting with Windows. An update runs the old uninstaller
; too (with /UPDATE), and must keep the entry, or the app won't start at the next sign-in.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Edge Cockpit"
  ${EndIf}
!macroend

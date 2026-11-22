; Cockpit look: dark welcome, finish and header areas, header art on the right.
; Tauri includes this file before it defines the installer pages.
!define MUI_BGCOLOR "0B0E12"
!define MUI_TEXTCOLOR "E4EBF1"
!define MUI_HEADERIMAGE_RIGHT
; Themed checkboxes ignore the text colour; classic ones stay readable on dark.
!define MUI_FORCECLASSICCONTROLS

; Removing the app also stops it starting with Windows.
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Edge Cockpit"
!macroend

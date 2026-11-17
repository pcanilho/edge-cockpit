; Removing the app also stops it starting with Windows.
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Edge Cockpit"
!macroend

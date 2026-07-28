; NSIS installer hooks for Selah.
;
; Why this exists
; --------------
; Installs were failing with:
;
;   Error opening file for writing:
;   C:\Users\<user>\AppData\Local\Selah\selah.exe
;
; Tauri's template does check for a running app before copying files, but it
; terminates the process and then sleeps a flat 500 ms before writing.
; Terminating a process does not synchronously release its image file: Windows
; keeps the executable locked until the last handle and mapped section are torn
; down, and on a machine where Selah is holding a transcription model, an audio
; device and two webview windows that can take longer than half a second. The
; copy then fails on the very first file, which is selah.exe itself.
;
; This hook runs immediately before that check, and does the same job with the
; wait the template lacks: ask (or, for an update, don't need to ask), close,
; then poll until the binary is genuinely writable. By the time the template's
; own check runs there is nothing left running for it to find.
;
; The poll is the operation that was failing - opening the file for writing - so
; it answers the real question rather than a proxy for it.

; Keep this file ASCII-only. makensis assumes the system code page for a source
; file with no BOM, so a UTF-8 dash or ellipsis reaches the installer UI as
; mojibake.

!macro NSIS_HOOK_PREINSTALL
  ; NSIS registers are global and shared with the rest of the section, so borrow
  ; and return the three this uses. Every exit path below funnels through
  ; selah_preinstall_done, so the stack always balances -- except Abort, which
  ; tears down the install anyway.
  Push $0
  Push $1
  Push $2

  ; First install: nothing to close, nothing to wait for.
  IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 selah_preinstall_done

  ; Is an instance actually running? `FindProcess*` pushes 0 when found.
  !if "${INSTALLMODE}" == "currentUser"
    nsis_tauri_utils::FindProcessCurrentUser "${MAINBINARYNAME}.exe"
  !else
    nsis_tauri_utils::FindProcess "${MAINBINARYNAME}.exe"
  !endif
  Pop $0
  ${If} $0 <> 0
    Goto selah_preinstall_done
  ${EndIf}

  ; Never close a running Selah behind the operator's back. An update launched
  ; from inside the app (/UPDATE) has already exited by design, and a silent or
  ; passive install has opted out of prompts; anything else is someone
  ; double-clicking the installer while Selah is on a projector, and they get
  ; asked first. Cancel aborts the install, matching the template's own check.
  ${If} $UpdateMode <> 1
  ${AndIf} $PassiveMode <> 1
    IfSilent selah_close_app 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
      "Selah is running and has to close before it can be updated.$\n$\nAnything on the live output will go dark until Selah reopens." \
      IDOK selah_close_app IDCANCEL selah_cancel
    selah_cancel:
      Abort "Update cancelled - Selah is still running."
  ${EndIf}

  selah_close_app:
    DetailPrint "Closing Selah..."
    !if "${INSTALLMODE}" == "currentUser"
      nsis_tauri_utils::KillProcessCurrentUser "${MAINBINARYNAME}.exe"
    !else
      nsis_tauri_utils::KillProcess "${MAINBINARYNAME}.exe"
    !endif
    Pop $0

  ; Up to 40 x 250 ms = 10 s. Long enough for a slow machine to release the
  ; image, short enough that a genuinely stuck process still falls through to
  ; the template's check (which reports it properly) instead of hanging here.
  StrCpy $1 40

  selah_wait_loop:
    ClearErrors
    ; Append mode neither truncates nor creates the file - it only answers
    ; "is this writable yet?".
    FileOpen $2 "$INSTDIR\${MAINBINARYNAME}.exe" a
    ${IfNot} ${Errors}
      FileClose $2
      Goto selah_preinstall_done
    ${EndIf}

    IntOp $1 $1 - 1
    ${If} $1 <= 0
      DetailPrint "Selah is taking a long time to close."
      Goto selah_preinstall_done
    ${EndIf}
    Sleep 250
    Goto selah_wait_loop

  selah_preinstall_done:
    Pop $2
    Pop $1
    Pop $0
!macroend

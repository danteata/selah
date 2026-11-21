# Selah

Selah puts lyrics, scripture and media on a church's screens during a service, operated from a desk and followed by phones in a live session.

## Sermon listener

**Sermon listener**:
The feature that listens to the service as it happens and follows along, offering or showing the scripture and lyrics being spoken or sung.

**Listening session**:
Everything the sermon listener hears between one clear of the transcript and the next: the transcript, the heard verses, the saved copy. It can span several listening runs. Nothing heard carries over from one listening session to the next.
_Avoid_: recording

**Listening run**:
One stretch of actually listening, from Start to Stop, within a listening session. Pausing for a hymn and pressing Start again begins a new run in the same session; restarting a microphone that dropped out does not begin a new run at all.
_Avoid_: session (for a single Start-to-Stop stretch)

**Utterance**:
A stretch of speech the transcriber has committed as final text, with its timing in the listening session.
_Avoid_: chunk, segment, transcript line

**Scripture follower**:
The part of the sermon listener that works out which passages the preacher is reading or citing and decides which verse, if any, to show.
_Avoid_: verse tracker, verse detector

**Heard verse**:
A verse the scripture follower has recognised during the current listening session, whether or not it was shown.
_Avoid_: detected verse

**Reading context**:
The passage the preacher is currently taken to be in, used to make sense of partial references such as "verse 16" or "the next verse".
_Avoid_: active reference

**Song follower**:
The part of the sermon listener that recognises which song is being sung and keeps up with where the congregation is in it.
_Avoid_: song auto-detect

## Songs and the screen

**Section**:
One named part of a song's lyrics, such as Verse 1, Chorus or Bridge. Each section is one slide.
_Avoid_: verse (for anything but a verse section), slide (for the lyrics themselves)

**Arrangement**:
The order a song's sections are sung in, where a section may come round more than once.
_Avoid_: order, flow

**On air**:
The slide currently showing on the output screen.
_Avoid_: live slide, projected, active

**Schedule**:
The saved plan of what a service will show, item by item, in order.
_Avoid_: playlist, service plan

## The operator's desk

**Panel**:
One thing the operator looks at or works in on the desk, such as the service order, Preview, Live or the Bible. It can be moved, resized, stacked with others as tabs, or closed.
_Avoid_: widget, pane, card

**Layout**:
How the panels are arranged on one desk: which are open, where each sits and how big it is.
_Avoid_: workspace mode, dashboard

**Default layout**:
The layout Selah starts with and returns to on reset.
_Avoid_: studio mode

**Classic layout**:
The built-in layout with the service order on the left, Preview and Live across the top and the library tabbed along the bottom, familiar to operators coming from other presentation software.

**Saved layout**:
A layout the operator has kept under a name so they can switch back to it in one step.
_Avoid_: preset, workspace

**Service order**:
The panel listing the active schedule's slides in the order they will be shown.
_Avoid_: preview (for this panel), queue, slide list

**Staged slide**:
The slide the operator has picked to go on air next, waiting for them to send it.
_Avoid_: active slide, selected slide

**Next up**:
The slide after the one on air in the service order. Nobody picks it; it is simply what comes next.
_Avoid_: staged (for this)

**Preview**:
The panel showing the staged slide, or next up when nothing is staged.
_Avoid_: next up (for the panel)

**Live**:
The panel showing what is on air.
_Avoid_: program, output (for the panel)

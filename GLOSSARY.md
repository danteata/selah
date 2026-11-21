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
_Avoid_: live slide, projected

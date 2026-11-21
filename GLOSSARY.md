# Selah

Selah puts lyrics, scripture and media on a church's screens during a service, operated from a desk and followed by phones in a live session.

## Sermon listener

**Sermon listener**:
The feature that listens to the service as it happens and follows along, offering or showing the scripture and lyrics being spoken or sung.

**Listening session**:
One stretch of the sermon listener running, from start to stop. Nothing the sermon listener has heard carries over from one listening session to the next.
_Avoid_: recording, listening run

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

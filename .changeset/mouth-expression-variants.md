---
"mesh-avatar-studio": minor
"mesh-avatar": minor
---

- Add live expressions `grin` and `pout`, with optional `mouth_grin` and `mouth_pout` closed-mouth drawings in the same format as `mouth_angry` and `mouth_sad`. Avatars without those drawings keep their previous look.
- Add optional rig fields `mouth.smileCurve` (multiplier on the natural mouth smile curve) and `expression.blend` (expression fade rate in 1/s). Omitting them keeps the existing `1`, `9` and `12` defaults, so existing avatars and older runtimes render as before.

---
"mesh-avatar-studio": minor
"mesh-avatar": minor
---

- Add "New from Image" feature: upload a PNG from the editor toolbar to automatically initialise a new project with a proportional draft rig and built layers, ready for manual rig fine-tuning.
- Only PNG files are accepted for new projects and drawn variants. Variants can be assigned per slot from the variants panel and are scaled and aligned automatically; the named multi-file drop remains available as an advanced option.
- Add universal natural mouth shader (`mouth.style: "natural"`): provides realistic oral cavity depth, curved ivory dental arches, and warm natural tongue shading that works automatically on any character (including beards, mustaches, and 3D styles) without requiring drawn sprite variants.
- Fix UV offline mode for project rebuild jobs to avoid PyPI timeout errors.

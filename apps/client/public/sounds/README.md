# Replacing a sound with a file

Every sound of the game is synthesized (see `src/audio/recipes.ts`). To use a recorded sound instead, put the
file here (`.ogg` or `.mp3`, short) and list it in `manifest.json`:

```json
{ "cannon": "cannon.ogg", "sink": "sink.ogg" }
```

The key is the sound id (shown in brackets on the sound test page, `/sounds.html` on the dev server). Sounds that
are not listed stay synthesized. A file that is missing or cannot be read is ignored. Pitch varies a little on
every play, so one file does not sound like a copy.

Keep the total small (design budget: 300 KB for all sounds) and note each file's source and license in
`ASSETS.md`.

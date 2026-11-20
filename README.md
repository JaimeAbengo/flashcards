# Flashcards

A home-screen web app for spaced-repetition flashcards: imports Anki decks (.apkg, old and new formats) and Quizlet/text exports, schedules reviews with FSRS, and has Quizlet-style games (Flip, Learn, Match, Write, Test, Gravity). Everything is stored on the device; it works offline.

- `docs/` – the published app (served by GitHub Pages)
- `src/` – source; `npm install && node build.mjs` rebuilds `docs/app.js`

Made by Jaime Abengoechea. Libraries: ts-fsrs, sql.js, fflate, fzstd (all MIT).

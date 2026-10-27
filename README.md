# FitPlan

Personal training planner PWA (Spartan 2027 season). All data stays on the device (IndexedDB).

## Deploy (GitHub Pages)
Upload all files to the repo root (keep `js/` and `icons/`). Settings → Pages → Deploy from branch `main` / root.

## Update
Change files, bump `VERSION` in `sw.js`, commit. The app shows "New version available".

## Changelog
- 1.0.1-M1: header no longer under iOS status bar (blur fix); backup file prepared before tap so iOS share sheet works; backup banner updates immediately; last backup date shown in Settings.
- 1.0.0-M1: plan import, Today / Week / Races, status + notes, backup/restore.

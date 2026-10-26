# FitPlan

Personal training planner PWA (Spartan 2027 season). All data stays on the device (IndexedDB).

## Deploy (GitHub Pages)
1. Upload all files in this folder to the repo root (keep folders `js/` and `icons/`).
2. Settings → Pages → Deploy from branch → `main` / root.
3. iPhone: open `https://<user>.github.io/<repo>/` in Safari → Share → Add to Home Screen.

## Update
Change files, bump `VERSION` in `sw.js`, commit. The app shows "New version available".

## Data contract
- Input: `plan.json` (schema `fitplan.plan/1.0`), see FitPlan Spec v1.0.
- Never commit personal data (see `.gitignore`).

## Milestones
- [x] M1 Plan import, Today / Week / Races, manual status + notes, backup/restore
- [ ] M2 RunGap FIT import, metrics, matching
- [ ] M3 Check-in, progress export
- [ ] M4 Trends

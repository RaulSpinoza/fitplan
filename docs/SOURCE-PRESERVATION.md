# Source preservation (M4.1)

`fitplan-source.txt` is a single-file snapshot of the complete app source, regenerated
automatically by GitHub Actions on every push to `main`. `version.json` lists the app
version, source commit and SHA-256 of every file.

## Starting a Copilot session
1. Open https://raw.githubusercontent.com/RaulSpinoza/fitplan/main/fitplan-source.txt
2. Save/download it and **attach the file directly from the device** (Files / Explorer).
3. Write: "FitPlan bundle attached – <what to change>".

Copilot restores the exact tree with `python tools/bundle.py unpack fitplan-source.txt <dir>`,
which aborts on any checksum mismatch instead of guessing.

## Applying an update from Copilot
Copilot returns only the changed files plus a changelog. Replace those files in the repo,
bump `VERSION` in `sw.js` when app files change, commit, push. The Action rebuilds the bundle.

## Local use
    python tools/bundle.py make                     # build bundle + version.json
    python tools/bundle.py verify fitplan-source.txt
    python tools/bundle.py unpack fitplan-source.txt restored/

Excluded from the bundle: `samples/`, `*.fit`, backups, progress exports.

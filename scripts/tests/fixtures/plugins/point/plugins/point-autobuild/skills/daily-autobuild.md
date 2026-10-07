---
id: a7115ce6-e78f-5fb9-bfc4-ce3b1b015a17
name: Daily autobuild
description: Pick one Point app that most needs work and advance it through Point's AutoBuild guide.
---
1. Read POINT.md (System map, Engineering rules) and agents/POINT-AUTOBUILD-GUIDE.md.
2. Choose one app under apps/ whose .point.json convexId matches a saved App; prefer failing
   quality gates, then stale builds. Record why it was chosen.
3. Work only inside that app's workspace. Run Point's own checks (blueprint:preflight, check:quality).
4. Commit on a branch named autobuild/<app>/<date>. Never push to main, never deploy.
5. Write evidence.md to the run output: app, reason, checks run with results, what remains.

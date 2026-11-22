A MEMORY WITHOUT AN OWNER — GHOST MANIFEST UPDATE

Contents:
  ghost/ghost-images.json  — curated list of 13 JPEG images
  build-mpe-ghost.js       — exact one-time update for current Node server and Living Memory page

Install:
1. Extract ZIP. Upload build-mpe-ghost.js to the root of arirapo/a-memory-without-an-owner on GitHub.
2. Upload ghost-images.json to the existing ghost/ folder on GitHub. Do not remove images.
3. On Mac Mini:
   cd ~/mpe-production-05
   git pull --rebase origin main
   node build-mpe-ghost.js
   node --check server.js
   git add server.js living-memory.html
   git commit -m "Use curated random ghost manifest"
   git push origin main
4. GoDaddy: Settings > Integrations > Pull from GitHub.
5. Check /ghost/ghost-images.json, then reload / several times.

The builder checks all 13 JPEG files before editing. It only changes the ghost-image serving section of server.js and the initial ghost-image selection in living-memory.html. The existing rendering, blur/opacity/darkening, memory engine, submission forms, and receipts are left intact.

In future, add a JPEG under ghost/ and add its filename to ghost/ghost-images.json. Each deployed image must use naming R + seven digits + .jpeg. Push and Pull from GitHub. No further code modifications needed.

Existing current files get local backups named .before-ghost-manifest; do not commit those backups.

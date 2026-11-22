MPE 1.3 — SHARED I WAS HERE RECEIPT

Upload to the ROOT of the existing GitHub repository:
  receipt-kit.js      (REPLACE current version)
  build-mpe13.js      (NEW)

The other current files stay where they are. In particular:
  mpe-qr.js
  receipt-poetry-lexicon.json
  experimental-offer.html
  receipt-lab.html
  server.js

After uploading to GitHub, on Mac Mini:

  cd ~/mpe-production-05
  git pull --rebase origin main
  node build-mpe13.js
  node --check server.js

If successful:
  git add leave-a-trace.html
  git commit -m "Use shared I was here QR receipts on both offering pages"
  git push origin main

GoDaddy > Settings > Integrations > Pull from GitHub.

Test:
  /receipt-lab  (new quiet vertical imprint)
  /experiment  (new quiet vertical imprint)
  /offer       (shared QR keepsake after accepted text or silence)
  /studio      (must remain password-protected)

Important:
  receipt-kit.js in GitHub is replaced BEFORE running build-mpe13.js;
  only leave-a-trace.html is generated locally by the builder.
  Do not repeat build-mpe13.js after success.
  Memory engine, existing MySQL data and public artwork are NOT changed.

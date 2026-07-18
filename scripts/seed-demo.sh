#!/usr/bin/env bash
# Seed the committed demo films into the live store (.recut/). Idempotent.
# Run once after cloning, before starting the server.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .recut/pipeline .recut/projects
for id in 84a37d3f e41ccaa2 99941756; do
  cp "fixtures/demo-projects/$id.pipeline.json" ".recut/pipeline/$id.json"
  cp "fixtures/demo-projects/$id.project.json"  ".recut/projects/$id.json"
  echo "seeded $id"
done
echo "done. demo media is already in public/generated/ (committed)."

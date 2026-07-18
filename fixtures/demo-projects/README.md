# Demo project snapshots

Canonical state of the three demo films, captured 2026-07-18 with the author's
final timeline edits. The live store (.recut/) is gitignored; these snapshots
are the source of truth for deployment seeding and for recovery if a doc is
ever clobbered.

Restore locally / seed a deployment:

```
for id in 84a37d3f e41ccaa2 99941756; do
  cp fixtures/demo-projects/$id.pipeline.json .recut/pipeline/$id.json
  cp fixtures/demo-projects/$id.project.json  .recut/projects/$id.json
done
```

The referenced media lives in public/generated/ (committed).

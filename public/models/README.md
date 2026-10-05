# Crystal core models

Drop a `.glb` here and point a project at it in `src/config/content.ts`:

```ts
core: { kind: 'graph', model: '/models/your-model.glb', modelScale: 0.8 }
```

`kind` is still required — it is the fallback that renders while the file
loads, and permanently if the file is missing or fails to parse.

The loader centres the model and fits it to a unit box before applying
`modelScale`, so a model authored at any size will sit correctly inside the
shard. Keep files under ~2MB and around 5–20k triangles; use Draco or
meshopt compression if the source is heavier.

# Shard runner and report tools

See [the standalone harness guide](../README.md) for the supported local CLI,
configurable limits/output directory, frozen zoo protocols and engine build recipe.

`run.mjs` runs one shard of a saved suite; `report.mjs` aggregates shard output.
The experiment CLI invokes these tools and writes its effective suite first.
For distributed execution use `--shard N --shards TOTAL` (up to 256 shards), retain
all output directories, then pass their common root to `report.mjs --runs ROOT`.
Missing or duplicated assignments remain errors, not dropped observations.

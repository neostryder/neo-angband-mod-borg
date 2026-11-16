# Outside-worker scoring

Each worker receives one original requirement, its twin requirement, the reference source at 7eb4b78, and the scenario checks. The worker submits a source diff for the twin. The reference twin.patch stays separate from that submission.

The evaluator handles each submission in this order:

1. It copies the reference tree and suite into a unique directory under .scratch/ and shares the existing node_modules through a junction.
2. It runs git apply --check and then git apply on the submitted diff in that copy. A rejected patch is recorded as an application failure.
3. It rejects changes to the suite, Core, SDK, manifests, or contracts before any check runs.
4. It sets BORG_MUTATION_PAIRS=1 and runs the pair's twin.test.ts and original.test.ts with the installed Vitest executable and --maxWorkers=1.
5. It records both exit codes, the assertion verdicts, and the patch size.
6. It deletes the scratch copy after recording results.

Missing tests, import failures, and exceptions make an evaluation invalid and do not count as requirement failures. A twin pass with an original failure distinguishes the new requirement. A twin pass with an original pass needs review, because the two checks should disagree on the same scenario.

For each worker, the report lists every pair's original and twin result on that worker's patched copy and records the reference spread beside the worker spread. The twin completion rate is the fraction of all assigned twins that pass with a valid evaluation. The requirement spread uses the same sign as the reference matrix: original pass rate minus twin pass rate on the worker's patched copies. An unchanged submission has a positive spread. A submission that satisfies every twin and rejects every old requirement has a negative spread.

The evaluator reports each worker separately and does not average spreads across workers. Invalid evaluations stay in the denominator as unsuccessful twins and add zero passes to both rates. This suite contains only the reference matrix and runs no outside worker.

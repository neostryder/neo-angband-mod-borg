#!/usr/bin/env node
/**
 * Run the plugin builder, from wherever it can be found.
 *
 * The transform that turns `src/plugin.ts` into the `plugin.js` this repository ships
 * belongs to the game, not to this mod: the rules it enforces are the plugin ABI. It
 * lives at `packages/mod-sdk/bin/neo-angband-mod-build.mjs` in the game's repository and
 * ships inside `@rpgm-tools/neo-angband-mod-sdk`.
 *
 * TWO SOURCES, IN ORDER, and the order is not arbitrary:
 *
 *   1. A sibling checkout of the game (NEO_ANGBAND_REPO, or ../neo-angband). Preferred
 *      because the tests already need that checkout for the content pack, so it costs
 *      nothing here - and because it is the copy that matches the engine this mod is
 *      being developed against.
 *   2. The published SDK in node_modules. This is the path a third-party mod author
 *      takes, and the reason the tool is published at all.
 *
 * The published 0.10.0 tarball predates the bin, so on a fresh clone today source 1 is
 * the one that works. Said out loud rather than left as a confusing "command not found":
 * a fallback whose absence is unexplained is how someone concludes the tool is broken.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const REL = join("packages", "mod-sdk", "bin", "neo-angband-mod-build.mjs");

/* Order matters, and it used to be the other way round.
 *
 * The INSTALLED SDK is the default: it is the version this repository pins, the
 * one CI installs, and the one a third-party author would get. A sibling checkout
 * of the game is whatever is in that working tree right now - possibly mid-edit,
 * possibly a different branch - and plugin.js is a SHIPPED artefact whose SHA-256
 * goes in the catalogue, so building it against an unpinned tree is a way to
 * publish something nobody else can reproduce. The sibling stays available, below
 * the pinned copy, for working on the SDK and a mod together.
 *
 * NEO_ANGBAND_REPO still wins outright, because setting it is a deliberate act. */
const candidates = [];
const explicit = process.env["NEO_ANGBAND_REPO"];
if (explicit !== undefined && explicit !== "") candidates.push(join(explicit, REL));
candidates.push(
  fileURLToPath(
    new URL("../node_modules/@rpgm-tools/neo-angband-mod-sdk/bin/neo-angband-mod-build.mjs", import.meta.url),
  ),
);
candidates.push(fileURLToPath(new URL(`../../neo-angband/${REL.replace(/\\/g, "/")}`, import.meta.url)));

const bin = candidates.find((p) => existsSync(p));
if (bin === undefined) {
  console.error(
    "Cannot find neo-angband-mod-build, the tool that builds plugin.js from src/.\n" +
      "It ships with the game's mod SDK. Either check out\n" +
      "https://github.com/neostryder/neo-angband as a sibling of this repository (which\n" +
      "the tests need anyway), set NEO_ANGBAND_REPO to where it already is, or install a\n" +
      "version of @rpgm-tools/neo-angband-mod-sdk new enough to include the bin.\n" +
      `Looked for:\n${candidates.map((c) => `  ${c}`).join("\n")}`,
  );
  process.exit(1);
}

/* --root is this repository, which IS the mod folder: plugin.ts, manifest.json and the
 * built plugin.js all sit here, because that pair is what the game fetches and hashes.
 * The builder writes beside the manifest by default, so there is nothing else to say. */
try {
  execFileSync(
    process.execPath,
    [bin, "--root", fileURLToPath(new URL("../", import.meta.url)), ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
} catch (e) {
  process.exit(typeof e.status === "number" ? e.status : 1);
}

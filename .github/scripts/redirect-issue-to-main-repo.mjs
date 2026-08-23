#!/usr/bin/env node
/**
 * Redirect an issue opened directly on a mod repo into the consolidated
 * neostryder/neo-angband tracker, so every issue lives in one place
 * regardless of which repo a reporter happened to file it on.
 *
 * Reused byte-for-byte across the five mod repositories - only the
 * repository name (used to derive the repo:X label) varies, and that's read
 * from the environment rather than hardcoded per copy.
 *
 * Env vars:
 *   MOD_REPO      "owner/name" of the repo this ran in, e.g.
 *                 "neostryder/neo-angband-mod-borg"
 *   ISSUE_NUMBER  the just-opened issue's number
 *   ISSUE_URL     the just-opened issue's URL
 *   ISSUE_TITLE   the just-opened issue's title
 *   ISSUE_BODY    the just-opened issue's body (may be empty)
 *   ISSUE_AUTHOR  the reporter's GitHub username
 *   ISSUE_LABELS  comma-separated label names already on the issue
 *   GH_TOKEN      a token with issue read/write on both this repo and
 *                 neostryder/neo-angband (the default per-repo
 *                 GITHUB_TOKEN can't write to a different repository)
 *
 * Deliberately does not label the new issue source:community - it's still
 * genuinely "opened directly on GitHub", now on the repo the rest of the
 * pipeline watches, so the existing GitHub-native announcement scan
 * (neo-angband-issue-webhook.py's announce_github_native_issues) picks it up
 * and gives it a Discord thread automatically, attributed to the real
 * reporter. This script's only job is getting the issue onto the right repo
 * with the right labels - Discord visibility is already handled downstream.
 */

import { execFileSync } from "node:child_process";

const MAIN_REPO = "neostryder/neo-angband";

const MOD_REPO = requireEnv("MOD_REPO");
const ISSUE_NUMBER = requireEnv("ISSUE_NUMBER");
const ISSUE_URL = requireEnv("ISSUE_URL");
const ISSUE_TITLE = requireEnv("ISSUE_TITLE");
const ISSUE_BODY = process.env.ISSUE_BODY || "(no description provided)";
const ISSUE_AUTHOR = requireEnv("ISSUE_AUTHOR");
const ISSUE_LABELS = (process.env.ISSUE_LABELS || "").split(",").map((s) => s.trim()).filter(Boolean);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var ${name}`);
    process.exit(1);
  }
  return value;
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" }).trim();
}

// "neostryder/neo-angband-mod-borg" -> "mod-borg"
function productKeyFor(repoFullName) {
  const name = repoFullName.split("/")[1];
  const key = name.replace(/^neo-angband-/, "");
  return key || "neo-angband";
}

function main() {
  const productKey = productKeyFor(MOD_REPO);
  const category = ISSUE_LABELS.includes("enhancement") ? "enhancement" : "bug";

  const body = [
    ISSUE_BODY,
    "",
    "---",
    `Originally opened on ${MOD_REPO}#${ISSUE_NUMBER} by @${ISSUE_AUTHOR}: ${ISSUE_URL}`,
  ].join("\n");

  const newIssueUrl = gh([
    "issue", "create",
    "--repo", MAIN_REPO,
    "--title", ISSUE_TITLE,
    "--body", body,
    "--label", category,
    "--label", `repo:${productKey}`,
  ]).trim().split("\n").pop();

  gh([
    "issue", "comment", newIssueUrl,
    "--repo", MAIN_REPO,
    "--body", `Originally opened on [${MOD_REPO}#${ISSUE_NUMBER}](${ISSUE_URL}) by @${ISSUE_AUTHOR}.`,
  ]);

  gh([
    "issue", "comment", ISSUE_NUMBER,
    "--repo", MOD_REPO,
    "--body",
    `All neo-angband issues are tracked in one place, so this has been moved to ${newIssueUrl} - closing this copy so all discussion happens there. Thanks for the report!`,
  ]);

  gh(["issue", "close", ISSUE_NUMBER, "--repo", MOD_REPO, "--reason", "not planned"]);

  console.log(`Redirected ${MOD_REPO}#${ISSUE_NUMBER} -> ${newIssueUrl}`);
}

main();

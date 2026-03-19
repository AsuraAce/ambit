// validate-commit.js
// Scans staged files for debug artifacts and common issues before committing.
// Run via: node .agent/skills/git/scripts/validate-commit.js

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

let PASS = true;
const WARNINGS = [];
const ERRORS = [];

// Colours
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const NC = "\x1b[0m";

console.log("Running pre-commit validation...\n");

try {
  // 1. Get staged files
  const stagedFilesStr = execSync("git diff --staged --name-only", { encoding: "utf-8" }).trim();
  
  if (!stagedFilesStr) {
    console.log(`${YELLOW}No staged files found. Stage your changes first with git add.${NC}`);
    process.exit(1);
  }

  const stagedFiles = stagedFilesStr.split("\n").map(f => f.trim()).filter(Boolean);

  // 2. Debug artifact scan
  const DEBUG_PATTERNS = [
    /console\.log\(/,
    /console\.warn\(/,
    /console\.error\(/,
    /debugger;/,
    /TODO: remove/i,
    /FIXME: remove/i,
    /print\(/,
    /breakpoint\(\)/,
    /binding\.pry/
  ];

  const SCAN_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "py", "rs", "rb"]);

  for (const file of stagedFiles) {
    const ext = path.extname(file).slice(1);
    
    if (!SCAN_EXTENSIONS.has(ext)) continue;
    if (!fs.existsSync(file)) continue;

    try {
      // Get staged diff for the file (-U0 for 0 context lines)
      const diffStr = execSync(`git diff --staged -U0 "${file}"`, { encoding: "utf-8" });
      const addedLines = diffStr.split("\n")
        .filter(line => line.startsWith("+") && !line.startsWith("+++"))
        .map(line => line.slice(1));

      for (const line of addedLines) {
        for (const pattern of DEBUG_PATTERNS) {
          if (pattern.test(line)) {
            WARNINGS.push(`  ${file} — found: ${pattern}`);
            PASS = false;
          }
        }
      }
    } catch (e) {
      // Ignore git diff errors
    }
  }

  // 3. Branch check — warn if on main
  const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
  if (currentBranch === "main" || currentBranch === "master") {
    WARNINGS.push(`  Committing directly to ${currentBranch}. Consider a feature branch for larger changes.`);
  }

  // 4. Large commit warning
  if (stagedFiles.length > 10) {
    WARNINGS.push(`  ${stagedFiles.length} files staged — large commit. Consider splitting if changes are unrelated.`);
  }

  // 5. Output results
  if (WARNINGS.length > 0) {
    console.log(`${YELLOW}⚠ Warnings:${NC}`);
    for (const w of WARNINGS) {
      console.log(`${YELLOW}${w}${NC}`);
    }
    console.log("");
  }

  if (ERRORS.length > 0) {
    console.error(`${RED}✗ Errors (must fix before committing):${NC}`);
    for (const e of ERRORS) {
      console.error(`${RED}${e}${NC}`);
    }
    console.log("");
    process.exit(1);
  }

  if (PASS) {
    console.log(`${GREEN}✓ No debug artifacts found${NC}`);
  }

  // 6. Staged file summary
  console.log(`\nStaged files (${stagedFiles.length}):`);
  for (const file of stagedFiles) {
    console.log(`  ${file}`);
  }

  console.log("\nValidation complete. Proceed with commit message.");

} catch (err) {
  console.error(`${RED}Validation script failed: ${err.message}${NC}`);
  process.exit(1);
}

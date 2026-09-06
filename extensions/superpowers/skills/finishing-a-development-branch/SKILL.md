---
name: finishing-a-development-branch
description: Use when implementation is complete, all tests pass, and you need to decide how to integrate the work - guides completion of development work by presenting structured options for merge, PR, or cleanup
---

# Finishing a Development Branch

## Overview

Guide completion of development work by presenting clear options and handling chosen workflow.

**Core principle:** Verify tests → Detect environment → Present options → Execute choice → Clean up.

**Announce at start:** "I'm using the finishing-a-development-branch skill to complete this work."

## The Process

### Step 1: Verify Tests

**Before presenting options, verify tests pass:**

```bash
# Run project's test suite
npm test / cargo test / pytest / go test ./...
```

**If tests fail:**
```
Tests failing (<N> failures). Must fix before completing:

[Show failures]

Cannot proceed with merge/PR until tests pass.
```

Stop. Don't proceed to Step 2.

**If tests pass:** Continue to Step 2.

### Step 2: Detect Environment

**Determine workspace state before presenting options:**

```bash
FINISH_GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
FINISH_GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
FINISH_WORKTREE_PATH=$(git rev-parse --show-toplevel)
```

Capture these values once, before changing directories. Preserve them through Step 6.
Also record whether this session explicitly created the worktree; its directory name
alone does not establish ownership.

This determines which menu to show and how cleanup works:

| State | Menu | Cleanup |
|-------|------|---------|
| `FINISH_GIT_DIR == FINISH_GIT_COMMON` (normal repo) | Standard 4 options | No worktree to clean up |
| `FINISH_GIT_DIR != FINISH_GIT_COMMON`, named branch | Standard 4 options | Provenance-based (see Step 6) |
| `FINISH_GIT_DIR != FINISH_GIT_COMMON`, detached HEAD | Reduced 3 options (no merge) | No cleanup (externally managed) |

### Step 3: Determine Base Branch

Resolve the target branch and remote from the accepted project Git Flow or the
user request. `git merge-base` computes a revision; it does not identify the
authorized PR target. If the target is unknown, ask before mutation. Record the
feature branch and full HEAD. Preserve any unrelated dirty/staged changes.
Use `git worktree list --porcelain` to locate the existing target checkout; do not
assume the common Git directory lives immediately below the main working tree.

### Step 4: Present Options

**Normal repo and named-branch worktree — present exactly these 4 options:**

```
Implementation complete. What would you like to do?

1. Merge back to <base-branch> locally
2. Push and create a Pull Request
3. Keep the branch as-is (I'll handle it later)
4. Discard this work

Which option?
```

**Detached HEAD — present exactly these 3 options:**

```
Implementation complete. You're on a detached HEAD (externally managed workspace).

1. Push as new branch and create a Pull Request
2. Keep as-is (I'll handle it later)
3. Discard this work

Which option?
```

**Don't add explanation** - keep options concise.

### Step 5: Execute Choice

#### Option 1: Merge Locally

```bash
# Use the confirmed checkout path from git worktree list --porcelain
MAIN_ROOT=<confirmed-main-or-target-checkout>
cd "$MAIN_ROOT"

# Merge first — verify success before removing anything
git checkout <base-branch>
git pull --ff-only
git merge <feature-branch>

# Verify tests on merged result
<test command>

# Only after merge succeeds: cleanup worktree (Step 6), then delete branch
```

Then: Cleanup worktree (Step 6), then delete branch:

```bash
git branch -d <feature-branch>
```

#### Option 2: Push and Create PR

```bash
# Push branch
git push -u origin <feature-branch>
```

After a successful push, create or reuse the PR through the configured hosting
CLI/API with the confirmed base and head. Return its URL; a push alone does not
complete this action. If hosting access is unavailable, report the published branch
and the pending PR explicitly.

**Do NOT clean up worktree** — user needs it alive to iterate on PR feedback.

#### Option 3: Keep As-Is

Report: "Keeping branch <name>. Worktree preserved at <path>."

**Don't cleanup worktree.**

#### Option 4: Discard

**Confirm first:**
```
This will permanently delete:
- Branch <name>
- All commits: <commit-list>
- Worktree at <path>

Type 'discard' to confirm.
```

Wait for exact confirmation.

If confirmed:
```bash
MAIN_ROOT=<confirmed-main-or-target-checkout>
cd "$MAIN_ROOT"
```

Then: Cleanup worktree (Step 6), then force-delete branch:
```bash
git branch -D <feature-branch>
```

### Detached-HEAD actions

Dispatch by the displayed action name, not the standard option number. For
Push/PR, first create a user-approved branch at the captured HEAD and then follow
Push and Create PR above. Keep preserves HEAD. Discard requires a concrete list
of owned changes and explicit confirmation; for an externally managed detached
workspace, use its authorized platform cleanup flow. Do not guess a branch to
delete, reset the shared checkout or run named-branch Discard commands.

### Step 6: Cleanup Workspace

**Only runs for Merge or confirmed Discard in a named-branch workspace.** Push/PR
and Keep always preserve the worktree. All detached-HEAD choices preserve the
externally managed worktree; do not map their option numbers to this section.

Use the values captured in Step 2. Do not recompute them after `cd "$MAIN_ROOT"`:
that would classify the main checkout and lose the original worktree.

**If `FINISH_GIT_DIR == FINISH_GIT_COMMON`:** The original workspace was a normal
checkout; there is no linked worktree to remove. For Discard, first switch to the
confirmed base branch before deleting the feature branch; stop if checkout would
lose uncommitted changes.

**If this session explicitly created the linked worktree and the user selected
Merge or confirmed Discard:** remove the original captured path from the main checkout.
Do not infer ownership merely from a `.worktrees/` or `worktrees/` directory name.

```bash
cd "$MAIN_ROOT"
git worktree remove "$FINISH_WORKTREE_PATH"
```

Only after successful removal may the selected branch-deletion step run. If removal
fails, stop and report the reason; do not force removal or delete the branch.

**Otherwise:** preserve the externally managed workspace. Use a platform workspace-exit
tool only when authorized; do not delete a branch still checked out in a preserved
worktree. Report that the branch and worktree remain. Detached HEAD options follow
their displayed action names, not the numbering of the four-option menu.

## Quick Reference

| Option | Merge | Push | Keep Worktree | Cleanup Branch |
|--------|-------|------|---------------|----------------|
| 1. Merge locally | yes | - | - | yes |
| 2. Create PR | - | yes | yes | - |
| 3. Keep as-is | - | - | yes | - |
| 4. Discard | - | - | - | yes (force) |

## Common Mistakes

**Skipping test verification**
- **Problem:** Merge broken code, create failing PR
- **Fix:** Always verify tests before offering options

**Open-ended questions**
- **Problem:** "What should I do next?" is ambiguous
- **Fix:** Present exactly 4 structured options (or 3 for detached HEAD)

**Cleaning up worktree for Option 2**
- **Problem:** Remove worktree user needs for PR iteration
- **Fix:** Only clean up after Merge or confirmed Discard in an owned, named-branch worktree.

**Deleting branch before removing worktree**
- **Problem:** `git branch -d` fails because worktree still references the branch
- **Fix:** Merge first, remove worktree, then delete branch

**Running git worktree remove from inside the worktree**
- **Problem:** Command fails silently when CWD is inside the worktree being removed
- **Fix:** Always `cd` to main repo root before `git worktree remove`

**Cleaning up harness-owned worktrees**
- **Problem:** Removing a worktree the harness created causes phantom state
- **Fix:** Use recorded creation provenance; directory names do not establish ownership.

**No confirmation for discard**
- **Problem:** Accidentally delete work
- **Fix:** Require typed "discard" confirmation

## Red Flags

**Never:**
- Proceed with failing tests
- Merge without verifying tests on result
- Delete work without confirmation
- Force-push without explicit request
- Remove a worktree before confirming merge success
- Clean up worktrees you didn't create (provenance check)
- Run `git worktree remove` from inside the worktree

**Always:**
- Verify tests before offering options
- Detect environment before presenting menu
- Present exactly 4 options (or 3 for detached HEAD)
- Get typed confirmation for Discard, including the detached-HEAD menu
- Clean up only an owned, named-branch worktree after Merge or confirmed Discard
- `cd` to main repo root before worktree removal
- Preserve captured workspace identity until cleanup completes

# Project Git identity hook

After cloning, run this from the repository root:

```sh
git config --local core.hooksPath .githooks
git config --local user.name "Galactic Hamster"
git config --local user.email "gh@galactichamster.com"
```

Verify installation with `git config --local --get core.hooksPath`, which must
print `.githooks`. Committing these files does not configure another checkout;
repeat the installation command after a fresh clone or if hooksPath changes.
Check for existing custom hooks before changing an already configured hooksPath.

The pre-commit hook uses `git var GIT_AUTHOR_IDENT` and
`git var GIT_COMMITTER_IDENT`. It requires both effective identities to be
`Galactic Hamster <gh@galactichamster.com>`, including environment and `--author`
overrides. It reports each incorrect role, exits nonzero, and changes no files or
configuration. Correct the configuration and clear conflicting author/committer
environment overrides before retrying.

Git for Windows supplies the POSIX shell used by the hook; no hook framework,
network access or additional runtime is required. The script is committed as
executable and its scoped attributes rule preserves LF endings on Windows.

Run `node tests/git-identity-hooks.mjs` for isolated identity checks. The test uses
per-command Git configuration and child-process environment overrides, never
changes repository identity settings or creates commits. Newer Git uses
`git hook run`; older Git uses its shell-alias transport to invoke the same hook.
Set `GIT_BIN` to test a particular Git executable. Node is needed only for tests.

No pre-push hook scans old commits: protected published history and legitimate
historical authors are outside this commit-time safeguard. This is an accidental
identity guard, not an enforced security boundary. `--no-verify`, another
hooksPath, or plumbing such as `commit-tree` can bypass local hooks. It does not
replace independent pre-release history verification.

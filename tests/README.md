# Tests

This folder holds browser-flow definitions and verification scenarios.

Each `*.json` file can define:

- `goal`: optional run goal override
- `browserActions`: required ordered browser flow
- `regressionChecks`: required semantic checks to run after the primary flow

Example:

```json
{
  "goal": "Open the account menu and verify the profile page loads",
  "browserActions": [
    { "kind": "goto", "target": "/" },
    { "kind": "click", "target": "role:button:Account" },
    { "kind": "click", "target": "text:Profile" },
    { "kind": "wait_for_url", "target": "profile" }
  ],
  "regressionChecks": [
    { "path": "/", "expectText": "Account" },
    { "path": "/profile", "expectText": "Profile" }
  ]
}
```

When you launch `reform` from a project directory, the CLI will:

- load the first `tests/*.json` definition by default
- use `--test <id>` to select a specific file by name without the `.json` suffix

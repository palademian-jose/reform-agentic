# Tests

This folder holds browser-flow definitions and verification scenarios.

Each `*.json` file can define:

- `goal`: optional run goal override
- `browserActions`: required ordered browser flow
- `regressionChecks`: required semantic checks to run after the primary flow

Example:

```json
{
  "goal": "Log in and reach dashboard",
  "browserActions": [
    { "kind": "goto", "target": "/" },
    { "kind": "fill", "target": "label:Email", "value": "user@example.com" },
    { "kind": "click", "target": "role:button:Log In" },
    { "kind": "wait_for_url", "target": "dashboard" }
  ],
  "regressionChecks": [
    { "path": "/", "expectText": "Log in" },
    { "path": "/dashboard", "expectText": "Welcome" }
  ]
}
```

When you launch `reform` from a project directory, the CLI will:

- load the first `tests/*.json` definition by default
- use `--test <id>` to select a specific file by name without the `.json` suffix

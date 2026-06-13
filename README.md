# AI Switch

Sync AI coding tool configuration snapshots into your vault. This plugin starts as a simple config snapshot syncer and will grow into a helper for programming beginners to quickly switch and configure AI models.

## Features

- Copies local AI tool configs into Markdown snapshots such as `Config Manager/zhang_aifende_macbook-air/codex/config.toml.md`.
- Automatically groups snapshots by machine and tool folder.
- Syncs when the plugin loads, when settings change, or when the ribbon button is clicked.
- Provides a small sidebar for syncing snapshots and applying a note snapshot back to local config.
- Read-only for system config directories; it only reads local files and writes snapshots into the vault.

## Usage

1. Enable the plugin.
2. Keep `Codex`, `Claude` and `OpenCode` checked if you want to sync them.
3. Change a tool path only when your config is stored somewhere else.
4. Click the ribbon button to open the `AI Switch` sidebar.
5. Use `Sync to note` to refresh snapshots, or `Apply to local` to write a snapshot back to the local config file.
6. Open files directly in Obsidian's file explorer:

```text
Config Manager/
└── zhang_aifende_macbook-air/
    ├── codex/
    │   └── config.toml.md
    ├── claude/
    │   └── settings.json.md
    └── opencode/
        └── opencode.json.md
```

Default tool paths:

```text
~/.codex/config.toml
~/.claude/settings.json
~/.config/opencode
```

Folder sources import `.toml`, `.json`, `.yaml` and `.yml` files recursively. Missing paths are skipped automatically.

When applying a snapshot to local config, AI Switch asks for confirmation and creates a timestamped backup next to the original file before overwriting it.

## Roadmap

- Show model/provider presets for common AI coding tools.
- Help beginners switch model configs safely.
- Add controlled config apply/write-back flows after snapshot viewing is stable.

## Settings

- `Config root folder`: Vault-relative folder for snapshots. Default: `Config Manager`.
- `Codex`: Sync `~/.codex/config.toml` by default.
- `Claude`: Sync `~/.claude/settings.json` by default.
- `OpenCode`: Sync `~/.config/opencode` by default.

## Development

```bash
npm install
npm run build
```

## License

MIT

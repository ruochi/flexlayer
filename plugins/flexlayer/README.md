# Flex Layer skill

给别的项目里的 agent 用的安装包。正文在 `skills/flexlayer/SKILL.md`。仓库根的 `skills/flexlayer/SKILL.md` 是同一份，给只扫描 `skills/` 的目录用，两处要一起改。在本仓库里写画面仍看根目录的 `AGENTS.md`。

公开仓库的 `main` 包含这些文件之后，各家才能安装。

```bash
npx skills add ruochi/flexlayer
```

Claude Code：

```text
/plugin marketplace add ruochi/flexlayer
/plugin install flexlayer@flexlayer
```

Codex：

```bash
codex plugin marketplace add ruochi/flexlayer
```

Cursor：在 Customize 里用 GitHub 仓库导入 `ruochi/flexlayer`。公开市场要再提交 https://cursor.com/marketplace/publish ，上架前由 Cursor 人工审核。

本机直接拷贝时，把 `skills/flexlayer/` 放到 `~/.agents/skills/flexlayer/`。Cursor 也认 `~/.cursor/skills/`，Claude Code 认 `~/.claude/skills/`，Codex 认 `~/.codex/skills/`。

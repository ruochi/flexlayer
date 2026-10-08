# Flex Layer skill

给别的项目里的 agent 用的安装包。正文在 `skills/flexlayer/SKILL.md`。同一份还在仓库根的 `skills/flexlayer/SKILL.md` 和 `.dsh/skills/flexlayer/SKILL.md`，三处要一起改。在本仓库里写画面仍看根目录的 `AGENTS.md`。

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

Qoder、通义灵码：

```bash
qodercn plugins marketplace add ruochi/flexlayer
qodercn plugins install flexlayer
```

CodeBuddy：

```text
/plugin marketplace add ruochi/flexlayer
/plugin install flexlayer@flexlayer
```

WorkBuddy 要直接加自己的清单，加仓库根会先读到 CodeBuddy 的那份：

```text
/plugin marketplace add https://raw.githubusercontent.com/ruochi/flexlayer/main/.workbuddy-plugin/marketplace.json --name flexlayer
/plugin install flexlayer@flexlayer
```

TRAE 用仓库根的 `.trae-plugin/plugin.json`。国内版也可以：

```bash
npx skills add ruochi/flexlayer -a trae -a trae-cn
```

DeepSeek Harness 认 `.dsh/skills/flexlayer/SKILL.md`。装到本机时把这个目录拷到 `~/.dsh/skills/flexlayer/`。

通义灵码、Qwen、Kimi、MiniMax、心流、智谱 ZCode、华为 CodeArts 用同一条安装，写到各自的技能目录：

```bash
npx skills add ruochi/flexlayer -a lingma -a qwen-code -a kimi-code-cli -a minimax-code -a iflow-cli -a zcode -a codearts-agent -a codebuddy
```

文心快码没有公开的仓库清单。把 `skills/flexlayer/` 拷到 `~/.comate/skills/flexlayer/`，或在技能广场里安装。

本机直接拷贝时，把 `skills/flexlayer/` 放到 `~/.agents/skills/flexlayer/`。Cursor 也认 `~/.cursor/skills/`，Claude Code 认 `~/.claude/skills/`，Codex 认 `~/.codex/skills/`，通义灵码认 `~/.lingma/skills/`，Qoder 认 `~/.qoder/skills/`。

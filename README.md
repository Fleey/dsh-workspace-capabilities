# dsh-workspace-capabilities

按工作区选择可用的技能（skill）、MCP 服务器和工具的 DeepSeek Harness 插件。

在侧栏工作区行的「…」菜单里多一项 **技能、MCP 与工具**，点击后弹出窗口，勾选该工作区要用的技能、MCP 服务器和工具。取消勾选的项目不会提供给该工作区的会话，从下一轮对话起生效，无需重启。

## 插件界面

<img width="858" height="398" alt="image" src="https://github.com/user-attachments/assets/b0789b15-1544-4557-a326-6c299ba86742" />

支持在工作区里面设置skill与mcp，可以有效的规避工具上下文占用或其他特需需求场景

<img width="1698" height="1754" alt="image" src="https://github.com/user-attachments/assets/f76b47ef-6ad0-48df-a8a2-6dfaee635c5f" />


## 行为

- **技能**：取消勾选的技能从会话的技能目录中消失，`skill` 工具和 `/技能名` 都无法再加载它。
- **MCP**：取消勾选的服务器，其全部 `mcp__<服务器>__*` 工具对该工作区的会话（含子代理）隐藏；服务器本身保持连接，其他工作区不受影响。
- **工具**：取消勾选的工具从该工作区会话的可用工具里消失。按名字精确屏蔽，同族的其他工具（例如同属 `schedule_*` 的其余几个）不受影响。列表只列该工作区会话**当前可见**的工具，外加已经屏蔽的（以便随时取消勾选）；宿主因其他原因遮罩的工具不会出现在列表里。
- 默认全部启用。保存的是「禁用列表」，所以之后新装的技能、新加的 MCP 服务器和工具默认可用。
- 选择按工作区路径保存在 `$DSH_HOME/workspace-capabilities.json`（默认 `~/.dsh/workspace-capabilities.json`）：

```json
{
  "version": 1,
  "workspaces": {
    "/path/to/project": {
      "disabledSkills": ["some-skill"],
      "disabledMcpServers": ["github"],
      "disabledTools": ["workflow", "schedule_create"]
    }
  }
}
```

## 安装

先退出桌面版 DSH NEXT，然后：

```bash
ELECTRON_RUN_AS_NODE=1 DSH_HOME="$HOME/.dsh" "/Applications/DSH NEXT.app/Contents/MacOS/DSH NEXT" --expose-internals "/Applications/DSH NEXT.app/Contents/Resources/app.asar/lib/plugin-cli.js" desktop add github:Fleey/dsh-workspace-capabilities
```

重新打开 DSH NEXT 即可。卸载把 `add github:...` 换成 `remove dsh-workspace-capabilities`。本地开发可改用 `add link:/path/to/clone`。

命令行版（Web profile）：

```bash
dsh plugin --profile web add github:Fleey/dsh-workspace-capabilities
```

## 实现说明

- DSH 0.2.2 起工作区「…」菜单由 `ctx.contextMenus` 组成，浏览器端注册一条 `target: "workspace"` 的菜单项（`order: 250`，位于「在访达中显示」与「删除」之间）。更早的版本菜单写死为两项（重命名 / 删除），没有扩展点，此时回退为 DOM 注入：菜单弹出时复制「重命名」一行并插入；`contextMenus` 服务一出现，DOM 回退即停用（`lib/client.js`）。
- 技能注册表没有过滤钩子，Host 端包装了注册表的 `collectFresh`，按查询的 `cwd` 去掉禁用的技能；注册表缓存本来就按 `cwd` 区分（`lib/index.js`）。
- MCP 与普通工具都通过 `agent.ctx.tools.restrict({ deny })` 对每个会话屏蔽，工具集合或选择变化时自动重算。传给它的名单只从 `restrictableNames` 里取：`restrict()` 一旦遇到一个未知名字就**整体拒绝**，而调用方只记一条告警 —— 不过滤的话，一个过期的名字会让整份名单静默失效。
- 接口：`GET /dsh-workspace-capabilities/state?workspaceId=`、`POST /dsh-workspace-capabilities/save`，走 Host 自己的请求鉴权。

## 限制

- 技能过滤依赖 DSH 0.2 内部结构（技能注册表 `collectFresh`），DSH 0.2.1 及更早版本的菜单项还依赖侧栏菜单 DOM。DSH 升级后若这些变化，菜单项可能不出现或技能过滤失效（会在日志中警告）；DSH 0.2.2+ 的菜单项和 MCP 过滤走的是公开 API。
- 被禁用的 MCP 服务器若返回了服务器指令（instructions），该文本仍会出现在系统提示词中；只是工具不可用。
- 列表中的技能按当前工作区路径发现；只在其他 agent preset 中挂载的技能可能不显示。
- 工具列表只包含**全局注册**的工具。在 agent 自身作用域里注册的工具宿主不允许屏蔽，因此不会出现在列表里；子代理专属工具同理。
- 工具列表取自「当前会话可见」的集合。若某个工具已被宿主或其他插件遮罩（例如 web 增强插件替换掉原生 `web_search`），它不会出现在列表里 —— 它本来也不占用上下文。本工作区自己屏蔽掉的那些仍会列出，以便随时取消。
- 本插件只能**隐藏**技能，不能启用在来源处被停用的技能。例如在 dsh-skills-manager 中停用的技能仍会出现在列表里，但会标为「来源已停用」且无法勾选；需先在技能管理器中重新启用。

## 测试

```bash
npm test
```

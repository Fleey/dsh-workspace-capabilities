# dsh-workspace-capabilities

按工作区选择可用的技能（skill）和 MCP 服务器的 DeepSeek Harness 插件。

在侧栏工作区行的「…」菜单里多一项 **技能与 MCP**，点击后弹出窗口，勾选该工作区要用的技能和 MCP 服务器。取消勾选的项目不会提供给该工作区的会话，从下一轮对话起生效，无需重启。

## 行为

- **技能**：取消勾选的技能从会话的技能目录中消失，`skill` 工具和 `/技能名` 都无法再加载它。
- **MCP**：取消勾选的服务器，其全部 `mcp__<服务器>__*` 工具对该工作区的会话（含子代理）隐藏；服务器本身保持连接，其他工作区不受影响。
- 默认全部启用。保存的是「禁用列表」，所以之后新装的技能、新加的 MCP 服务器默认可用。
- 选择按工作区路径保存在 `$DSH_HOME/workspace-capabilities.json`（默认 `~/.dsh/workspace-capabilities.json`）：

```json
{
  "version": 1,
  "workspaces": {
    "/path/to/project": { "disabledSkills": ["some-skill"], "disabledMcpServers": ["github"] }
  }
}
```

## 安装

先退出桌面版 DSH NEXT，然后：

```bash
ELECTRON_RUN_AS_NODE=1 DSH_HOME="$HOME/.dsh" "/Applications/DSH NEXT.app/Contents/MacOS/DSH NEXT" --expose-internals "/Applications/DSH NEXT.app/Contents/Resources/app/lib/plugin-cli.js" desktop add github:Fleey/dsh-workspace-capabilities
```

重新打开 DSH NEXT 即可。卸载把 `add github:...` 换成 `remove dsh-workspace-capabilities`。本地开发可改用 `add link:/path/to/clone`。

命令行版（Web profile）：

```bash
dsh plugin --profile web add github:Fleey/dsh-workspace-capabilities
```

## 实现说明

- 工作区「…」菜单是写死的两项（重命名 / 删除），没有扩展 slot，所以浏览器端通过 DOM 注入：菜单弹出时复制「重命名」一行并插入，点击后关闭菜单并打开对话框（`lib/client.js`）。
- 技能注册表没有过滤钩子，Host 端包装了注册表的 `collectFresh`，按查询的 `cwd` 去掉禁用的技能；注册表缓存本来就按 `cwd` 区分（`lib/index.js`）。
- MCP 通过 `agent.ctx.tools.restrict({ deny })` 对每个会话屏蔽工具，工具集合或选择变化时自动重算。
- 接口：`GET /dsh-workspace-capabilities/state?workspaceId=`、`POST /dsh-workspace-capabilities/save`，走 Host 自己的请求鉴权。

## 限制

- 依赖 DSH 0.2 内部结构（侧栏菜单 DOM、技能注册表 `collectFresh`）。DSH 升级后若这些变化，菜单项可能不出现或技能过滤失效（会在日志中警告），MCP 过滤走的是公开 API。
- 被禁用的 MCP 服务器若返回了服务器指令（instructions），该文本仍会出现在系统提示词中；只是工具不可用。
- 列表中的技能按当前工作区路径发现；只在其他 agent preset 中挂载的技能可能不显示。

## 测试

```bash
npm test
```

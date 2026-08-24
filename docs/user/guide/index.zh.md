# 使用 Web 界面

[English](index.md) | 中文

请先按照[根目录 README](../../../README.zh.md#run) 中的说明启动 Web 界面；命令会打印其访问地址。本指南假设该服务器已经在运行。`dsh` 进程将启动时所在的目录用作默认文件系统位置；全新的 Web 界面在添加工作区之前不会选定任何工作区。

## 配置模型

打开 **设置 → 模型**，输入 [DeepSeek API 密钥](https://platform.deepseek.com/)并保存。模型路径将在无需重启服务器的情况下立即可用。

[模型配置指南](./providers.zh.md) 介绍其他模型提供方和自定义 OpenAI 兼容端点。

## 远程访问和工作区选择

### 选择工作区

点击 **选择工作区**，添加您启动 `dsh` 的项目目录，然后选择它。在选择工作区之前，会话输入区将保持不可用。

Web 服务器保持在 `127.0.0.1`，手机或其他远程浏览器需要经由完成访问身份验证的 HTTPS 入口访问。以下路径可避免把未认证的局域网或公网监听暴露给远程代码执行能力。

`--trusted-host` 只控制 `/api` 浏览器信任围栏，不负责用户身份验证。

身份验证仍由入口层负责：Tailscale Serve 依赖 tailnet 身份和 ACL，反向代理示例使用 HTTP Basic Authentication。dsh 不提供用户账户或登录层。

### 使用 Tailscale Serve

如果只需在 tailnet 内访问，可以让 dsh 保持回环绑定，由 Tailscale 提供带身份验证的 HTTPS。默认的自适应选择器在 dsh 绑定回环地址时仍可能选择操作系统原生对话框，因此将下面内容保存为 `remote-picker.cordis.yml`，固定使用应用内浏览器对话框：

```yaml
- id: directory-picker
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: ui-directory-picker-browse
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
```

在一个终端中，带上覆盖层，并使用手机实际访问的主机名启动 dsh：

```sh
pnpm dsh web --patch path/to/remote-picker.cordis.yml --host 127.0.0.1 --trusted-host <machine-name>.<tailnet>.ts.net --no-open
```

在另一个终端中，确认 tailnet 已启用 HTTPS 证书后启用 Tailscale Serve：

```sh
tailscale serve --bg http://127.0.0.1:3080
```

如果启动 dsh 时传入了 `--port`，Tailscale Serve 目标中的 `3080` 也要替换为该端口。

然后在手机打开 `https://<machine-name>.<tailnet>.ts.net`。`--trusted-host` 的值必须是该 URL 中的主机名；除非入口层另行提供身份验证，否则不要使用 Tailscale Funnel 或其他公网暴露路径。

### 使用 HTTPS 反向代理

让 dsh 保持绑定到 `127.0.0.1`，在反向代理处终止 TLS 并启用站点身份验证，同时保留外部 `Host` 请求头。运行 `caddy hash-password`，并在提示时输入密码；这样明文密码不会留在 shell 历史记录中。然后代理完整 Web 界面及其 `/api` WebSocket 升级请求：

```text
dsh.example.com {
    basic_auth {
        user <bcrypt-hash>
    }
    reverse_proxy 127.0.0.1:3080 {
        header_up Host {host}
    }
}
```

使用 `pnpm dsh web --patch path/to/remote-picker.cordis.yml --host 127.0.0.1 --trusted-host dsh.example.com --no-open` 启动 dsh，然后打开 `https://dsh.example.com`。反向代理必须转发 WebSocket 升级请求；不要为了让代理可达而把 dsh 绑定到 `0.0.0.0`。

## 运行任务

启动一个会话并发送：

> 总结此仓库并识别其主要包。

Agent（智能体）可以读取和编辑工作区文件、运行命令、委派工作并维护计划。如果根据当前权限策略，某项操作需要批准，Web UI 将先询问你。

## 继续

- [配置模型](./providers.zh.md)
- [使用 Python SDK](./python-sdk.zh.md)
- [使用其他 CLI 模式](../../../apps/cli/README.zh.md)
- [开发插件](../develop/basic/index.zh.md)

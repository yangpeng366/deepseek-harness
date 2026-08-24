# Use the Web UI

English | [中文](index.zh.md)

Start the Web UI through the [root README](../../../README.md#run); the command prints its URL. This guide begins after that server is running. The `dsh` process uses its invoking directory as the default filesystem location, but a fresh Web UI has no selected workspace until you add one.

## Configure a model

Open **Settings → Models**, enter a [DeepSeek API key](https://platform.deepseek.com/), and save it. The model route becomes usable immediately without restarting the server.

The [model configuration guide](./providers.md) covers other providers and custom OpenAI-compatible endpoints.

## Remote access and workspace selection

### Choose a workspace

Click **Choose workspace**, add the project directory where you started `dsh`, and select it. The session composer remains unavailable until a workspace is selected.

The Web server stays on `127.0.0.1`, so a phone or other remote browser reaches it through an HTTPS entry point that authenticates access. The paths below keep remote code execution off an unauthenticated LAN or public listener.

`--trusted-host` only controls the `/api` browser-trust fence; it does not authenticate users.

Authentication remains an ingress responsibility: Tailscale Serve relies on tailnet identity and ACLs, while the reverse-proxy example uses HTTP Basic Authentication. dsh does not provide user accounts or a login layer.

### Use Tailscale Serve

For a tailnet-only connection, keep dsh on loopback and let Tailscale provide authenticated HTTPS. The default adaptive picker can still choose the OS-native dialog when dsh is bound to loopback, so save the following as `remote-picker.cordis.yml` and pin the in-app browser dialog:

```yaml
- id: directory-picker
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: ui-directory-picker-browse
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
```

In one terminal, start dsh with the overlay and the hostname that the phone will use as its browser authority:

```sh
pnpm dsh web --patch path/to/remote-picker.cordis.yml --host 127.0.0.1 --trusted-host <machine-name>.<tailnet>.ts.net --no-open
```

In another terminal, enable Tailscale Serve after HTTPS certificates are enabled for the tailnet:

```sh
tailscale serve --bg http://127.0.0.1:3080
```

If you start dsh with `--port`, use that port instead of `3080` in the Tailscale Serve target.

Open `https://<machine-name>.<tailnet>.ts.net` on the phone. The `--trusted-host` value must be the host name in that URL; do not use Tailscale Funnel or another public exposure path unless the entry point adds authentication.

### Use an HTTPS reverse proxy

Keep dsh bound to `127.0.0.1`, terminate TLS at the proxy, authenticate the site, and preserve the external `Host` header. Run `caddy hash-password` and enter the password when prompted, so the plaintext password does not remain in shell history. Then proxy the complete UI and its `/api` WebSocket upgrades:

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

Start dsh with `pnpm dsh web --patch path/to/remote-picker.cordis.yml --host 127.0.0.1 --trusted-host dsh.example.com --no-open`, then open `https://dsh.example.com`. The proxy must forward WebSocket upgrades; do not bind dsh to `0.0.0.0` just to make the proxy reachable.

## Run a task

Start a session and send:

> Summarize this repository and identify its main packages.

The agent can read and edit workspace files, run commands, delegate work, and maintain a plan. The Web UI asks before operations that require approval under the active permission policy.

## Continue

- [Configure models](./providers.md)
- [Use the Python SDK](./python-sdk.md)
- [Use other CLI modes](../../../apps/cli/README.md)
- [Develop a plugin](../develop/basic/index.md)

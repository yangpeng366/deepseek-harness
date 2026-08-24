# Agent Note: Web UI remote ingress documentation

Status: implemented

English | [中文](2026-08-22-web-ui-remote-ingress-documentation.zh.md)

## Problem

The Web UI keeps its server on loopback, but users reaching it from a phone had no documented way to combine that binding with an authenticated HTTPS entry point. Without explicit instructions, the tempting fixes were to bind the server to every interface or expose it through an unauthenticated proxy, both of which place remote file access and command execution behind inadequate protection. Remote access also needs the in-app directory-picker dialog because the OS-native dialog can require interaction with the host desktop.

## Decision

The user guide documents Tailscale Serve and an authenticated HTTPS reverse proxy as the supported remote paths. Both explicitly start `dsh` on `127.0.0.1`, require the browser-facing hostname in `--trusted-host`, and leave authentication to the entry point. The Tailscale path stays tailnet-only; the reverse-proxy example enables basic authentication and forwards the external `Host` header and `/api` WebSocket upgrades. A reusable overlay disables the adaptive directory picker and selects the Host and UI browser-dialog providers, allowing workspace selection without access to the host desktop.

## Alternatives considered

**Bind the Web UI to `0.0.0.0`.** Rejected because a direct listener would expose the UI and its workspace tools without the required authenticated HTTPS layer.

**Use Tailscale Funnel as the public entry point.** Rejected because Funnel provides reachability rather than site authentication; an authenticated ingress remains responsible for public exposure.

**Require the OS-native directory-picker dialog.** Rejected because a phone session cannot reliably interact with a desktop-native dialog. The documented overlay explicitly selects browser dialogs while preserving the existing Host filesystem provider.

## Consequences

Phone users have two concrete paths that preserve loopback isolation and authenticated transport. Operators must provision HTTPS and authentication before using the reverse-proxy path, and must preserve WebSocket forwarding at either ingress. The guide keeps remote exposure guidance beside first workspace selection, where a new user decides how the UI will be reached.

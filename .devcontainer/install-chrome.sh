#!/usr/bin/env bash
# Installs Google Chrome (stable) so the chrome-devtools MCP can drive a real
# browser out of the box. The .deb lands the binary at /opt/google/chrome/chrome
# — the exact path the MCP probes for the "stable" channel — so no symlink or
# MCP config is needed. Idempotent; run as root (postCreateCommand uses sudo).
set -euo pipefail

if [ -x /opt/google/chrome/chrome ]; then
	echo "Chrome already present at /opt/google/chrome/chrome — skipping."
	exit 0
fi

# Chrome for Linux ships amd64 only; skip (don't fail the build) elsewhere so
# arm64 hosts like Apple Silicon still get a working container, just no Chrome.
arch="$(dpkg --print-architecture)"
if [ "$arch" != "amd64" ]; then
	echo "Google Chrome for Linux is amd64-only; detected '$arch' — skipping." >&2
	echo "The chrome-devtools MCP will have no browser on this architecture." >&2
	exit 0
fi

deb="$(mktemp --suffix=.deb)"
curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o "$deb"
apt-get update
apt-get install -y "$deb"
rm -f "$deb"
echo "Chrome installed at /opt/google/chrome/chrome"

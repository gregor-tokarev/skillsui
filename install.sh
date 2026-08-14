#!/bin/sh
set -eu

repository="${SKILLSUI_REPOSITORY:-gregor-tokarev/skillsui}"
version="${SKILLSUI_VERSION:-latest}"
install_dir="${SKILLSUI_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
  Darwin) platform="darwin" ;;
  Linux) platform="linux" ;;
  *) echo "skillsui does not support $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  arm64|aarch64) architecture="arm64" ;;
  x86_64|amd64) architecture="x64" ;;
  *) echo "skillsui does not support $(uname -m)" >&2; exit 1 ;;
esac

asset="skillsui-${platform}-${architecture}"
if [ "$version" = "latest" ]; then
  base_url="https://github.com/${repository}/releases/latest/download"
else
  base_url="https://github.com/${repository}/releases/download/${version}"
fi

temporary_dir="$(mktemp -d)"
trap 'rm -rf "$temporary_dir"' EXIT HUP INT TERM

curl -fL --retry 3 -o "$temporary_dir/$asset" "$base_url/$asset"
curl -fL --retry 3 -o "$temporary_dir/$asset.sha256" "$base_url/$asset.sha256"

expected="$(awk '{print $1}' "$temporary_dir/$asset.sha256")"
if command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$temporary_dir/$asset" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$temporary_dir/$asset" | awk '{print $1}')"
else
  echo "Install shasum or sha256sum to verify the download" >&2
  exit 1
fi

if [ "$expected" != "$actual" ]; then
  echo "Checksum mismatch for $asset" >&2
  exit 1
fi

mkdir -p "$install_dir"
chmod 755 "$temporary_dir/$asset"
mv "$temporary_dir/$asset" "$install_dir/skillsui"
echo "Installed skillsui to $install_dir/skillsui"

#!/usr/bin/env bash

set -euo pipefail

usage() {
    cat <<'EOF'
Usage: install.sh [--prefix DIR] [--uninstall]

Install Clash Party from the extracted archive. The default prefix is
$HOME/.local. Use --prefix /usr/local for a system-wide installation.
EOF
}

prefix="${HOME}/.local"
uninstall=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --prefix)
            [[ $# -ge 2 ]] || { echo "--prefix requires a directory" >&2; exit 2; }
            prefix="$2"
            shift 2
            ;;
        --uninstall)
            uninstall=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

prefix="${prefix%/}"
[[ -n "$prefix" ]] || { echo "Prefix must not be empty" >&2; exit 2; }

app_dir="$prefix/share/mihomo-party"
bin_dir="$prefix/bin"
desktop_file="$prefix/share/applications/mihomo-party.desktop"
icon_file="$prefix/share/icons/hicolor/512x512/apps/mihomo-party.png"

if [[ "$uninstall" == true ]]; then
    rm -f "$bin_dir/mihomo-party" "$desktop_file" "$icon_file"
    rm -rf "$app_dir"
    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$prefix/share/applications" >/dev/null 2>&1 || true
    fi
    echo "Clash Party was removed from $prefix"
    exit 0
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/mihomo-party-install.XXXXXX")"
trap 'rm -rf "$staging_dir"' EXIT

mkdir -p "$staging_dir" "$bin_dir" "$(dirname "$desktop_file")" "$(dirname "$icon_file")"
cp -a "$script_dir"/. "$staging_dir"/
rm -rf "$app_dir"
mkdir -p "$(dirname "$app_dir")"
mv "$staging_dir" "$app_dir"
trap - EXIT

ln -sfn "$app_dir/mihomo-party" "$bin_dir/mihomo-party"
install -m 644 "$app_dir/icon.png" "$icon_file"
install -m 644 /dev/stdin "$desktop_file" <<EOF
[Desktop Entry]
Name=Clash Party
GenericName=Proxy Client
Comment=A GUI client based on Mihomo
Exec=$bin_dir/mihomo-party %U
TryExec=$bin_dir/mihomo-party
Terminal=false
Type=Application
Icon=mihomo-party
MimeType=x-scheme-handler/clash;x-scheme-handler/mihomo;
Categories=Utility;Network;
StartupWMClass=mihomo-party
EOF

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$prefix/share/applications" >/dev/null 2>&1 || true
fi

echo "Clash Party was installed to $app_dir"
echo "Run $bin_dir/mihomo-party to start it."

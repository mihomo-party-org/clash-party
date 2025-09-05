#!/usr/bin/bash

XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-~/.config}

# Allow users to override command-line options
if [[ -f "${XDG_CONFIG_HOME}/mihomo-party-flags.conf" ]]; then
	mapfile -t MIHOMO_PARTY_USER_FLAGS <<<"$(grep -v '^#' "${XDG_CONFIG_HOME}/mihomo-party-flags.conf")"
	echo "User flags:" ${MIHOMO_PARTY_USER_FLAGS[@]}
fi

# Launch
exec /opt/clash-party/mihomo-party ${MIHOMO_PARTY_USER_FLAGS[@]} "$@"

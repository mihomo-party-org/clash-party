export function isWaylandSession(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    platform === 'linux' &&
    (env.XDG_SESSION_TYPE?.toLowerCase() === 'wayland' || Boolean(env.WAYLAND_DISPLAY))
  )
}

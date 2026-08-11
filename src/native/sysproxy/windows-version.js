function usesLegacyWindowsBinding(release) {
  const [major, minor] = release.split('.').map(Number)

  // Windows 7, 8, and 8.1 report NT 6.1, 6.2, and 6.3 respectively.
  return major === 6 && minor >= 1 && minor <= 3
}

module.exports = { usesLegacyWindowsBinding }

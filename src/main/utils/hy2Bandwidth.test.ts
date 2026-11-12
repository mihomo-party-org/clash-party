import type { NetworkInterfaceInfo } from 'os'
import { describe, expect, it } from 'vitest'
import {
  parseBandwidthMbps,
  calculateSustainedPeakMbps,
  computeRecommendedBandwidth,
  isFakeOrTunIp,
  pickDirectIPv4Interface,
  inspectHy2InYaml,
  patchHy2BandwidthInYaml
} from './hy2Bandwidth'

describe('hy2Bandwidth utils', () => {
  describe('parseBandwidthMbps', () => {
    it('parses valid numeric inputs', () => {
      expect(parseBandwidthMbps(100)).toBe(100)
      expect(parseBandwidthMbps(30.6)).toBe(31)
    })

    it('parses formatted bandwidth strings', () => {
      expect(parseBandwidthMbps('100 Mbps')).toBe(100)
      expect(parseBandwidthMbps('50mbps')).toBe(50)
      expect(parseBandwidthMbps('200M')).toBe(200)
      expect(parseBandwidthMbps('1 Gbps')).toBe(1000)
      expect(parseBandwidthMbps('50000 kbps')).toBe(50)
      expect(parseBandwidthMbps(' 300 ')).toBe(300)
    })

    it('returns null for empty or invalid inputs', () => {
      expect(parseBandwidthMbps(null)).toBeNull()
      expect(parseBandwidthMbps(undefined)).toBeNull()
      expect(parseBandwidthMbps('')).toBeNull()
      expect(parseBandwidthMbps('invalid')).toBeNull()
      expect(parseBandwidthMbps(0)).toBeNull()
      expect(parseBandwidthMbps(-50)).toBeNull()
    })
  })

  describe('calculateSustainedPeakMbps', () => {
    it('returns 0 for empty or invalid rate arrays', () => {
      expect(calculateSustainedPeakMbps([])).toBe(0)
      expect(calculateSustainedPeakMbps([0, -5, NaN, Infinity])).toBe(0)
    })

    it('returns rounded single rate for single element array', () => {
      expect(calculateSustainedPeakMbps([100])).toBe(100)
      expect(calculateSustainedPeakMbps([42.4])).toBe(42)
    })

    it('preserves normal climbing peak when peak is not an outlier spike', () => {
      expect(calculateSustainedPeakMbps([100, 200, 250, 300])).toBe(300)
      expect(calculateSustainedPeakMbps([50, 70, 85, 90, 95, 100], 85)).toBe(98)
    })

    it('discards transient outlier spikes and caps against steady mean', () => {
      // Single spike in short sample array: 500 > 200 * 1.35 = 270 -> adopts 200
      expect(calculateSustainedPeakMbps([100, 150, 200, 500])).toBe(200)
      // Multi-window burst on a 200M line (steady mean 160 Mbps, burst windows 440~460 Mbps):
      // Upper-steady band + 1.25x steadyMean cap keeps result around 180~200 Mbps instead of 449 Mbps
      const bursty200M = [150, 155, 160, 165, 170, 175, 180, 185, 440, 450, 460]
      const peak200M = calculateSustainedPeakMbps(bursty200M, 160)
      expect(peak200M).toBeGreaterThanOrEqual(175)
      expect(peak200M).toBeLessThanOrEqual(200)
    })
  })

  describe('computeRecommendedBandwidth', () => {
    it('calculates 85% of sustained peak across standard and non-standard bandwidths without tier snapping', () => {
      const down100 = computeRecommendedBandwidth(100, 'down')
      expect(down100.matchedTierMbps).toBeNull()
      expect(down100.recommendedMbps).toBe(85)

      const down200 = computeRecommendedBandwidth(195, 'down')
      expect(down200.matchedTierMbps).toBeNull()
      expect(down200.recommendedMbps).toBe(166)

      const up20 = computeRecommendedBandwidth(18, 'up')
      expect(up20.matchedTierMbps).toBeNull()
      expect(up20.recommendedMbps).toBe(15)

      const nonStd = computeRecommendedBandwidth(70, 'down')
      expect(nonStd.matchedTierMbps).toBeNull()
      expect(nonStd.recommendedMbps).toBe(60)
    })

    it('handles zero or invalid peak rate gracefully', () => {
      expect(computeRecommendedBandwidth(0, 'down')).toEqual({
        recommendedMbps: 0,
        matchedTierMbps: null
      })
      expect(computeRecommendedBandwidth(-10, 'up')).toEqual({
        recommendedMbps: 0,
        matchedTierMbps: null
      })
    })
  })

  describe('isFakeOrTunIp', () => {
    it('identifies fake-ip and reserved ranges', () => {
      expect(isFakeOrTunIp('198.18.0.1')).toBe(true)
      expect(isFakeOrTunIp('198.19.100.5')).toBe(true)
      expect(isFakeOrTunIp('169.254.1.2')).toBe(true)
      expect(isFakeOrTunIp('127.0.0.1')).toBe(true)
      expect(isFakeOrTunIp('not-an-ip')).toBe(true)
    })

    it('identifies legitimate local IPv4 addresses', () => {
      expect(isFakeOrTunIp('192.168.1.100')).toBe(false)
      expect(isFakeOrTunIp('10.0.0.15')).toBe(false)
      expect(isFakeOrTunIp('172.16.5.20')).toBe(false)
    })
  })

  describe('pickDirectIPv4Interface', () => {
    it('filters virtual interfaces and chooses preferred physical interface', () => {
      const mockIfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = {
        'vEthernet (WSL)': [
          {
            address: '172.28.16.1',
            netmask: '255.255.240.0',
            family: 'IPv4',
            mac: '00:15:5d:00:00:00',
            internal: false,
            cidr: '172.28.16.1/20'
          }
        ],
        'Meta-Tun': [
          {
            address: '198.18.0.1',
            netmask: '255.254.0.0',
            family: 'IPv4',
            mac: '00:00:00:00:00:00',
            internal: false,
            cidr: '198.18.0.1/15'
          }
        ],
        'Wi-Fi': [
          {
            address: '192.168.31.50',
            netmask: '255.255.255.0',
            family: 'IPv4',
            mac: 'aa:bb:cc:dd:ee:ff',
            internal: false,
            cidr: '192.168.31.50/24'
          }
        ]
      }

      const picked = pickDirectIPv4Interface(mockIfaces)
      expect(picked).toEqual({
        name: 'Wi-Fi',
        address: '192.168.31.50'
      })
    })

    it('returns null if no physical interface exists', () => {
      const mockIfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = {
        lo: [
          {
            address: '127.0.0.1',
            netmask: '255.0.0.0',
            family: 'IPv4',
            mac: '00:00:00:00:00:00',
            internal: true,
            cidr: '127.0.0.1/8'
          }
        ]
      }
      expect(pickDirectIPv4Interface(mockIfaces)).toBeNull()
    })
  })

  describe('inspectHy2InYaml & patchHy2BandwidthInYaml', () => {
    const sampleYaml = `
port: 7890
proxies:
  - name: "SS-01"
    type: ss
    server: 1.1.1.1
    port: 8388
  - name: "HY2-Node-1"
    type: hysteria2
    server: 2.2.2.2
    port: 443
    up: 30 Mbps
    down: 100 Mbps
  - name: "HY2-Node-2"
    type: hy2
    server: 3.3.3.3
    port: 443
`

    it('inspects Hysteria 2 nodes in YAML configuration', () => {
      const inspection = inspectHy2InYaml(sampleYaml)
      expect(inspection.hasHy2).toBe(true)
      expect(inspection.hy2Count).toBe(2)
      expect(inspection.names).toEqual(['HY2-Node-1', 'HY2-Node-2'])
      expect(inspection.firstUpMbps).toBe(30)
      expect(inspection.firstDownMbps).toBe(100)
      expect(inspection.hasBandwidth).toBe(true)
    })

    it('returns hasHy2: false when no Hy2 nodes are present', () => {
      const nonHy2Yaml = `
proxies:
  - name: "SS-01"
    type: ss
    server: 1.1.1.1
    port: 8388
`
      const inspection = inspectHy2InYaml(nonHy2Yaml)
      expect(inspection.hasHy2).toBe(false)
      expect(inspection.hy2Count).toBe(0)
    })

    it('patches Hy2 bandwidth for BBR mode (deletes up/down fields)', () => {
      const patched = patchHy2BandwidthInYaml(sampleYaml, { mode: 'bbr' })
      const inspection = inspectHy2InYaml(patched)
      expect(inspection.hasHy2).toBe(true)
      expect(inspection.hy2Count).toBe(2)
      expect(inspection.firstUpMbps).toBeNull()
      expect(inspection.firstDownMbps).toBeNull()
      expect(inspection.hasBandwidth).toBe(false)
      expect(patched).toContain('SS-01')
      expect(patched).not.toContain('30 Mbps')
      expect(patched).not.toContain('100 Mbps')
    })

    it('patches Hy2 bandwidth for Brutal mode (sets up/down fields)', () => {
      const patched = patchHy2BandwidthInYaml(sampleYaml, {
        mode: 'brutal',
        upMbps: 50,
        downMbps: 500
      })
      const inspection = inspectHy2InYaml(patched)
      expect(inspection.hasHy2).toBe(true)
      expect(inspection.hy2Count).toBe(2)
      expect(inspection.firstUpMbps).toBe(50)
      expect(inspection.firstDownMbps).toBe(500)
      expect(patched).toContain('50 Mbps')
      expect(patched).toContain('500 Mbps')
      expect(patched).toContain('SS-01')
    })

    it('keeps YAML untouched when policy mode is keep', () => {
      const patched = patchHy2BandwidthInYaml(sampleYaml, { mode: 'keep' })
      expect(patched).toBe(sampleYaml)
    })
  })
})

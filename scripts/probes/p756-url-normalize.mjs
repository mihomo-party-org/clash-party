// #756: full-width IME punctuation in typed URLs must be normalized before parsing.
import { normalizeUrlInput } from '../../src/shared/urlInput.ts'
import { ok, section, finish, read } from './lib.mjs'

section('source')
const profile = read('src/main/config/profile.ts')
ok('756_normalize_util_wired', profile.includes("from '../../shared/urlInput'"))
ok(
  '756_createProfile_normalizes',
  profile.includes('url: normalizeUrlInput(item.url)') &&
    profile.indexOf('normalizeUrlInput(item.url)') < profile.indexOf('const newItem: IProfileItem')
)

section('behaviour')
const typed = 'https：//example．com／sub？token＝abc＃x'
const pasted = 'https://example.com/sub?token=abc#x'
const fixed = normalizeUrlInput(typed)
ok(
  '756_fullwidth_throws_before_fix',
  (() => {
    try {
      new URL(typed)
      return false
    } catch {
      return true
    }
  })(),
  'failure mode reproduced'
)
ok(
  '756_normalized_parses',
  (() => {
    try {
      new URL(fixed)
      return true
    } catch {
      return false
    }
  })(),
  `normalized=${fixed}`
)
ok('756_matches_pasted_semantics', fixed === pasted)
ok('756_trims_whitespace', normalizeUrlInput('  https://a.com/x  ') === 'https://a.com/x')
ok('756_plain_url_untouched', normalizeUrlInput(pasted) === pasted)
ok('756_ideographic_space', normalizeUrlInput('https://a.com\u3000') === 'https://a.com')

finish('p756-url-normalize')

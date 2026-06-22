import assert from 'node:assert/strict'
import path from 'node:path'
import {
  assertAllowedCoreName,
  assertSafeCssFilename,
  assertSafeFilename,
  assertSafeId,
  resolveInside
} from '../src/main/utils/security'

const root = path.join(process.cwd(), 'tmp-root')

assert.equal(resolveInside(root, 'profiles/a.yaml'), path.join(root, 'profiles', 'a.yaml'))
assert.throws(() => resolveInside(root, '../outside.yaml'), /escapes/)
assert.throws(() => resolveInside(root, path.resolve(root, '..', 'outside.yaml')), /escapes/)

assert.doesNotThrow(() => assertSafeId('smart-core-override'))
assert.throws(() => assertSafeId('../profile'), /Invalid/)

assert.doesNotThrow(() => assertSafeFilename('backup.zip'))
assert.throws(() => assertSafeFilename('../backup.zip'), /Invalid/)
assert.throws(() => assertSafeFilename('nested/backup.zip'), /Invalid/)

assert.doesNotThrow(() => assertSafeCssFilename('custom-theme.css'))
assert.throws(() => assertSafeCssFilename('custom-theme.js'), /extension/)

assert.doesNotThrow(() => assertAllowedCoreName('mihomo-specific'))
assert.throws(() => assertAllowedCoreName('../evil'), /Invalid/)

process.stdout.write('security helper tests passed\n')

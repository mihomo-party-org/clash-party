import assert from 'node:assert/strict'
import { finished } from 'node:stream/promises'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import iconv from 'iconv-lite'
import { createDecodedCappedLogWritableStream } from '../src/main/utils/logFile'

async function main(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'core-log-encoding-'))
  const logPath = path.join(tempDir, 'core.log')

  try {
    const expected = '中文日志 ready\n第二行'
    const encoded = iconv.encode(expected, 'gbk')
    const stream = createDecodedCappedLogWritableStream(logPath, 'gbk')
    const emitted: string[] = []

    stream.on('text', (text) => emitted.push(text))
    stream.write(encoded.subarray(0, 3))
    stream.end(encoded.subarray(3))
    await finished(stream)

    assert.equal(emitted.join(''), expected)
    assert.equal(await readFile(logPath, 'utf8'), expected)
    assert.deepEqual(await readFile(logPath), Buffer.from(expected, 'utf8'))

    process.stdout.write('core log encoding normalization ok\n')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

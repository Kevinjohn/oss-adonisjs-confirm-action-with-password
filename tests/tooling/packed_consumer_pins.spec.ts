/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Every version the lockfile resolves for `name`: the root importer's, else its package entries. */
function lockedVersions(lockfile: string, name: string) {
  const importer = /^importers:\n\n {2}\.:\n([\s\S]*?)\n\npackages:/m.exec(lockfile)?.[1] ?? ''
  const direct = new RegExp(
    `^ {6}'?${escape(name)}'?:\\n {8}specifier: .*\\n {8}version: (\\d+\\.\\d+\\.\\d+)`,
    'm'
  ).exec(importer)
  if (direct) return [direct[1]]
  const entries = lockfile.matchAll(
    new RegExp(`^ {2}'?${escape(name)}@(\\d+\\.\\d+\\.\\d+)'?:`, 'gm')
  )
  return [...new Set([...entries].map(([, version]) => version))]
}

test('packed-consumer host pins match the lockfile versions the source suite runs', async ({
  assert,
}) => {
  const script = await readFile('bin/test_packed_consumer.mjs', 'utf8')
  // The committed lockfile, not the working copy: the peer-compatibility jobs reinstall other peer
  // versions before running the suite, and the pins follow what the repository records.
  const lockfile = execFileSync('git', ['show', 'HEAD:pnpm-lock.yaml'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const block = /const hostDependencies = \{\n([\s\S]*?)\n\}/.exec(script)?.[1]
  assert.isString(block, 'hostDependencies block in bin/test_packed_consumer.mjs')
  const pins: Array<[string, string]> = []
  for (const line of block!.split('\n')) {
    // The Account Kit archive comes from package.json and the candidate from the packed file.
    if (line.includes('manifest.devDependencies') || line.trim().startsWith('[name]')) continue
    const pin = /^\s*'([^']+)': '(\d+\.\d+\.\d+)',$/.exec(line)
    assert.isNotNull(pin, `exact version pin expected: ${line.trim()}`)
    pins.push([pin![1], pin![2]])
  }
  assert.isAbove(pins.length, 0)
  for (const [name, version] of pins) {
    assert.deepEqual(lockedVersions(lockfile, name), [version], `${name} pin vs pnpm-lock.yaml`)
  }
})

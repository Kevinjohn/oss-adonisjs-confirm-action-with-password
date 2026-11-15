/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'

test('README installs the release archive for the current package version', async ({ assert }) => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'))
  const readme = await readFile('README.md', 'utf8')
  const archive = `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`
  const installs = [...readme.matchAll(/releases\/download\/(v[^/\s]+)\/(\S+\.tgz)/g)]

  assert.isAbove(installs.length, 0)
  for (const [, tag, file] of installs) {
    assert.equal(tag, `v${manifest.version}`)
    assert.equal(file, archive)
  }
})

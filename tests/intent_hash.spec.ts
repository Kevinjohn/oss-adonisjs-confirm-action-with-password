/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { test } from '@japa/runner'
import { bindRequest } from '../src/intent_hash.js'

const hashOf = (intent: unknown, action = 'a', scope = 's') =>
  bindRequest({ action, scope, intent }).intentHash

test.group('bindRequest', () => {
  test('key order does not matter; values, array order, action and scope do', ({ assert }) => {
    assert.equal(hashOf({ a: 1, b: [1, 2] }), hashOf({ b: [1, 2], a: 1 }))
    assert.notEqual(hashOf({ a: 1 }), hashOf({ a: '1' }))
    assert.notEqual(hashOf([1, 2]), hashOf([2, 1]))
    assert.notEqual(hashOf({}, 'a'), hashOf({}, 'b'))
    assert.notEqual(hashOf({}, 'a', 's'), hashOf({}, 'a', 't'))
    assert.equal(hashOf({ n: null, t: true }), hashOf(JSON.parse('{"t":true,"n":null}')))
  })

  test('arrays, objects with index keys, -0 and unsafe integers never collide', ({ assert }) => {
    assert.notEqual(hashOf([1, 2]), hashOf({ 0: 1, 1: 2 }))
    assert.notEqual(hashOf({ list: ['a'] }), hashOf({ list: { 0: 'a' } }))
    // Pinned choice: -0 === 0, so no action can act on the difference; same hash, same confirmation.
    assert.equal(hashOf({ n: -0 }), hashOf({ n: 0 }))
    for (const unsafe of [2 ** 53, -(2 ** 53), 2 ** 53 + 2, 1e21]) {
      assert.throws(() => hashOf({ n: unsafe }), /unsafe integer/)
    }
    assert.equal(hashOf({ n: 2 ** 53 - 1 }), hashOf({ n: Number.MAX_SAFE_INTEGER }))
    assert.notEqual(hashOf({ n: 0.1 }), hashOf({ n: 0.10000000000000002 }))
  })

  test('__proto__ is an ordinary own key', ({ assert }) => {
    const withProto = JSON.parse('{"__proto__":{"admin":true},"x":1}')
    assert.notEqual(hashOf(withProto), hashOf({ x: 1 }))
    assert.equal(hashOf(withProto), hashOf(JSON.parse('{"x":1,"__proto__":{"admin":true}}')))
    assert.equal(hashOf(Object.create(null)), hashOf({}))
  })

  test('refuses values JSON cannot round-trip', ({ assert }) => {
    for (const intent of [
      { at: new Date(0) },
      { n: Number.NaN },
      { n: Infinity },
      { f: () => 1 },
      { u: undefined },
      undefined,
      { big: 1n },
    ]) {
      assert.throws(() => hashOf(intent), /Invalid password confirmation request/)
    }
    let deep: unknown = 1
    for (let i = 0; i < 40; i++) deep = [deep]
    assert.throws(() => hashOf(deep), /nested too deeply/)
  })

  test('requires short non-empty action and scope strings', ({ assert }) => {
    assert.throws(() => hashOf({}, ''), /action must be/)
    assert.throws(() => hashOf({}, 'a', 'x'.repeat(256)), /scope must be/)
    assert.throws(() => bindRequest({ action: 1 as unknown as string, scope: 's', intent: {} }))
  })
})

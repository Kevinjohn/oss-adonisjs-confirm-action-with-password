import { cp } from 'node:fs/promises'

// tsdown and tsc emit code only; `node ace configure` reads the stubs next to build/configure.js.
await cp(new URL('../stubs/', import.meta.url), new URL('../build/stubs/', import.meta.url), {
  recursive: true,
})

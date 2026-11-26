import { assert } from '@japa/assert'
import { fileSystem } from '@japa/file-system'
import { expectTypeOf } from '@japa/expect-type'
import { processCLIArgs, configure, run } from '@japa/runner'

processCLIArgs(process.argv.slice(2))
configure({
  files: ['tests/**/*.spec.ts'],
  plugins: [assert(), expectTypeOf(), fileSystem()],
  timeout: 10_000,
  // Japa exits 0 when its filters select nothing; a gate that ran no tests checked nothing.
  teardown: [
    (runner) => {
      // Skipped and todo tests ran no body; count only the ones that did.
      const { passed, failed, regression } = runner.getSummary().aggregates
      if (passed + failed + regression > 0) return
      console.error('No tests executed: check the --files, --tests and --groups filters')
      process.exitCode = 1
    },
  ],
})

run()

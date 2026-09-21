/**
 * Starts the table server.
 *
 * Configuration comes from the environment (see `config.ts`) and everything
 * that must survive a restart lives under `DATA_DIR`.
 */

import { createServer } from './server.js'
import { ConfigError, readConfig } from './config.js'

async function main(): Promise<void> {
  let config
  try {
    config = readConfig()
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\nThe server cannot start: ${error.message}\n`)
      process.exitCode = 1
      return
    }
    throw error
  }

  const handle = await createServer(config)
  await handle.app.listen({ port: config.port, host: '0.0.0.0' })
  handle.app.log.info({ dataDir: config.dataDir }, 'table server ready')

  // Stop cleanly so in-flight table state is flushed rather than dropped.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      handle.app.log.info('shutting down')
      void handle.close().then(() => process.exit(0))
    })
  }
}

void main()

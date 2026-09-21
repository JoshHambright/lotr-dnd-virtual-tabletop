/**
 * Everything the server needs to know, read from the environment.
 *
 * A container has nothing else to read, and a server that silently starts with
 * a default secret is worse than one that refuses to start at all.
 */

import { resolve } from 'node:path'

export interface Config {
  port: number
  dataDir: string
  dbPath: string
  assetDir: string
  tableSecret: string
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  /** The built client to serve, or null to run as an API only. */
  clientDir: string | null
}

export class ConfigError extends Error {}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const secret = env.TABLE_SECRET?.trim()
  if (!secret) {
    throw new ConfigError(
      'TABLE_SECRET is not set. It signs GM keys, so a table opened without one would not stay the same table across a restart. Put a long random string in your .env.',
    )
  }
  if (secret.length < 16) {
    throw new ConfigError('TABLE_SECRET is too short to be worth having; use at least 16 characters.')
  }

  const dataDir = resolve(env.DATA_DIR?.trim() || './data')
  const port = Number(env.PORT ?? 8080)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`PORT must be a port number; got "${env.PORT}".`)
  }

  const level = (env.LOG_LEVEL?.trim() || 'info') as Config['logLevel']
  if (!['debug', 'info', 'warn', 'error'].includes(level)) {
    throw new ConfigError(`LOG_LEVEL must be debug, info, warn or error; got "${env.LOG_LEVEL}".`)
  }

  const clientDir = env.CLIENT_DIR?.trim()

  return {
    port,
    dataDir,
    clientDir: clientDir ? resolve(clientDir) : null,
    dbPath: resolve(dataDir, 'db', 'table.sqlite'),
    assetDir: resolve(dataDir, 'assets'),
    tableSecret: secret,
    logLevel: level,
  }
}

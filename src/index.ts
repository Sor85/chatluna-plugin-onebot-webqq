import type { Context } from 'cordis'
import type {} from '@satorijs/core'
import type {} from '@chatluna/ui-server'
import type { ChatCapsuleStorageRow } from './webqq/storage/schema'
import { Config } from './config/schema'
import { registerPluginRuntime } from './runtime'

export { Config }

export const name = 'chatluna-onebot-webqq'

export const inject = ['satori', 'server', 'chatluna_server', 'chatluna_webui']

declare module '@cordisjs/plugin-database' {
  interface Tables {
    onebot_webqq_storage: ChatCapsuleStorageRow
  }
}

export function apply(ctx: Context, config: Config) {
  registerPluginRuntime(ctx, config)
}

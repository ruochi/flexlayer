import { loadYoga, type Yoga as YogaApi } from 'yoga-layout/load'

let yogaApi: YogaApi | null = null
let ready: Promise<void> | null = null

export async function ensureYoga(): Promise<YogaApi> {
  if (!ready) {
    ready = loadYoga().then((api) => {
      yogaApi = api
    })
  }
  await ready
  if (!yogaApi) throw new Error('Yoga 未加载')
  return yogaApi
}

/** 同步取已加载的 Yoga。先调用 ensureYoga。 */
export function getYoga(): YogaApi {
  if (!yogaApi) throw new Error('Yoga 未加载，先调用 prepareAssets')
  return yogaApi
}

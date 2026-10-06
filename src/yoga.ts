import Yoga from 'yoga-layout'

export type YogaApi = typeof Yoga

/** 模块加载时就已经备好，整个进程共用这一份。 */
export function getYoga(): YogaApi {
  return Yoga
}

export async function ensureYoga(): Promise<YogaApi> {
  return getYoga()
}

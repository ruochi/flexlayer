/** Node 的 fetch 不读 HTTPS_PROXY，下载失败时只会报 fetch failed。 */
export function explainFetchFailure(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err)
  if (/fetch failed/i.test(message)) {
    return new Error('下载模型失败（fetch failed）。要走代理时设置 NODE_USE_ENV_PROXY=1 和 HTTPS_PROXY，需要 Node 22 以上；也可以先把模型放进 ~/.cache/flexlayer/models', { cause: err })
  }
  return err instanceof Error ? err : new Error(message)
}

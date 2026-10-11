/// <reference lib="webworker" />
/** 在后台线程里跑格式体检，大文件解析时页面不卡。论文数据只在这个浏览器里流转。 */

import { DocxError } from './docx'
import { checkDocx } from './engine'
import type { SchoolProfile } from './profile'

export type WorkerRequest = { data: Uint8Array; profile: SchoolProfile | null }
export type WorkerResponse =
  | { ok: true; report: ReturnType<typeof checkDocx> }
  | { ok: false; message: string; readable: boolean }

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  let res: WorkerResponse
  try {
    res = { ok: true, report: checkDocx(e.data.data, e.data.profile) }
  } catch (err) {
    res = { ok: false, message: (err as Error).message, readable: err instanceof DocxError }
  }
  ;(self as unknown as Worker).postMessage(res)
}

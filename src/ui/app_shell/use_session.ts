import { onBeforeUnmount, ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import type { ProjectSession, SaveStatus } from '../../application/project_session.ts'
import type { StorageFailure } from '../../application/project_storage.ts'
import type { WriterDocument } from '../../domain/document/document.ts'

export interface SessionState {
  readonly document: ShallowRef<WriterDocument>
  readonly status: Ref<SaveStatus>
  readonly lastError: ShallowRef<StorageFailure | null>
}

/** 把 ProjectSession 的状态桥接成 Vue 响应式数据；组件卸载时自动取消订阅。 */
export function useSession(session: ProjectSession): SessionState {
  const document = shallowRef(session.document)
  const status = ref<SaveStatus>(session.status)
  const lastError = shallowRef(session.lastError)

  const unsubscribe = session.subscribe(() => {
    document.value = session.document
    status.value = session.status
    lastError.value = session.lastError
  })
  onBeforeUnmount(unsubscribe)

  return { document, status, lastError }
}

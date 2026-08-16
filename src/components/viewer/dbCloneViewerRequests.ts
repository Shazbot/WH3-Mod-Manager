export interface DBCloneViewerRequest {
  packPath: string;
  tables: DBTable[];
}

type Listener = (request: DBCloneViewerRequest) => void;

const pendingRequests: DBCloneViewerRequest[] = [];
const listeners = new Set<Listener>();

/** Receives main-process requests even when the ModsViewer React tree has not mounted yet. */
export const enqueueDBCloneViewerRequest = (request: DBCloneViewerRequest) => {
  if (listeners.size === 0) {
    pendingRequests.push(request);
    return;
  }
  for (const listener of listeners) listener(request);
};

export const subscribeToDBCloneViewerRequests = (listener: Listener) => {
  listeners.add(listener);
  for (const request of pendingRequests.splice(0)) listener(request);
  return () => {
    listeners.delete(listener);
  };
};

import { RegionAreasGrid } from "./regionAreas";

export interface RegionPolygonArea {
  componentId: number;
  areaId: number;
  classKey: number;
  classKeyHex: string;
  pixelCount: number;
  loops: number[][];
}

export interface RegionPolygonsResult {
  width: number;
  height: number;
  componentIds: Uint32Array;
  componentCount: number;
  areas: RegionPolygonArea[];
  totalLoops: number;
  totalVertices: number;
}

interface BuildPolygonOptions {
  minLoopArea?: number;
  ignoreAreaId?: number;
}

interface TracedLoop {
  vertices: number[];
  signedArea: number;
}

const TURN_PRIORITY = [1, 0, 3, 2];

function encodeVertex(x: number, y: number, stride: number): number {
  return y * stride + x;
}

function decodeX(vertex: number, stride: number): number {
  return vertex % stride;
}

function decodeY(vertex: number, stride: number): number {
  return Math.floor(vertex / stride);
}

function edgeDirection(start: number, end: number, stride: number): number {
  const delta = end - start;
  if (delta === 1) {
    return 0;
  }
  if (delta === stride) {
    return 1;
  }
  if (delta === -1) {
    return 2;
  }
  if (delta === -stride) {
    return 3;
  }
  return -1;
}

function findUnusedOutgoing(
  outgoing: number[] | undefined,
  used: Uint8Array,
  edges: number[],
  currentDir: number,
  stride: number
): number {
  if (!outgoing || outgoing.length === 0) {
    return -1;
  }

  let bestEdge = -1;
  let bestRank = Number.POSITIVE_INFINITY;

  for (const edgeIndex of outgoing) {
    if (used[edgeIndex] !== 0) {
      continue;
    }

    if (currentDir < 0) {
      return edgeIndex;
    }

    const candidateDir = edgeDirection(edges[edgeIndex * 2], edges[edgeIndex * 2 + 1], stride);
    if (candidateDir < 0) {
      continue;
    }

    const turn = (candidateDir - currentDir + 4) % 4;
    const rank = TURN_PRIORITY.indexOf(turn);
    const orderedRank = rank >= 0 ? rank : TURN_PRIORITY.length;

    if (orderedRank < bestRank) {
      bestRank = orderedRank;
      bestEdge = edgeIndex;
    }
  }

  return bestEdge;
}

function isCollinear(prev: number, current: number, next: number, stride: number): boolean {
  const prevX = decodeX(prev, stride);
  const prevY = decodeY(prev, stride);
  const currentX = decodeX(current, stride);
  const currentY = decodeY(current, stride);
  const nextX = decodeX(next, stride);
  const nextY = decodeY(next, stride);

  return (prevX === currentX && currentX === nextX) || (prevY === currentY && currentY === nextY);
}

function simplifyLoop(vertices: number[], stride: number): number[] {
  if (vertices.length < 3) {
    return vertices;
  }

  let simplified = vertices.filter((value, index) => index === 0 || value !== vertices[index - 1]);
  let changed = true;

  while (changed && simplified.length >= 3) {
    changed = false;
    const nextVertices: number[] = [];
    const length = simplified.length;

    for (let index = 0; index < length; index += 1) {
      const prev = simplified[(index - 1 + length) % length];
      const current = simplified[index];
      const next = simplified[(index + 1) % length];

      if (isCollinear(prev, current, next, stride)) {
        changed = true;
        continue;
      }

      nextVertices.push(current);
    }

    simplified = nextVertices;
  }

  return simplified;
}

function computeSignedArea(vertices: number[], stride: number): number {
  let areaTwice = 0;
  const length = vertices.length;

  for (let index = 0; index < length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % length];

    const currentX = decodeX(current, stride);
    const currentY = decodeY(current, stride);
    const nextX = decodeX(next, stride);
    const nextY = decodeY(next, stride);

    areaTwice += currentX * nextY - nextX * currentY;
  }

  return areaTwice / 2;
}

function traceLoopsForArea(edges: number[], stride: number, minLoopArea: number): TracedLoop[] {
  const edgeCount = Math.floor(edges.length / 2);
  if (edgeCount === 0) {
    return [];
  }

  const outgoingByStart = new Map<number, number[]>();
  for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
    const start = edges[edgeIndex * 2];
    const outgoing = outgoingByStart.get(start);
    if (outgoing) {
      outgoing.push(edgeIndex);
    } else {
      outgoingByStart.set(start, [edgeIndex]);
    }
  }

  const loops: TracedLoop[] = [];
  const used = new Uint8Array(edgeCount);

  for (let seed = 0; seed < edgeCount; seed += 1) {
    if (used[seed] !== 0) {
      continue;
    }

    const firstStart = edges[seed * 2];
    const vertices: number[] = [];
    let current = seed;
    let currentDir = -1;
    let closed = false;

    for (let guard = 0; guard <= edgeCount + 2; guard += 1) {
      if (used[current] !== 0) {
        break;
      }

      used[current] = 1;
      const start = edges[current * 2];
      const end = edges[current * 2 + 1];
      vertices.push(start);
      currentDir = edgeDirection(start, end, stride);

      if (end === firstStart) {
        closed = true;
        break;
      }

      const nextEdge = findUnusedOutgoing(outgoingByStart.get(end), used, edges, currentDir, stride);
      if (nextEdge < 0) {
        break;
      }

      current = nextEdge;
    }

    if (!closed) {
      continue;
    }

    const simplified = simplifyLoop(vertices, stride);
    if (simplified.length < 3) {
      continue;
    }

    const signedArea = computeSignedArea(simplified, stride);
    if (Math.abs(signedArea) < minLoopArea) {
      continue;
    }

    loops.push({ vertices: simplified, signedArea });
  }

  return loops;
}

function flattenLoop(vertices: number[], stride: number): number[] {
  const flattened = new Array<number>(vertices.length * 2);
  let cursor = 0;

  for (const vertex of vertices) {
    flattened[cursor] = decodeX(vertex, stride);
    flattened[cursor + 1] = decodeY(vertex, stride);
    cursor += 2;
  }

  return flattened;
}

export function extractRegionPolygons(
  grid: Pick<
    RegionAreasGrid,
    "width" | "height" | "areaIds" | "uniqueAreas" | "areaClassKeys" | "areaClassCounts" | "areaClassHex"
  >,
  options?: BuildPolygonOptions
): RegionPolygonsResult {
  const width = grid.width;
  const height = grid.height;
  const stride = width + 1;
  const areaIds = grid.areaIds;
  const minLoopArea = options?.minLoopArea ?? 1;
  const ignoreAreaId = options?.ignoreAreaId;

  const visited = new Uint8Array(areaIds.length);
  const componentIds = new Uint32Array(areaIds.length);
  componentIds.fill(0xffffffff);

  const queue = new Int32Array(areaIds.length);
  const areas: RegionPolygonArea[] = [];
  let componentCount = 0;
  let totalLoops = 0;
  let totalVertices = 0;

  for (let seed = 0; seed < areaIds.length; seed += 1) {
    if (visited[seed] !== 0) {
      continue;
    }

    const areaId = areaIds[seed];
    if (ignoreAreaId !== undefined && areaId === ignoreAreaId) {
      visited[seed] = 1;
      continue;
    }
    const componentId = componentCount;
    componentCount += 1;

    const edges: number[] = [];
    let pixelCount = 0;

    visited[seed] = 1;
    let head = 0;
    let tail = 0;
    queue[tail] = seed;
    tail += 1;

    while (head < tail) {
      const index = queue[head];
      head += 1;

      componentIds[index] = componentId;
      pixelCount += 1;

      const x = index % width;
      const y = Math.floor(index / width);

      const leftSame = x > 0 && areaIds[index - 1] === areaId;
      const rightSame = x < width - 1 && areaIds[index + 1] === areaId;
      const topSame = y > 0 && areaIds[index - width] === areaId;
      const bottomSame = y < height - 1 && areaIds[index + width] === areaId;

      if (topSame) {
        const next = index - width;
        if (visited[next] === 0) {
          visited[next] = 1;
          queue[tail] = next;
          tail += 1;
        }
      } else {
        edges.push(encodeVertex(x, y, stride), encodeVertex(x + 1, y, stride));
      }

      if (rightSame) {
        const next = index + 1;
        if (visited[next] === 0) {
          visited[next] = 1;
          queue[tail] = next;
          tail += 1;
        }
      } else {
        edges.push(encodeVertex(x + 1, y, stride), encodeVertex(x + 1, y + 1, stride));
      }

      if (bottomSame) {
        const next = index + width;
        if (visited[next] === 0) {
          visited[next] = 1;
          queue[tail] = next;
          tail += 1;
        }
      } else {
        edges.push(encodeVertex(x + 1, y + 1, stride), encodeVertex(x, y + 1, stride));
      }

      if (leftSame) {
        const next = index - 1;
        if (visited[next] === 0) {
          visited[next] = 1;
          queue[tail] = next;
          tail += 1;
        }
      } else {
        edges.push(encodeVertex(x, y + 1, stride), encodeVertex(x, y, stride));
      }
    }

    const tracedLoops = traceLoopsForArea(edges, stride, minLoopArea).sort(
      (left, right) => Math.abs(right.signedArea) - Math.abs(left.signedArea)
    );

    if (tracedLoops.length === 0) {
      continue;
    }

    const loops = tracedLoops.map((loop) => {
      totalVertices += loop.vertices.length;
      return flattenLoop(loop.vertices, stride);
    });

    totalLoops += loops.length;

    const classKey = grid.areaClassKeys[areaId] ?? 0;
    const classHex = grid.areaClassHex[areaId];
    areas.push({
      componentId,
      areaId,
      classKey,
      classKeyHex: classHex ? `0x${classHex}` : `0x${classKey.toString(16).padStart(8, "0")}`,
      pixelCount,
      loops,
    });
  }

  areas.sort((left, right) => right.pixelCount - left.pixelCount);

  return {
    width,
    height,
    componentIds,
    componentCount,
    areas,
    totalLoops,
    totalVertices,
  };
}

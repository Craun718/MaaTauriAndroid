export type VirtualDisplayPoint = {
  x: number;
  y: number;
  inside: boolean;
};

export type VirtualDisplayLayout = {
  width: number;
  height: number;
};

export function virtualDisplayPoint(
  viewX: number,
  viewY: number,
  layout: VirtualDisplayLayout,
  display: VirtualDisplayLayout,
): VirtualDisplayPoint {
  if (
    layout.width <= 0 ||
    layout.height <= 0 ||
    display.width <= 0 ||
    display.height <= 0
  ) {
    return { x: 0, y: 0, inside: false };
  }

  const scale = Math.min(
    layout.width / display.width,
    layout.height / display.height,
  );
  const offsetX = (layout.width - display.width * scale) / 2;
  const offsetY = (layout.height - display.height * scale) / 2;
  const x = Math.trunc((viewX - offsetX) / scale);
  const y = Math.trunc((viewY - offsetY) / scale);
  return {
    x: Math.max(0, Math.min(display.width - 1, x)),
    y: Math.max(0, Math.min(display.height - 1, y)),
    inside: x >= 0 && x < display.width && y >= 0 && y < display.height,
  };
}

const FIRST_MANUAL_CONTACT = 15;

export class VirtualDisplayPointerSlots {
  private readonly contactsByPointerId = new Map<number, number>();
  private readonly lastPoints = new Map<number, { x: number; y: number }>();

  acquire(pointerId: number): number {
    const existing = this.contactsByPointerId.get(pointerId);
    if (existing !== undefined) return existing;

    const used = new Set(this.contactsByPointerId.values());
    for (let contact = FIRST_MANUAL_CONTACT; contact >= 0; contact -= 1) {
      if (!used.has(contact)) {
        this.contactsByPointerId.set(pointerId, contact);
        this.lastPoints.delete(pointerId);
        return contact;
      }
    }
    return -1;
  }

  contact(pointerId: number): number {
    return this.contactsByPointerId.get(pointerId) ?? -1;
  }

  release(pointerId: number): number {
    const contact = this.contact(pointerId);
    this.contactsByPointerId.delete(pointerId);
    this.lastPoints.delete(pointerId);
    return contact;
  }

  remember(pointerId: number, x: number, y: number): void {
    if (this.contactsByPointerId.has(pointerId)) {
      this.lastPoints.set(pointerId, { x, y });
    }
  }

  releaseHeld(sendUp: (contact: number, x: number, y: number) => void): void {
    for (const [pointerId, contact] of this.contactsByPointerId) {
      const point = this.lastPoints.get(pointerId) ?? { x: 0, y: 0 };
      sendUp(contact, point.x, point.y);
    }
    this.contactsByPointerId.clear();
    this.lastPoints.clear();
  }

  clear(): void {
    this.contactsByPointerId.clear();
    this.lastPoints.clear();
  }
}

export type VirtualDisplayMove = {
  contact: number;
  x: number;
  y: number;
};

export type VirtualDisplayTouchMarkerInput = {
  id: number;
  x: number;
  y: number;
  action: number;
  contact: number;
};

export type VirtualDisplayTouchMarker = VirtualDisplayTouchMarkerInput & {
  receivedAt: number;
};

export const VIRTUAL_DISPLAY_TOUCH_MARKER_TTL_MS = 600;
export const VIRTUAL_DISPLAY_TOUCH_MARKER_LIMIT = 16;

export class VirtualDisplayTouchMarkerTimeline {
  private markers: VirtualDisplayTouchMarker[] = [];

  append(markers: VirtualDisplayTouchMarkerInput[], receivedAt: number): void {
    const current = this.markers.filter(
      (marker) =>
        receivedAt - marker.receivedAt < VIRTUAL_DISPLAY_TOUCH_MARKER_TTL_MS,
    );
    const next = [
      ...current,
      ...markers.map((marker) => ({ ...marker, receivedAt })),
    ];
    next.sort((left, right) => left.id - right.id);
    this.markers = next.slice(-VIRTUAL_DISPLAY_TOUCH_MARKER_LIMIT);
  }

  active(now: number): VirtualDisplayTouchMarker[] {
    this.markers = this.markers.filter(
      (marker) => now - marker.receivedAt < VIRTUAL_DISPLAY_TOUCH_MARKER_TTL_MS,
    );
    return this.markers;
  }

  clear(): void {
    this.markers = [];
  }
}

export class VirtualDisplayMoveScheduler {
  private latest = new Map<number, VirtualDisplayMove>();
  private scheduled = false;

  constructor(
    private readonly callback: (moves: VirtualDisplayMove[]) => void = () => {},
  ) {}

  move(move: VirtualDisplayMove): void {
    this.latest.set(move.contact, move);
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      const moves = this.flush();
      this.callback(moves);
    });
  }

  flush(): VirtualDisplayMove[] {
    const moves = [...this.latest.values()];
    this.latest.clear();
    this.scheduled = false;
    return moves;
  }

  clear(): void {
    this.latest.clear();
    this.scheduled = false;
  }
}

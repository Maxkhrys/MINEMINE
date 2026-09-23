/**
 * Keyboard / mouse state with pointer lock. Game actions are only read from here while
 * the game is in the playing state, so clicks on menus never reach the world.
 */
export class Input {
  readonly keys = new Set<string>();
  /** Accumulated mouse movement since the last frame (pixels). */
  mouseDX = 0;
  mouseDY = 0;
  leftDown = false;
  rightDown = false;
  /** Discrete presses since the last frame (so very quick clicks are never lost). */
  leftPressed = false;
  rightPressed = false;
  middlePressed = false;
  wheel = 0;
  /** Keys pressed since the last frame, by KeyboardEvent.code. */
  readonly pressed = new Set<string>();
  /** Test hook: behave as if the pointer were locked. */
  forceLocked = false;
  private lockListeners: ((locked: boolean) => void)[] = [];
  private lockErrorListeners: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (this.captures(e)) e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (this.captures(e)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Some browsers report spurious huge jumps right after locking.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      e.preventDefault();
      if (e.button === 0) {
        this.leftDown = true;
        this.leftPressed = true;
      } else if (e.button === 2) {
        this.rightDown = true;
        this.rightPressed = true;
      } else if (e.button === 1) {
        this.middlePressed = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.leftDown = false;
      else if (e.button === 2) this.rightDown = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        e.preventDefault();
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: false },
    );
    document.addEventListener('pointerlockchange', () => {
      const locked = this.locked;
      if (!locked) this.releaseAll();
      for (const fn of this.lockListeners) fn(locked);
    });
    document.addEventListener('pointerlockerror', () => {
      for (const fn of this.lockErrorListeners) fn();
    });
  }

  /** Keys the game uses are kept from scrolling the page or triggering browser shortcuts. */
  private captures(e: KeyboardEvent): boolean {
    if (e.code === 'F3') return true;
    if (!this.locked) return false;
    return ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) || e.code.startsWith('Digit') || e.code.startsWith('Key');
  }

  get locked(): boolean {
    return this.forceLocked || document.pointerLockElement === this.canvas;
  }

  onLockChange(fn: (locked: boolean) => void): void {
    this.lockListeners.push(fn);
  }

  onLockError(fn: () => void): void {
    this.lockErrorListeners.push(fn);
  }

  /** Requests pointer lock; resolves false if the browser refuses (e.g. right after Escape). */
  async requestLock(): Promise<boolean> {
    if (this.forceLocked) return true;
    if (document.pointerLockElement === this.canvas) return true;
    try {
      const req = this.canvas.requestPointerLock({ unadjustedMovement: true } as never) as unknown as Promise<void> | undefined;
      if (req && typeof req.then === 'function') await req;
      return true;
    } catch {
      try {
        const req = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        if (req && typeof req.then === 'function') await req;
        return true;
      } catch {
        return false;
      }
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  releaseAll(): void {
    this.keys.clear();
    this.leftDown = false;
    this.rightDown = false;
  }

  /** Clears per-frame accumulators. Call once at the end of every frame. */
  endFrame(): void {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.leftPressed = false;
    this.rightPressed = false;
    this.middlePressed = false;
    this.pressed.clear();
  }
}

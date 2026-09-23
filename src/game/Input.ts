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
  /** Raw (unaccelerated) mouse input is optional; remember when the platform refuses it. */
  private rawSupported = true;
  private requesting = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      // Typing recipe names must not open/close inventory or select hotbar slots.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLElement && e.target.isContentEditable)) {
        if (e.code === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
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
      // Errors from a promise-based request are reported through requestLock() instead.
      if (this.requesting) return;
      for (const fn of this.lockErrorListeners) fn();
    });
  }

  /** Keys the game uses are kept from scrolling the page or triggering browser shortcuts. */
  private captures(e: KeyboardEvent): boolean {
    if (e.code === 'F3' || (e.code === 'F1' && this.locked)) return true;
    if (!this.locked || e.ctrlKey || e.metaKey || e.altKey) return false;
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
    const request = async (raw: boolean): Promise<void> => {
      const req = (raw ? this.canvas.requestPointerLock({ unadjustedMovement: true } as never) : this.canvas.requestPointerLock()) as unknown as
        | Promise<void>
        | undefined;
      // Older browsers return nothing and report the outcome through events only.
      if (req && typeof req.then === 'function') await req;
    };
    this.requesting = true;
    try {
      if (this.rawSupported) {
        try {
          await request(true);
          return true;
        } catch (err) {
          if ((err as Error)?.name !== 'NotSupportedError') return false;
          this.rawSupported = false;
        }
      }
      await request(false);
      return true;
    } catch {
      return false;
    } finally {
      this.requesting = false;
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

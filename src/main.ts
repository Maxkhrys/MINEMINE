import './style.css';
import { Game } from './game/Game';
import { UI } from './ui/UI';

function webgl2Available(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

function fatal(title: string, message: string): void {
  const root = document.getElementById('ui')!;
  // A UI instance without a game is enough to show the error screen.
  const ui = new UI(root, new Map(), {} as never, false, {
    onPlay: () => undefined,
    onCloseInventory: () => undefined,
    onNewWorld: () => undefined,
    onResetWorld: () => undefined,
    onSettings: () => undefined,
    onUiSound: () => undefined,
  });
  ui.hideLoading();
  ui.showFatal(title, message);
}

function boot(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const root = document.getElementById('ui')!;
  if (!webgl2Available()) {
    fatal(
      'WebGL 2 is not available',
      'MINEMINE renders with WebGL 2, which this browser or device has disabled or does not support. ' +
        'Try an up-to-date Chrome, Edge, Firefox or Safari, and make sure hardware acceleration is enabled in the browser settings.',
    );
    return;
  }
  try {
    const game = new Game(canvas, root);
    game.start();
    const params = new URLSearchParams(location.search);
    if (import.meta.env.DEV || params.has('debug')) {
      (window as unknown as { __minemine: Game }).__minemine = game;
    }
  } catch (err) {
    console.error(err);
    root.innerHTML = '';
    fatal(
      'The game could not start',
      `Graphics initialisation failed (${err instanceof Error ? err.message : String(err)}). ` +
        'Reloading with ?safe in the address bar starts with every optional effect disabled.',
    );
  }
}

boot();


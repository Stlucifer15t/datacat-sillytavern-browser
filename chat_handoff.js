export const DATACAT_CHAT_TOP_PIN_MS = 1500;

const DATACAT_CHAT_USER_INTENT_EVENTS = ['wheel', 'touchstart', 'pointerdown'];

/**
 * Keeps a Datacat-opened chat at its first message while SillyTavern finishes
 * its deferred initial scrolls. Any direct interaction releases the pin early.
 *
 * @param {HTMLElement | null} chatElement SillyTavern's chat scroll container.
 * @param {object} [options] Scheduling overrides used by focused unit tests.
 * @returns {() => void} A cleanup function that releases the temporary pin.
 */
export function pinDatacatChatToTop(chatElement, options = {}) {
    if (!chatElement?.addEventListener || !chatElement?.removeEventListener) {
        return () => {};
    }

    const setTimer = options.setTimer ?? globalThis.setTimeout.bind(globalThis);
    const clearTimer = options.clearTimer ?? globalThis.clearTimeout.bind(globalThis);
    const requestFrame = options.requestFrame
        ?? globalThis.requestAnimationFrame?.bind(globalThis)
        ?? (callback => setTimer(callback, 0));
    const cancelFrame = options.cancelFrame
        ?? globalThis.cancelAnimationFrame?.bind(globalThis)
        ?? clearTimer;
    const holdMs = Number.isFinite(options.holdMs)
        ? Math.max(0, options.holdMs)
        : DATACAT_CHAT_TOP_PIN_MS;

    let released = false;
    let frameId;
    let timerId;

    const restoreTop = () => {
        if (!released && chatElement.scrollTop !== 0) {
            chatElement.scrollTop = 0;
        }
    };

    const release = () => {
        if (released) {
            return;
        }
        released = true;
        chatElement.removeEventListener('scroll', restoreTop);
        for (const eventName of DATACAT_CHAT_USER_INTENT_EVENTS) {
            chatElement.removeEventListener(eventName, release);
        }
        if (frameId !== undefined) {
            cancelFrame(frameId);
        }
        if (timerId !== undefined) {
            clearTimer(timerId);
        }
    };

    chatElement.addEventListener('scroll', restoreTop, { passive: true });
    for (const eventName of DATACAT_CHAT_USER_INTENT_EVENTS) {
        chatElement.addEventListener(eventName, release, { passive: true });
    }

    restoreTop();
    frameId = requestFrame(restoreTop);
    timerId = setTimer(release, holdMs);
    return release;
}

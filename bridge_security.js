export const DATACAT_BROWSER_URL = 'https://datacat.run/characters/recent';
export const DATACAT_BROWSER_CLIENT = 'datacat-browser';
export const DATACAT_BROWSER_VERSION = '0.1.9';
export const DATACAT_BROWSER_AUTH_MODE = 'client-link';
export const DATACAT_MAX_PNG_BYTES = 32 * 1024 * 1024;

const DATACAT_ALLOWED_BRIDGE_ORIGINS = new Set([
    new URL(DATACAT_BROWSER_URL).origin,
]);
const DATACAT_CHARACTER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATACAT_REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/;
const DATACAT_BRIDGE_NONCE_PATTERN = /^[a-zA-Z0-9-]{16,128}$/;
const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

export function isAllowedBridgeOrigin(origin) {
    try {
        const url = new URL(String(origin || ''));
        return url.protocol === 'https:' && DATACAT_ALLOWED_BRIDGE_ORIGINS.has(url.origin);
    } catch {
        return false;
    }
}

export function buildDatacatBridgeUrl(value, { nonce, firstOpen = false } = {}) {
    const url = new URL(String(value || '').trim() || DATACAT_BROWSER_URL);
    if (!isAllowedBridgeOrigin(url.origin)) {
        throw new Error('Datacat Browser URL origin is not allowed.');
    }
    const normalizedNonce = String(nonce || '').trim();
    if (!DATACAT_BRIDGE_NONCE_PATTERN.test(normalizedNonce)) {
        throw new Error('Datacat bridge nonce is invalid.');
    }
    url.searchParams.set('dc_embed', 'st');
    url.searchParams.set('dc_bridge_nonce', normalizedNonce);
    url.searchParams.set('dc_client', DATACAT_BROWSER_CLIENT);
    url.searchParams.set('dc_client_version', DATACAT_BROWSER_VERSION);
    url.searchParams.set('dc_auth_mode', DATACAT_BROWSER_AUTH_MODE);
    if (firstOpen) {
        url.searchParams.set('dc_first_open', '1');
    } else {
        url.searchParams.delete('dc_first_open');
    }
    return url.href;
}

export function requireDatacatCharacterId(value) {
    const characterId = String(value || '').trim().toLowerCase();
    if (!DATACAT_CHARACTER_ID_PATTERN.test(characterId)) {
        throw new Error('Datacat character id is invalid.');
    }
    return characterId;
}

export function requireBridgeRequestId(value) {
    const requestId = String(value || '').trim();
    if (!DATACAT_REQUEST_ID_PATTERN.test(requestId)) {
        throw new Error('Datacat bridge request id is invalid.');
    }
    return requestId;
}

export function boundedBridgeString(value, maxLength = 512) {
    const limit = Math.max(0, Math.min(Number(maxLength) || 0, 4096));
    return String(value || '').trim().slice(0, limit);
}

export function validateDatacatPngPayload(value) {
    if (!(value instanceof ArrayBuffer)) {
        throw new Error('Datacat PNG payload is invalid.');
    }
    if (value.byteLength < PNG_SIGNATURE.length) {
        throw new Error('Datacat PNG payload is too small.');
    }
    if (value.byteLength > DATACAT_MAX_PNG_BYTES) {
        throw new Error('Datacat PNG payload exceeds the 32 MB import limit.');
    }

    const bytes = new Uint8Array(value, 0, PNG_SIGNATURE.length);
    if (!PNG_SIGNATURE.every((expected, index) => bytes[index] === expected)) {
        throw new Error('Datacat payload is not a PNG file.');
    }
    return value;
}

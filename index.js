import { Popup } from '../../../popup.js';
import {
    characters,
    doNewChat,
    getCharacters,
    getRequestHeaders,
    selectCharacterById,
    this_chid,
} from '../../../../script.js';
import { accountStorage } from '../../../util/AccountStorage.js';
import {
    boundedBridgeString,
    buildDatacatBridgeUrl,
    DATACAT_BROWSER_VERSION,
    DATACAT_BROWSER_URL,
    isAllowedBridgeOrigin,
    requireBridgeRequestId,
    requireDatacatCharacterId,
    validateDatacatPngPayload,
} from './bridge_security.js?v=0.1.9';
import { pinDatacatChatToTop } from './chat_handoff.js?v=0.1.9';

const DEFAULT_URL = DATACAT_BROWSER_URL;
const DATACAT_CAT_ICON_URL = new URL('./datacat-cat.gif', import.meta.url).href;
const DATACAT_MAIN_VIEW_ID = 'datacat-reskin-main-view';
const DATACAT_MAIN_VIEW_CONTENT_ID = 'datacat-reskin-main-view-content';
const DATACAT_MAIN_VIEW_BROWSER_CLASS = 'datacat-reskin-main-view-content--browser';
const DATACAT_BROWSER_LAYER_ID = 'datacat-browser-stable-layer';
const DATACAT_BROWSER_LAYER_VISIBLE_CLASS = 'datacat-browser-stable-layer--visible';
const DATACAT_BROWSER_TOPBAR_SLOT_ID = 'datacat_browser_topbar_slot';
const DATACAT_BROWSER_TOPBAR_BUTTON_ID = 'datacat_browser_topbar_button';
const DATACAT_BROWSER_WAND_ID = 'datacat_browser_wand';
const DATACAT_BROWSER_TITLE_ID = 'datacat-browser-title';
const DATACAT_ST_IMPORT_MAP_KEY = 'datacatBrowserImportedCharactersById';
const DATACAT_BROWSER_FIRST_OPEN_KEY = 'datacatBrowserAnalyticsFirstOpenAt';
const DATACAT_BRIDGE_NONCE_PARAM = 'dc_bridge_nonce';
const DATACAT_BRIDGE_MSG_INIT = 'datacat:st-bridge:init';
const DATACAT_BRIDGE_MSG_READY = 'datacat:st-bridge:ready';
const DATACAT_BRIDGE_MSG_PREPARE = 'datacat:st-character-card:prepare';
const DATACAT_BRIDGE_MSG_CARD = 'datacat:st-character-card';
const DATACAT_BRIDGE_MSG_ACK = 'datacat:st-character-card:ack';
const DATACAT_BRIDGE_PARENT_SOURCE = 'sillytavern-datacat-browser';
const DATACAT_BRIDGE_HEARTBEAT_MS = 5000;
const DATACAT_IMPORT_ACK_TTL_MS = 2 * 60 * 1000;
const DATACAT_RECENT_CHAT_OPEN_TTL_MS = 75 * 1000;
const DATACAT_MAX_COMPLETED_ACKS = 100;
const DATACAT_MAX_IMPORT_MAPPINGS = 500;

function getDatacatImportState() {
    const existing = window.__datacatBrowserImportState;
    if (
        existing?.activeImports instanceof Set
        && existing?.completedAcks instanceof Map
        && existing?.activeChatOpens instanceof Map
        && existing?.recentChatOpens instanceof Map
    ) {
        return existing;
    }

    const state = {
        activeImports: existing?.activeImports instanceof Set ? existing.activeImports : new Set(),
        completedAcks: existing?.completedAcks instanceof Map ? existing.completedAcks : new Map(),
        activeChatOpens: existing?.activeChatOpens instanceof Map ? existing.activeChatOpens : new Map(),
        recentChatOpens: existing?.recentChatOpens instanceof Map ? existing.recentChatOpens : new Map(),
    };
    window.__datacatBrowserImportState = state;
    return state;
}

const datacatImportState = getDatacatImportState();
let activeBridge = null;
const activeImports = datacatImportState.activeImports;
const activeChatOpens = datacatImportState.activeChatOpens;
const recentChatOpens = datacatImportState.recentChatOpens;
let persistentBrowserShell = null;
let persistentBrowserFrame = null;
let persistentBrowserLayoutCleanup = null;

function normalizeDatacatUrl(value) {
    const url = new URL(String(value || '').trim() || DEFAULT_URL);
    if (!isAllowedBridgeOrigin(url.origin)) {
        throw new Error('Datacat Browser URL origin is not allowed.');
    }
    return url.href;
}

function getMultipartRequestHeaders() {
    const headers = { ...(getRequestHeaders() || {}) };
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'content-type') {
            delete headers[key];
        }
    }
    return headers;
}

function createBridgeNonce() {
    if (crypto?.randomUUID) {
        return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function shouldReportDatacatBrowserFirstOpen() {
    try {
        return !accountStorage.getItem(DATACAT_BROWSER_FIRST_OPEN_KEY);
    } catch (_) {
        return false;
    }
}

function rememberDatacatBrowserFirstOpen() {
    try {
        accountStorage.setItem(
            DATACAT_BROWSER_FIRST_OPEN_KEY,
            JSON.stringify({ firstOpenedAt: new Date().toISOString(), version: DATACAT_BROWSER_VERSION }),
        );
        return true;
    } catch (_) {
        return false;
    }
}

function clearActiveBridgeTimers() {
    if (!activeBridge?.timers) {
        return;
    }
    for (const timer of activeBridge.timers) {
        clearTimeout(timer);
    }
    if (activeBridge.pulseTimer) {
        clearInterval(activeBridge.pulseTimer);
    }
}

function sendBridgeInit(targetOrigin = activeBridge?.origin) {
    if (!activeBridge?.frame?.contentWindow || !activeBridge.nonce || !targetOrigin) {
        return;
    }
    try {
        activeBridge.frame.contentWindow.postMessage({
            type: DATACAT_BRIDGE_MSG_INIT,
            nonce: activeBridge.nonce,
            source: DATACAT_BRIDGE_PARENT_SOURCE,
        }, targetOrigin);
    } catch (error) {
        console.warn('[Datacat Browser] Could not send iframe bridge init.', error);
    }
}

function registerBridgeFrame(frame, src, nonce) {
    if (
        activeBridge?.frame === frame
        && activeBridge.src === src
        && activeBridge.nonce === nonce
    ) {
        sendBridgeInit();
        return;
    }

    clearActiveBridgeTimers();
    const origin = new URL(src).origin;
    if (!isAllowedBridgeOrigin(origin)) {
        throw new Error('Datacat iframe origin is not allowed.');
    }
    activeBridge = {
        frame,
        src,
        origin,
        nonce,
        ready: false,
        timers: [],
        pulseTimer: null,
    };

    frame.addEventListener('load', () => {
        frame.dataset.datacatFrameLoaded = 'true';
        sendBridgeInit();
    }, { once: false });

    for (const delay of [350, 900, 1800, 3200]) {
        activeBridge.timers.push(setTimeout(sendBridgeInit, delay));
    }
    activeBridge.pulseTimer = setInterval(sendBridgeInit, DATACAT_BRIDGE_HEARTBEAT_MS);
}

function setFrameBridgeSrc(frame) {
    const nonce = createBridgeNonce();
    const src = buildDatacatBridgeUrl(normalizeDatacatUrl(DEFAULT_URL), {
        nonce,
        firstOpen: shouldReportDatacatBrowserFirstOpen(),
    });
    const frameElement = frame?.[0] || frame;
    if (frameElement instanceof HTMLIFrameElement) {
        frameElement.dataset.datacatFrameLoaded = 'false';
        registerBridgeFrame(frameElement, src, nonce);
    }
    if (typeof frame?.attr === 'function') {
        frame.attr('src', src);
    } else if (frameElement) {
        frameElement.src = src;
    }
}

function ensureFrameBridgeSrc(frame) {
    const frameElement = frame?.[0] || frame;
    if (!(frameElement instanceof HTMLIFrameElement)) {
        return;
    }

    const existingSrc = frameElement.getAttribute('src') || frameElement.src;
    if (!existingSrc) {
        setFrameBridgeSrc(frame);
        return;
    }

    try {
        const url = new URL(existingSrc, window.location.href);
        const nonce = url.searchParams.get(DATACAT_BRIDGE_NONCE_PARAM);
        if (nonce) {
            registerBridgeFrame(frameElement, url.href, nonce);
            return;
        }
    } catch {
        // Fall back to a fresh bridge URL if the iframe src cannot be parsed.
    }

    setFrameBridgeSrc(frame);
}

function isDatacatMainViewAvailable() {
    return Boolean(
        document.getElementById(DATACAT_MAIN_VIEW_ID)
            && document.getElementById(DATACAT_MAIN_VIEW_CONTENT_ID),
    );
}

function readDatacatImportMap() {
    try {
        const raw = accountStorage.getItem(DATACAT_ST_IMPORT_MAP_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        console.warn('[Datacat Browser] Could not read import map.', error);
        return {};
    }
}

function writeDatacatImportMap(map) {
    try {
        accountStorage.setItem(DATACAT_ST_IMPORT_MAP_KEY, JSON.stringify(map || {}));
    } catch (error) {
        console.warn('[Datacat Browser] Could not save import map.', error);
    }
}

function normalizeDatacatCharacterId(value) {
    return String(value || '').trim().toLowerCase();
}

function getDatacatCharacterIdFromMetadata(metadata = {}) {
    return normalizeDatacatCharacterId(
        metadata.datacatCharacterId
        || metadata.datacat_character_id
        || metadata.characterId
        || metadata.character_id
        || '',
    );
}

function stripPngExtension(value) {
    return String(value || '').trim().replace(/\.png$/i, '');
}

function ensurePngExtension(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return /\.png$/i.test(raw) ? raw : `${raw}.png`;
}

function sanitizeImportNamePart(value, fallback = 'character', maxLength = 48) {
    const cleaned = String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, maxLength);
    return cleaned || fallback;
}

function buildDatacatPreservedName(metadata = {}) {
    const characterId = getDatacatCharacterIdFromMetadata(metadata);
    const shortId = sanitizeImportNamePart(characterId.replace(/-/g, ''), 'unknown', 36);
    const title = sanitizeImportNamePart(metadata.characterName || metadata.name || 'character', 'character', 44);
    return `datacat_${title}_${shortId}`;
}

function findCharacterIndexByAvatarName(avatarName) {
    const normalized = stripPngExtension(avatarName);
    if (!normalized) return -1;
    return characters.findIndex(character => stripPngExtension(character?.avatar) === normalized);
}

function findImportedDatacatCharacter(metadata = {}) {
    const characterId = getDatacatCharacterIdFromMetadata(metadata);
    const importMap = readDatacatImportMap();
    const mapped = characterId ? importMap[characterId] : null;
    const candidates = new Set();

    if (mapped?.avatar) candidates.add(mapped.avatar);
    if (mapped?.fileName) candidates.add(mapped.fileName);
    if (mapped?.file_name) candidates.add(mapped.file_name);
    candidates.add(ensurePngExtension(buildDatacatPreservedName(metadata)));

    for (const candidate of candidates) {
        const index = findCharacterIndexByAvatarName(candidate);
        if (index >= 0) {
            return {
                index,
                character: characters[index],
                importMap,
            };
        }
    }

    return {
        index: -1,
        character: null,
        importMap,
    };
}

function buildDatacatImportMetadata(metadata = {}) {
    const characterId = getDatacatCharacterIdFromMetadata(metadata);
    return {
        source: 'datacat',
        provider: 'datacat',
        datacatCharacterId: characterId,
        characterId,
        characterName: boundedBridgeString(metadata.characterName || metadata.name, 256),
        creatorName: boundedBridgeString(metadata.creatorName || metadata.creator, 256),
        sourceKind: boundedBridgeString(metadata.sourceKind || metadata.source_kind, 64),
        characterUrl: boundedBridgeString(metadata.characterUrl || metadata.character_url || metadata.url, 2048),
    };
}

function saveDatacatImportMapping(metadata, fileName) {
    const characterId = getDatacatCharacterIdFromMetadata(metadata);
    if (!characterId || !fileName) {
        return;
    }
    const importMap = readDatacatImportMap();
    importMap[characterId] = {
        avatar: ensurePngExtension(fileName),
        fileName: stripPngExtension(fileName),
        file_name: stripPngExtension(fileName),
        characterName: boundedBridgeString(metadata.characterName, 256),
        creatorName: boundedBridgeString(metadata.creatorName, 256),
        sourceKind: boundedBridgeString(metadata.sourceKind, 64),
        characterUrl: boundedBridgeString(metadata.characterUrl, 2048),
        importedAt: new Date().toISOString(),
    };
    const mappings = Object.entries(importMap);
    if (mappings.length > DATACAT_MAX_IMPORT_MAPPINGS) {
        mappings
            .sort(([, left], [, right]) => String(left?.importedAt || '').localeCompare(String(right?.importedAt || '')))
            .slice(0, mappings.length - DATACAT_MAX_IMPORT_MAPPINGS)
            .forEach(([staleCharacterId]) => delete importMap[staleCharacterId]);
    }
    writeDatacatImportMap(importMap);
}

function pruneCompletedBridgeAcks() {
    const now = Date.now();
    for (const [requestId, ack] of datacatImportState.completedAcks.entries()) {
        if (!ack || ack.expiresAt <= now) {
            datacatImportState.completedAcks.delete(requestId);
        }
    }
}

function rememberCompletedBridgeAck(requestId, status, message, extra = {}) {
    const normalizedRequestId = String(requestId || '');
    const normalizedStatus = String(status || '');
    if (!normalizedRequestId || !['ok', 'existing'].includes(normalizedStatus)) {
        return;
    }

    pruneCompletedBridgeAcks();
    while (datacatImportState.completedAcks.size >= DATACAT_MAX_COMPLETED_ACKS) {
        const oldestRequestId = datacatImportState.completedAcks.keys().next().value;
        if (!oldestRequestId) break;
        datacatImportState.completedAcks.delete(oldestRequestId);
    }
    datacatImportState.completedAcks.set(normalizedRequestId, {
        status: normalizedStatus,
        message: String(message || ''),
        extra: extra && typeof extra === 'object' ? { ...extra } : {},
        expiresAt: Date.now() + DATACAT_IMPORT_ACK_TTL_MS,
    });
}

function replayCompletedBridgeAck(requestId) {
    const normalizedRequestId = String(requestId || '');
    if (!normalizedRequestId) {
        return false;
    }

    pruneCompletedBridgeAcks();
    const ack = datacatImportState.completedAcks.get(normalizedRequestId);
    if (!ack) {
        return false;
    }

    postBridgeAck(normalizedRequestId, ack.status, ack.message, ack.extra);
    return true;
}

function postBridgeAck(requestId, status, message, extra = {}) {
    rememberCompletedBridgeAck(requestId, status, message, extra);

    if (!activeBridge?.frame?.contentWindow || !activeBridge.origin) {
        return;
    }
    activeBridge.frame.contentWindow.postMessage({
        type: DATACAT_BRIDGE_MSG_ACK,
        nonce: activeBridge.nonce,
        requestId,
        status,
        message,
        ...extra,
    }, activeBridge.origin);
}

function postBridgeImportInProgress(requestId, characterId) {
    postBridgeAck(requestId, 'processing', 'This Datacat character is already importing.', {
        datacatCharacterId: characterId,
        phase: 'Already importing',
        step: 'in-progress',
        stepLabel: 'Wait for active import',
    });
}

function closeDatacatBrowserSurface() {
    window.dispatchEvent(new CustomEvent('datacat-reskin:close-main-view', {
        detail: { updateRoute: true },
    }));

    const mainView = document.getElementById(DATACAT_MAIN_VIEW_ID);
    if (mainView) {
        mainView.hidden = true;
        mainView.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('datacat-reskin-main-view-open');
    hidePersistentBrowserShell();
}

async function closeBlockingSillyTavernPopups() {
    const openPopups = Array.isArray(Popup.util?.popups)
        ? [...Popup.util.popups].reverse()
        : [];
    for (const popup of openPopups) {
        if (!popup?.dlg?.hasAttribute('open') || popup.dlg.hasAttribute('closing')) {
            continue;
        }
        try {
            await popup.completeCancelled();
        } catch (error) {
            console.warn('[Datacat Browser] Could not close a blocking SillyTavern popup.', error);
        }
    }
}

function closeBlockingSillyTavernDrawers() {
    $('.openIcon').not('.drawerPinnedOpen').removeClass('openIcon').addClass('closedIcon');
    $('.openDrawer').not('.pinnedOpen').removeClass('openDrawer').addClass('closedDrawer');
}

async function revealSillyTavernChatAfterImport() {
    closeDatacatBrowserSurface();
    await closeBlockingSillyTavernPopups();
    closeBlockingSillyTavernDrawers();
}

function getChatOpenKey(characterIndex, metadata = {}) {
    const characterId = getDatacatCharacterIdFromMetadata(metadata);
    if (characterId) {
        return `datacat:${characterId}`;
    }

    const avatar = stripPngExtension(characters[characterIndex]?.avatar);
    if (avatar) {
        return `avatar:${avatar}`;
    }

    return `index:${characterIndex}`;
}

function pruneRecentChatOpens() {
    const now = Date.now();
    for (const [key, entry] of recentChatOpens.entries()) {
        if (!entry || now - Number(entry.openedAt || 0) > DATACAT_RECENT_CHAT_OPEN_TTL_MS) {
            recentChatOpens.delete(key);
        }
    }
}

async function openNewChatForCharacterIndex(characterIndex, metadata = {}) {
    if (characterIndex < 0 || !characters[characterIndex]) {
        throw new Error('Imported character is not available in SillyTavern.');
    }

    const chatOpenKey = getChatOpenKey(characterIndex, metadata);
    pruneRecentChatOpens();

    const activeOpen = activeChatOpens.get(chatOpenKey);
    if (activeOpen) {
        return activeOpen;
    }

    const recentOpen = recentChatOpens.get(chatOpenKey);
    const recentAge = recentOpen ? Date.now() - Number(recentOpen.openedAt || 0) : Infinity;
    if (recentOpen && recentAge <= DATACAT_RECENT_CHAT_OPEN_TTL_MS) {
        await revealSillyTavernChatAfterImport();
        console.info('[Datacat Browser] Suppressed duplicate ST chat open.', {
            characterIndex,
            datacatCharacterId: getDatacatCharacterIdFromMetadata(metadata),
            chat: recentOpen.chat || '',
            ageMs: recentAge,
        });
        return {
            skipped: true,
            chat: recentOpen.chat || '',
        };
    }

    const openPromise = (async () => {
        if (String(this_chid) !== String(characterIndex)) {
            await selectCharacterById(characterIndex, { switchMenu: false });
        }

        if (String(this_chid) !== String(characterIndex)) {
            throw new Error('SillyTavern is still busy and could not switch characters.');
        }
        await doNewChat();
        const chatName = String(characters[characterIndex]?.chat || '').trim();
        if (!chatName) {
            throw new Error('SillyTavern could not create a new character chat.');
        }
        recentChatOpens.set(chatOpenKey, {
            openedAt: Date.now(),
            chat: chatName,
        });
        pinDatacatChatToTop(document.getElementById('chat'));
        await revealSillyTavernChatAfterImport();
        return {
            skipped: false,
            chat: chatName,
        };
    })();

    activeChatOpens.set(chatOpenKey, openPromise);
    try {
        return await openPromise;
    } finally {
        activeChatOpens.delete(chatOpenKey);
    }
}

async function importDatacatCharacterPayload(payload) {
    const metadata = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
    const characterId = requireDatacatCharacterId(getDatacatCharacterIdFromMetadata(metadata));
    const requestId = requireBridgeRequestId(payload?.requestId);
    if (activeImports.has(characterId)) {
        postBridgeImportInProgress(requestId, characterId);
        return;
    }

    activeImports.add(characterId);
    try {
        const existing = findImportedDatacatCharacter(metadata);
        if (existing.index >= 0) {
            postBridgeAck(requestId, 'processing', 'Opening local copy in SillyTavern...', {
                datacatCharacterId: characterId,
                avatar: existing.character?.avatar || '',
                phase: 'Opening local copy',
                step: 'open-existing',
                stepLabel: 'Open local copy',
            });
            await openNewChatForCharacterIndex(existing.index, metadata);
            postBridgeAck(requestId, 'existing', 'Found local copy. Started a new chat.', {
                datacatCharacterId: characterId,
                avatar: existing.character?.avatar || '',
                phase: 'Chat ready',
                step: 'open-chat',
                stepLabel: 'Open chat',
            });
            toastr?.success?.('Found local copy. Started a new chat.', 'Datacat');
            return;
        }

        const png = validateDatacatPngPayload(payload.png);

        const preservedName = buildDatacatPreservedName(metadata);
        const uploadName = ensurePngExtension(sanitizeImportNamePart(
            stripPngExtension(metadata.fileName) || preservedName,
            preservedName,
            96,
        ));
        const file = new File([png], uploadName, { type: 'image/png' });
        const formData = new FormData();
        formData.append('avatar', file);
        formData.append('file_type', 'png');
        formData.append('preserved_name', preservedName);
        formData.append('datacat_metadata', JSON.stringify(buildDatacatImportMetadata(metadata)));

        postBridgeAck(requestId, 'processing', 'Importing into SillyTavern...', {
            datacatCharacterId: characterId,
            phase: 'Importing PNG',
            step: 'st-import-png',
            stepLabel: 'Import PNG',
        });
        const response = await fetch('/api/characters/import', {
            method: 'POST',
            headers: getMultipartRequestHeaders(),
            body: formData,
            cache: 'no-cache',
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.error) {
            throw new Error(result?.message || 'SillyTavern could not import this PNG.');
        }

        const importedFileName = String(result.file_name || preservedName).trim();
        saveDatacatImportMapping(metadata, importedFileName);
        postBridgeAck(requestId, 'processing', 'Refreshing SillyTavern library...', {
            datacatCharacterId: characterId,
            avatar: ensurePngExtension(importedFileName),
            phase: 'Refreshing library',
            step: 'refresh-library',
            stepLabel: 'Refresh library',
        });
        await getCharacters();

        const importedIndex = findCharacterIndexByAvatarName(importedFileName);
        if (importedIndex < 0) {
            throw new Error('Imported character was saved, but could not be found in the library.');
        }

        await openNewChatForCharacterIndex(importedIndex, metadata);
        postBridgeAck(requestId, 'ok', 'Imported into SillyTavern. Started a new chat.', {
            datacatCharacterId: characterId,
            avatar: characters[importedIndex]?.avatar || ensurePngExtension(importedFileName),
            phase: 'Chat ready',
            step: 'open-chat',
            stepLabel: 'Open chat',
        });
        toastr?.success?.('Imported into SillyTavern. Started a new chat.', 'Datacat');
    } finally {
        activeImports.delete(characterId);
    }
}

async function prepareDatacatCharacterImport(payload) {
    const metadata = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
    const characterId = requireDatacatCharacterId(getDatacatCharacterIdFromMetadata(metadata));
    const requestId = requireBridgeRequestId(payload?.requestId);

    if (activeImports.has(characterId)) {
        postBridgeImportInProgress(requestId, characterId);
        return;
    }

    const existing = findImportedDatacatCharacter(metadata);
    if (existing.index < 0) {
        postBridgeAck(requestId, 'need-card', 'Ready for PNG payload.', {
            datacatCharacterId: characterId,
            phase: 'Card payload needed',
            step: 'preflight',
            stepLabel: 'Check local copy',
        });
        return;
    }

    activeImports.add(characterId);
    try {
        postBridgeAck(requestId, 'processing', 'Opening local copy in SillyTavern...', {
            datacatCharacterId: characterId,
            avatar: existing.character?.avatar || '',
            phase: 'Opening local copy',
            step: 'open-existing',
            stepLabel: 'Open local copy',
        });
        await openNewChatForCharacterIndex(existing.index, metadata);
        postBridgeAck(requestId, 'existing', 'Found local copy. Started a new chat.', {
            datacatCharacterId: characterId,
            avatar: existing.character?.avatar || '',
            phase: 'Chat ready',
            step: 'open-chat',
            stepLabel: 'Open chat',
        });
        toastr?.success?.('Found local copy. Started a new chat.', 'Datacat');
    } finally {
        activeImports.delete(characterId);
    }
}

function isBridgeFrameEvent(event) {
    return Boolean(activeBridge && event.source === activeBridge.frame?.contentWindow);
}

function isTrustedBridgeEvent(event) {
    if (!isBridgeFrameEvent(event)) {
        return false;
    }
    if (event.origin !== activeBridge.origin) {
        if (!isAllowedBridgeOrigin(event.origin)) {
            return false;
        }
        activeBridge.origin = event.origin;
    }
    const data = event.data;
    return Boolean(data && typeof data === 'object' && data.nonce === activeBridge.nonce);
}

function isBridgeInitRequest(event) {
    if (!isBridgeFrameEvent(event)) {
        return false;
    }
    const data = event.data;
    return Boolean(
        data
            && typeof data === 'object'
            && data.type === DATACAT_BRIDGE_MSG_READY
            && data.needsInit === true
            && isAllowedBridgeOrigin(event.origin),
    );
}

function createBrowserShell() {
    return $(`
        <div class="datacat-browser-shell" id="datacat-browser-host">
            <iframe
                class="datacat-browser-frame"
                title="Explore"
                loading="eager"
                sandbox="allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
                referrerpolicy="no-referrer">
            </iframe>
        </div>
    `);
}

function getBrowserStableLayer() {
    let layer = document.getElementById(DATACAT_BROWSER_LAYER_ID);
    if (layer) {
        return layer;
    }

    layer = document.createElement('div');
    layer.id = DATACAT_BROWSER_LAYER_ID;
    layer.className = 'datacat-browser-stable-layer';
    layer.setAttribute('aria-hidden', 'true');

    const titleBar = document.createElement('header');
    titleBar.className = 'datacat-browser-titlebar';

    const title = document.createElement('span');
    title.id = DATACAT_BROWSER_TITLE_ID;
    title.className = 'datacat-browser-title';
    title.textContent = 'Datacat SillyTavern Browser';
    titleBar.append(title);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'datacat-browser-close';
    closeButton.setAttribute('aria-label', 'Close Datacat SillyTavern Browser');
    closeButton.setAttribute('title', 'Close Datacat SillyTavern Browser');
    const closeIcon = document.createElement('i');
    closeIcon.className = 'fa-solid fa-xmark';
    closeIcon.setAttribute('aria-hidden', 'true');
    closeButton.append(closeIcon);
    closeButton.addEventListener('click', () => {
        closeDatacatBrowserSurface();
    });
    titleBar.append(closeButton);

    layer.setAttribute('aria-labelledby', DATACAT_BROWSER_TITLE_ID);
    layer.setAttribute('inert', '');
    layer.append(titleBar);
    document.body.append(layer);
    return layer;
}

function getPersistentBrowserShell() {
    const shellElement = persistentBrowserShell?.[0];
    const frameElement = persistentBrowserFrame?.[0];
    if (!(shellElement instanceof HTMLElement) || !(frameElement instanceof HTMLIFrameElement)) {
        persistentBrowserShell = createBrowserShell();
        persistentBrowserFrame = persistentBrowserShell.find('.datacat-browser-frame');
    }

    return {
        content: persistentBrowserShell,
        frame: persistentBrowserFrame,
    };
}

function ensurePersistentBrowserLayer() {
    const shellElement = persistentBrowserShell?.[0];
    if (!(shellElement instanceof HTMLElement)) {
        return null;
    }

    const layer = getBrowserStableLayer();
    if (!(layer instanceof HTMLElement)) {
        return null;
    }

    if (!layer.contains(shellElement)) {
        layer.append(shellElement);
    }

    return layer;
}

function setPersistentBrowserShellVisible(isVisible) {
    const layer = isVisible ? ensurePersistentBrowserLayer() : document.getElementById(DATACAT_BROWSER_LAYER_ID);
    if (!(layer instanceof HTMLElement)) {
        document.body.classList.remove('datacat-browser-stable-layer-open');
        return false;
    }

    layer.classList.toggle(DATACAT_BROWSER_LAYER_VISIBLE_CLASS, Boolean(isVisible));
    layer.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
    layer.toggleAttribute('inert', !isVisible);
    document.body.classList.toggle('datacat-browser-stable-layer-open', Boolean(isVisible));
    return true;
}

function hidePersistentBrowserShell() {
    stopDatacatBrowserLayoutSync();
    setPersistentBrowserShellVisible(false);
}

function mountInDatacatMainView(frame) {
    const mainViewContent = document.getElementById(DATACAT_MAIN_VIEW_CONTENT_ID);
    if (!mainViewContent) {
        return false;
    }

    mainViewContent.classList.remove(
        'datacat-reskin-main-view-content--home',
        'datacat-reskin-main-view-content--characters',
        'datacat-reskin-main-view-content--panel',
        'datacat-reskin-main-view-content--stock-section',
        DATACAT_MAIN_VIEW_BROWSER_CLASS,
    );
    mainViewContent.classList.add(DATACAT_MAIN_VIEW_BROWSER_CLASS);
    mainViewContent.classList.add('datacat-reskin-main-view-content--panel');

    stopDatacatBrowserLayoutSync();
    if (!setPersistentBrowserShellVisible(true)) {
        return false;
    }
    ensureFrameBridgeSrc(frame);

    const mainView = document.getElementById(DATACAT_MAIN_VIEW_ID);
    if (mainView) {
        mainView.hidden = false;
        mainView.setAttribute('aria-hidden', 'false');
    }

    document.body.classList.add('datacat-reskin-main-view-open');
    window.dispatchEvent(new CustomEvent('datacat-reskin:set-active-label', {
        detail: { label: 'Explore' },
    }));
    return true;
}

function stopDatacatBrowserLayoutSync() {
    persistentBrowserLayoutCleanup?.();
    persistentBrowserLayoutCleanup = null;
}

function startDatacatBrowserLayoutSync(layer) {
    stopDatacatBrowserLayoutSync();

    const sheld = document.getElementById('sheld');
    const update = () => {
        if (!(layer instanceof HTMLElement) || window.matchMedia('(max-width: 800px)').matches) {
            layer?.style.removeProperty('--datacat-browser-surface-left');
            layer?.style.removeProperty('--datacat-browser-surface-width');
            return;
        }

        const rect = sheld?.getBoundingClientRect();
        if (!rect || rect.width <= 0) {
            layer.style.removeProperty('--datacat-browser-surface-left');
            layer.style.removeProperty('--datacat-browser-surface-width');
            return;
        }

        layer.style.setProperty('--datacat-browser-surface-left', `${rect.left}px`);
        layer.style.setProperty('--datacat-browser-surface-width', `${rect.width}px`);
    };

    const resizeObserver = sheld && typeof ResizeObserver === 'function'
        ? new ResizeObserver(update)
        : null;
    resizeObserver?.observe(sheld);

    const mutationObserver = sheld && typeof MutationObserver === 'function'
        ? new MutationObserver(update)
        : null;
    mutationObserver?.observe(sheld, { attributes: true, attributeFilter: ['class', 'style'] });

    window.addEventListener('resize', update);
    update();

    persistentBrowserLayoutCleanup = () => {
        resizeObserver?.disconnect();
        mutationObserver?.disconnect();
        window.removeEventListener('resize', update);
        layer.style.removeProperty('--datacat-browser-surface-left');
        layer.style.removeProperty('--datacat-browser-surface-width');
    };
}

function openDatacatBrowser() {
    const { frame } = getPersistentBrowserShell();

    if (isDatacatMainViewAvailable()) {
        if (mountInDatacatMainView(frame)) {
            return;
        }
    }

    // Stock fallback: reveal the same connected iframe instead of putting it in
    // a disposable Popup. Detaching an iframe destroys its browsing context.
    ensureFrameBridgeSrc(frame);
    const layer = ensurePersistentBrowserLayer();
    if (!(layer instanceof HTMLElement)) {
        return;
    }

    startDatacatBrowserLayoutSync(layer);
    setPersistentBrowserShellVisible(true);
}

window.datacatOpenBrowser = openDatacatBrowser;
window.addEventListener('datacat-browser:open', openDatacatBrowser);
window.addEventListener('datacat-browser:park-main-view', hidePersistentBrowserShell);
window.addEventListener('message', (event) => {
    if (isBridgeInitRequest(event)) {
        activeBridge.origin = event.origin;
        sendBridgeInit(event.origin);
        return;
    }

    if (!isTrustedBridgeEvent(event)) {
        return;
    }

    const data = event.data;
    if (data.type === DATACAT_BRIDGE_MSG_READY) {
        activeBridge.ready = true;
        if (data.analyticsFirstOpenAccepted === true) {
            rememberDatacatBrowserFirstOpen();
        }
        return;
    }

    if (
        data.type === DATACAT_BRIDGE_MSG_PREPARE
        || data.type === DATACAT_BRIDGE_MSG_CARD
    ) {
        if (replayCompletedBridgeAck(String(data.requestId || ''))) {
            return;
        }
    }

    if (data.type === DATACAT_BRIDGE_MSG_PREPARE) {
        prepareDatacatCharacterImport(data).catch((error) => {
            console.error('[Datacat Browser] Import preflight failed:', error);
            postBridgeAck(String(data.requestId || ''), 'error', error?.message || 'Datacat import preflight failed.');
            toastr?.error?.(error?.message || 'Datacat import preflight failed.', 'Datacat');
        });
        return;
    }

    if (data.type === DATACAT_BRIDGE_MSG_CARD) {
        importDatacatCharacterPayload(data).catch((error) => {
            console.error('[Datacat Browser] Import from iframe failed:', error);
            postBridgeAck(String(data.requestId || ''), 'error', error?.message || 'Datacat import failed.');
            toastr?.error?.(error?.message || 'Datacat import failed.', 'Datacat');
        });
    }
});
window.addEventListener('focus', () => sendBridgeInit());
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        sendBridgeInit();
    }
});
window.dispatchEvent(new Event('datacat-browser:ready'));

function ensureDatacatTopbarLauncher() {
    const host = document.getElementById('top-settings-holder') || document.getElementById('top-bar');
    if (!host) {
        return false;
    }

    let slot = document.getElementById(DATACAT_BROWSER_TOPBAR_SLOT_ID);
    if (!slot) {
        slot = document.createElement('div');
        slot.id = DATACAT_BROWSER_TOPBAR_SLOT_ID;
        slot.className = 'drawer datacat-browser-topbar-slot';
    }

    let button = document.getElementById(DATACAT_BROWSER_TOPBAR_BUTTON_ID);
    if (!button) {
        button = document.createElement('button');
        button.id = DATACAT_BROWSER_TOPBAR_BUTTON_ID;
    }
    button.type = 'button';
    button.className = 'drawer-icon interactable datacat-browser-topbar-button';
    button.title = 'Explore Datacat';
    button.setAttribute('aria-label', 'Explore Datacat');
    let icon = button.querySelector('.datacat-browser-cat-icon');
    if (!icon) {
        icon = document.createElement('img');
        icon.className = 'datacat-browser-cat-icon';
        icon.src = DATACAT_CAT_ICON_URL;
        icon.alt = '';
        icon.draggable = false;
        icon.setAttribute('aria-hidden', 'true');
        button.replaceChildren(icon);
    }
    button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        openDatacatBrowser();
    };
    if (button.parentElement !== slot) {
        slot.appendChild(button);
    }

    if (slot.parentElement !== host) {
        host.appendChild(slot);
    }
    return true;
}

function ensureDatacatWandLauncher() {
    const host = document.getElementById('extensionsMenu');
    if (!host) {
        return false;
    }

    let button = document.getElementById(DATACAT_BROWSER_WAND_ID);
    if (!button) {
        button = document.createElement('div');
        button.id = DATACAT_BROWSER_WAND_ID;
        button.className = 'list-group-item flex-container flexGap5';
        button.title = 'Explore Datacat';
        button.setAttribute('role', 'button');
        button.tabIndex = 0;
        button.innerHTML = `
            <img src="${DATACAT_CAT_ICON_URL}" alt="" class="extensionsMenuExtensionButton datacat-browser-wand-icon" aria-hidden="true" draggable="false">
            <span>Explore</span>
        `;
    }
    button.onclick = openDatacatBrowser;
    button.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openDatacatBrowser();
        }
    };

    if (button.parentElement !== host) {
        host.appendChild(button);
    }
    return true;
}

function ensureDatacatBrowserLaunchers() {
    ensureDatacatTopbarLauncher();
    ensureDatacatWandLauncher();
}

function observeDatacatBrowserLaunchers() {
    const observer = new MutationObserver(() => {
        const topbarHost = document.getElementById('top-settings-holder') || document.getElementById('top-bar');
        const topbarSlot = document.getElementById(DATACAT_BROWSER_TOPBAR_SLOT_ID);
        const topbarReady = document.getElementById(DATACAT_BROWSER_TOPBAR_BUTTON_ID)?.isConnected
            && topbarSlot?.parentElement === topbarHost;
        const wandHost = document.getElementById('extensionsMenu');
        const wandReady = document.getElementById(DATACAT_BROWSER_WAND_ID)?.parentElement === wandHost;
        if (topbarReady && (!wandHost || wandReady)) {
            return;
        }

        ensureDatacatBrowserLaunchers();
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

jQuery(() => {
    ensureDatacatBrowserLaunchers();
    observeDatacatBrowserLaunchers();
    window.setTimeout(ensureDatacatBrowserLaunchers, 500);
    window.setTimeout(ensureDatacatBrowserLaunchers, 2000);
});

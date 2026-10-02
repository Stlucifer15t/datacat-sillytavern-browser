import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
    boundedBridgeString,
    buildDatacatBridgeUrl,
    DATACAT_BROWSER_AUTH_MODE,
    DATACAT_BROWSER_CLIENT,
    DATACAT_BROWSER_URL,
    DATACAT_BROWSER_VERSION,
    DATACAT_MAX_PNG_BYTES,
    isAllowedBridgeOrigin,
    requireBridgeRequestId,
    requireDatacatCharacterId,
    validateDatacatPngPayload,
} from '../bridge_security.js';
import { pinDatacatChatToTop } from '../chat_handoff.js';

function makePng(byteLength = 16) {
    const bytes = new Uint8Array(byteLength);
    bytes.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    return bytes.buffer;
}

test('bridge origin policy allows only exact production HTTPS origins', () => {
    assert.equal(isAllowedBridgeOrigin('https://datacat.run'), true);
    assert.equal(isAllowedBridgeOrigin('https://preview.example'), false);
    assert.equal(isAllowedBridgeOrigin('https://www.datacat.run'), false);
    assert.equal(isAllowedBridgeOrigin('http://datacat.run'), false);
    assert.equal(isAllowedBridgeOrigin('https://datacat.run:444'), false);
    assert.equal(isAllowedBridgeOrigin('http://localhost'), false);
    assert.equal(isAllowedBridgeOrigin('http://127.0.0.1:4321'), false);
    assert.equal(isAllowedBridgeOrigin('https://evil.example'), false);
});

test('bridge ids are bounded and character ids must be UUID-shaped', () => {
    assert.equal(requireBridgeRequestId('dcst_abc-123:ok'), 'dcst_abc-123:ok');
    assert.throws(() => requireBridgeRequestId('bad request'));
    assert.throws(() => requireBridgeRequestId('x'.repeat(129)));
    assert.equal(
        requireDatacatCharacterId('31F6B436-3539-43A1-834A-0D64FF36E3B8'),
        '31f6b436-3539-43a1-834a-0d64ff36e3b8',
    );
    assert.throws(() => requireDatacatCharacterId('../not-a-character'));
});

test('bridge URL identifies extension traffic without a persistent identifier', () => {
    const nonce = '12345678-1234-1234-1234-123456789abc';
    const regular = new URL(buildDatacatBridgeUrl('https://datacat.run/fresh', { nonce }));
    assert.equal(regular.searchParams.get('dc_embed'), 'st');
    assert.equal(regular.searchParams.get('dc_client'), DATACAT_BROWSER_CLIENT);
    assert.equal(regular.searchParams.get('dc_client_version'), DATACAT_BROWSER_VERSION);
    assert.equal(regular.searchParams.get('dc_auth_mode'), DATACAT_BROWSER_AUTH_MODE);
    assert.equal(regular.searchParams.get('dc_first_open'), null);
    assert.equal([...regular.searchParams.keys()].some(key => /user|install.*id|device/i.test(key)), false);

    const firstOpen = new URL(buildDatacatBridgeUrl('https://datacat.run/', {
        nonce,
        firstOpen: true,
    }));
    assert.equal(firstOpen.searchParams.get('dc_first_open'), '1');
    assert.throws(
        () => buildDatacatBridgeUrl('https://evil.example/', { nonce }),
        /origin is not allowed/,
    );
    assert.throws(
        () => buildDatacatBridgeUrl('https://datacat.run/fresh', { nonce: 'short' }),
        /nonce is invalid/,
    );
});

test('embedded Browser defaults to the public Characters page', () => {
    assert.equal(new URL(DATACAT_BROWSER_URL).pathname, '/characters/recent');
});

test('PNG validation enforces signature and size', () => {
    const valid = makePng();
    assert.equal(validateDatacatPngPayload(valid), valid);
    assert.throws(() => validateDatacatPngPayload(new ArrayBuffer(16)), /not a PNG/);
    assert.throws(() => validateDatacatPngPayload(makePng(DATACAT_MAX_PNG_BYTES + 1)), /32 MB/);
});

test('metadata strings are bounded', () => {
    assert.equal(boundedBridgeString('  hello  ', 10), 'hello');
    assert.equal(boundedBridgeString('abcdefgh', 4), 'abcd');
});

test('Datacat chat handoff pins the first message until user interaction', () => {
    const chatElement = new EventTarget();
    chatElement.scrollTop = 640;
    let frameCallback;
    let timerCallback;

    pinDatacatChatToTop(chatElement, {
        requestFrame: (callback) => {
            frameCallback = callback;
            return 1;
        },
        cancelFrame: () => {},
        setTimer: (callback) => {
            timerCallback = callback;
            return 2;
        },
        clearTimer: () => {},
    });

    assert.equal(chatElement.scrollTop, 0);
    chatElement.scrollTop = 720;
    chatElement.dispatchEvent(new Event('scroll'));
    assert.equal(chatElement.scrollTop, 0);
    chatElement.scrollTop = 810;
    frameCallback();
    assert.equal(chatElement.scrollTop, 0);

    chatElement.dispatchEvent(new Event('wheel'));
    chatElement.scrollTop = 900;
    chatElement.dispatchEvent(new Event('scroll'));
    assert.equal(chatElement.scrollTop, 900);
    timerCallback();
});

test('public package contains no custom direct-import bridge path', () => {
    const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /direct-import|import-url|localhost|127\.0\.0\.1/);
    assert.match(source, /data\.analyticsFirstOpenAccepted === true/);
    assert.match(source, /rememberDatacatBrowserFirstOpen\(\)/);
    assert.match(
        source,
        /pinDatacatChatToTop\(document\.getElementById\('chat'\)\);\s*await revealSillyTavernChatAfterImport\(\)/,
    );
    assert.match(source, /await doNewChat\(\)/);
    assert.doesNotMatch(source, /createOrEditCharacter|humanizedDateTime|await clearChat\(|await getChat\(/);
    assert.match(source, /headers: getMultipartRequestHeaders\(\)/);
    assert.doesNotMatch(source, /getRequestHeaders\(\{ omitContentType: true \}\)/);
    assert.match(source, /Popup\.util\?\.popups/);
    assert.match(source, /await popup\.completeCancelled\(\)/);
    assert.match(source, /\.openDrawer'\)\.not\('\.pinnedOpen'\)/);
    assert.match(source, /sandbox="[^"]*allow-downloads[^"]*"/);
});

test('Browser close keeps the iframe connected for stateful reopen', () => {
    const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /document\.body\.append\(layer\)/);
    assert.match(source, /layer\.classList\.toggle\(DATACAT_BROWSER_LAYER_VISIBLE_CLASS/);
    assert.match(source, /layer\.toggleAttribute\('inert', !isVisible\)/);
    assert.match(source, /function hidePersistentBrowserShell\(\) \{\s*stopDatacatBrowserLayoutSync\(\);\s*setPersistentBrowserShellVisible\(false\);/);
    assert.doesNotMatch(source, /new Popup\(/);
    assert.doesNotMatch(source, /persistentBrowserShell[^;]*\.remove\(/);
});

test('manifest exposes public release metadata', () => {
    const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    assert.equal(manifest.author, 'Datacat');
    assert.equal(manifest.display_name, 'Datacat SillyTavern Browser');
    assert.equal(manifest.version, '0.1.10');
    assert.equal(manifest.version, DATACAT_BROWSER_VERSION);
    assert.equal(manifest.js, 'index.js?v=0.1.10');
    assert.equal(manifest.css, 'style.css?v=0.1.10');
    assert.equal(manifest.minimum_client_version, '1.12.12');
    assert.deepEqual(manifest.dependencies, []);
    assert.equal('requires' in manifest, false);
    assert.equal('optional' in manifest, false);
    const catGif = fs.readFileSync(new URL('../datacat-cat.gif', import.meta.url));
    assert.equal(catGif.subarray(0, 6).toString('ascii'), 'GIF89a');
    assert.equal(catGif.readUInt16LE(6), 348);
    assert.equal(catGif.readUInt16LE(8), 379);
    let frameCount = 0;
    for (let index = 0; index <= catGif.length - 4; index += 1) {
        if (catGif[index] === 0x21 && catGif[index + 1] === 0xF9 && catGif[index + 2] === 0x04) {
            frameCount += 1;
        }
    }
    assert.equal(frameCount, 18);
});

test('release entry point cache-busts internal modules', () => {
    const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /from '\.\/bridge_security\.js\?v=0\.1\.9';/);
    assert.match(source, /from '\.\/chat_handoff\.js\?v=0\.1\.9';/);
});

test('embedded auth uses Datacat Client API linking', () => {
    const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.equal(DATACAT_BROWSER_AUTH_MODE, 'client-link');
    assert.doesNotMatch(source, /DATACAT_AUTH_HANDOFF_MSG/);
    assert.doesNotMatch(source, /firebaseIdToken/);
    assert.doesNotMatch(source, /getTrustedAuthHandoffMessage/);
});

test('accepts cross-realm and typed-array PNG payloads', async () => {
    const { validateDatacatPngPayload } = await import('../bridge_security.js');
    const { runInNewContext } = await import('node:vm');
    const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0];
    const foreign = runInNewContext(`new Uint8Array(${JSON.stringify(sig)}).buffer`);
    assert.equal(validateDatacatPngPayload(foreign).byteLength, sig.length);
    const view = validateDatacatPngPayload(new Uint8Array(sig));
    assert.ok(view instanceof ArrayBuffer);
    assert.throws(() => validateDatacatPngPayload('nope'), /invalid/);
});

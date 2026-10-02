# Changelog

## 0.1.10

- Bug fix: let the embedded Datacat iframe request storage access so login
  state can persist where third-party cookies are restricted.
- Add title-bar "Log in" and "Reload" buttons as a fallback for hosts such as
  the SillyTavern Android app, where the embedded login can stall.
- Bug fix: accept PNG payloads delivered as cross-realm ArrayBuffers, typed
  arrays, or Blobs so imports no longer fail with "payload is invalid".

## 0.1.9

- Bug fix: use Datacat Client API account linking for top-level login and
  registration, then activate the linked account inside the embedded Browser.
- Keep Datacat credentials and temporary Client API tokens out of the
  SillyTavern host page and avoid browser opener or shared-storage handoffs.

## 0.1.8

- Open all Datacat login and registration screens in a top-level Datacat
  window while keeping the embedded character browser in place.
- Remove the obsolete SillyTavern-host authentication relay; the Datacat iframe
  now consumes its server-backed one-time login result directly.

## 0.1.7

- Bug fix: complete email/password login from Datacat's top-level login window
  by relaying a short-lived, single-use handoff credential back to the embedded
  Browser without exposing the user's password or durable Datacat session.

## 0.1.6

- Bug fix: relay Google authentication results through the SillyTavern host
  when Firefox gives an embedded Datacat login popup the host page as its
  opener, allowing the iframe login flow to complete.

## 0.1.5

- Bug fix: Google sign-in launched from the embedded Datacat browser now uses
  Datacat's top-level authentication handoff instead of a Firebase popup in
  the iframe, preventing `auth/popup-blocked` failures.

## 0.1.4

- Support SillyTavern 1.12.12 and newer by using its stable new-chat API.

## 0.1.3

- Keep the embedded Datacat iframe connected while the Browser is closed so
  reopening preserves its current page, navigation history, and in-page state.

## 0.1.2

- Allow user-initiated file downloads from the sandboxed Datacat iframe.
- Close the Browser, other open SillyTavern popups, and unpinned drawers after
  opening a character chat so the chat remains visible.

## 0.1.1

- Refresh release URLs so SillyTavern cannot reuse the earlier `0.1.0`
  JavaScript modules after reinstalling the extension.

## 0.1.0

- Initial release of the standalone Datacat character browser for SillyTavern.
- Browse and import cards through SillyTavern's native PNG import flow, then
  open a fresh chat at its first message.
- Use the animated Datacat launcher in stock SillyTavern or the optional
  Datacat Reskin layout.
- Protect the cross-origin bridge with exact HTTPS origins, per-session nonces,
  bounded metadata, and PNG validation.
- Attribute aggregate extension traffic without a persistent installation or
  device identifier.

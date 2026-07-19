# Changelog

## 0.1.3

- Keep the embedded DataCat iframe connected while the Browser is closed so
  reopening preserves its current page, navigation history, and in-page state.

## 0.1.2

- Allow user-initiated file downloads from the sandboxed DataCat iframe.
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

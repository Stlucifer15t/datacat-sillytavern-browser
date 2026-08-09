# Datacat SillyTavern Browser

Browse Datacat from SillyTavern.

## Install in SillyTavern

1. Open SillyTavern and click **Extensions** (the cubes icon).
2. Click **Install extension**.
3. Paste this Git URL:

   ```text
   https://github.com/datacat-run/datacat-sillytavern-browser
   ```

4. Choose **Install just for me**. SillyTavern administrators can instead
   choose **Install for all users**.
5. Open the Browser with the yellow cat in the top bar, or select **Explore**
   from the Extensions menu.

## What it does

- Browses Datacat inside SillyTavern.
- Imports a selected character through SillyTavern's native PNG import flow.
- Opens the imported character in a fresh chat at the first message.
- Works with stock SillyTavern; Datacat Reskin is optional.

Requires SillyTavern 1.12.12 or newer and internet access to Datacat.

## Privacy

No SillyTavern chats, API keys, model settings, or request headers are sent to
Datacat. Basic anonymous usage signals are used for aggregate extension
traffic counts; they contain no persistent installation or device identifier.

## Development

```bash
npm test
npm run check
```

## License

GNU Affero General Public License v3.0. See [LICENSE](LICENSE).

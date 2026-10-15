// Handing the class on: a link that opens it in the abap2UI5 playground,
// and one that opens it in VS Code with the abap2UI5 extension.
//
// The playground's share link is its own format (src/shell/share.mjs in
// abap2UI5/playground): the fragment is one character of version, "2", then
// base64url of the deflated JSON `[{ name, source }]` - the files it opens,
// the first one the app it starts. Written here byte for byte the same, so
// a link from the editor is a link the playground reads today.
//
// The VS Code link is the extension's URI handler:
//   vscode://abap2ui5.abap2ui5/open?code=<base64url of the deflated source>&name=<file>
// (or ?src=<https url> for a class that is on GitHub). The extension opens
// the class as an untitled .clas.abap document and offers to run it.

export const PLAYGROUND_URL = 'https://abap2ui5.github.io/playground/';
export const VSCODE_URI = 'vscode://abap2ui5.abap2ui5/open';

const CHUNK = 0x8000;

export function toBase64Url(bytes) {
  const parts = [];
  for (let i = 0; i < bytes.length; i += CHUNK) parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  return btoa(parts.join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function deflate(text) {
  const bytes = new TextEncoder().encode(text);
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
}

// the playground's fragment for one or more files: version 2
export async function playgroundFragment(files) {
  const payload = JSON.stringify(files.map(({ name, source }) => ({ name, source })));
  return '2' + toBase64Url(await deflate(payload));
}

export async function playgroundLink(fileName, source, base = PLAYGROUND_URL) {
  const url = new URL(base);
  url.search = '';
  url.hash = await playgroundFragment([{ name: fileName, source }]);
  return url.href;
}

export async function vscodeLink(fileName, source, base = VSCODE_URI) {
  const code = toBase64Url(await deflate(source));
  return `${base}?code=${code}&name=${encodeURIComponent(fileName)}`;
}

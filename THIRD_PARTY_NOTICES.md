# SEEKMORE Third-Party Notices

SEEKMORE is licensed under the MIT License. SEEKMORE also uses third-party
software distributed under separate licenses. Those licenses apply only to the
relevant third-party components and do not replace the SEEKMORE MIT License.

This notice records the third-party dependencies that required explicit
attention in the dependency-license scan performed before the initial public
release.

## Dual-licensed dependencies

### JSZip 3.10.1

- Upstream: https://github.com/Stuk/jszip
- Declared license: `MIT OR GPL-3.0-or-later`
- SEEKMORE uses JSZip under the **MIT** option.

See `licenses/MIT.txt`.

### DOMPurify 3.4.12

- Upstream: https://github.com/cure53/DOMPurify
- Declared license: `MPL-2.0 OR Apache-2.0`
- SEEKMORE uses DOMPurify under the **Apache License 2.0** option.

See `licenses/Apache-2.0.txt`.

## Attribution / redistribution-sensitive components

### Font Awesome Free — `@fortawesome/free-solid-svg-icons` 6.7.2

- Upstream: https://fontawesome.com
- Package metadata observed by the scan: `(CC-BY-4.0 AND MIT)`
- Font Awesome Free icon content is subject to Creative Commons Attribution
  4.0 terms; associated software/code portions are subject to MIT terms as
  specified by Font Awesome.

SEEKMORE does not claim ownership of Font Awesome icons.

See:

- `licenses/CC-BY-4.0.txt`
- `licenses/MIT.txt`

### Sharp / prebuilt libvips runtime

- Sharp upstream: https://github.com/lovell/sharp
- libvips packaging upstream: https://github.com/lovell/sharp-libvips
- macOS arm64 package observed by the scan:
  `@img/sharp-libvips-darwin-arm64` 1.0.4
- package license observed by the scan: `LGPL-3.0-or-later`

The prebuilt Sharp/libvips runtime contains multiple native libraries under
multiple licenses, including LGPL-licensed components. SEEKMORE therefore
includes the LGPL v3 and GPL v3 texts in this repository.

See:

- `licenses/LGPL-3.0.txt`
- `licenses/GPL-3.0.txt`

**Binary-release requirement:** each Windows/macOS package should also preserve
the exact LICENSE/NOTICE files shipped with the platform-specific Sharp/libvips
binary actually included in that release. The upstream Sharp/libvips project
maintains its own third-party notice describing the native libraries it bundles.
The exact notice from the installed/bundled version should be copied into the
release rather than assuming that one repository-level notice covers every
future platform/version.

## Dependencies whose registry metadata required manual resolution

### `buffers` 0.1.1

- Upstream: https://github.com/substack/node-buffers
- Observed dependency path: `exceljs > unzipper > binary > buffers`
- `pnpm licenses list` reported `Unknown` because this old package does not
  expose a modern SPDX value in the installed metadata.
- Upstream/downstream archival records identify the package as MIT/X11 / MIT.

SEEKMORE treats this dependency as MIT. See `licenses/MIT.txt`.

### `khroma` 2.1.0

- Upstream: https://github.com/fabiospampinato/khroma
- Observed dependency path: `mermaid > khroma`
- `pnpm licenses list` reported `Unknown`, while the upstream project declares
  MIT.

SEEKMORE treats this dependency as MIT. See `licenses/MIT.txt`.

## Build-time dependency identified by the scan

### Lightning CSS 1.32.0

- Upstream: https://github.com/parcel-bundler/lightningcss
- License: MPL-2.0
- Observed through frontend build/dev tooling (Tailwind/Vite/Vitest paths).

See `licenses/MPL-2.0.txt`.

## Other dependencies

The SEEKMORE workspace also uses many dependencies under permissive licenses
such as MIT, Apache-2.0, BSD, ISC, 0BSD, BlueOak-1.0.0, Zlib and CC0-1.0.
Their original copyright and license notices remain the property of their
respective authors and licensors.

For the current source tree, regenerate the package inventory after dependency
changes with:

```bash
pnpm licenses list
pnpm licenses list --json
```

## Vendored runtimes and non-code assets

This file does not by itself certify every manually vendored runtime, font,
image, logo, SVG, model, audio/video asset or other binary. If a SEEKMORE
release includes Node.js, PostgreSQL, pgvector, Valkey/Garnet, Electron or other
vendored runtime components, preserve the applicable license/NOTICE files for
the exact versions distributed in that release.

Likewise, fonts, images, logos, SVGs and media assets must have redistribution
rights independent of the JavaScript dependency scan.

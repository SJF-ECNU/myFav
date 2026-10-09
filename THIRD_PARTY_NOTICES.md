# Third-party notices and acknowledgments

myFav's original code is MIT licensed. Dependencies, browser binaries, models and operating-system packages retain their own licenses. Their licenses are not replaced by the myFav LICENSE.

## Direct JavaScript dependencies

| Project | Role | License / source |
| --- | --- | --- |
| [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) | Persistent Chromium automation | MIT wrapper; browser binary and bundled components retain upstream notices |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | MCP transport and tools | MIT |
| [Express](https://github.com/expressjs/express) | HTTP server | MIT |
| [Playwright](https://github.com/microsoft/playwright) | Browser control | Apache-2.0 |
| [Zod](https://github.com/colinhacks/zod) | Tool schema validation | MIT |

Full direct dependency license texts are preserved in [third-party/licenses](third-party/licenses). Installed versions and npm dependency license metadata are listed in [npm-dependencies.json](third-party/npm-dependencies.json); npm packages in the image retain their original notices.

## Container runtime

- [OpenAI Whisper](https://github.com/openai/whisper): local speech transcription; code and model weights MIT.
- [PyTorch](https://github.com/pytorch/pytorch): CPU inference; BSD-style license and bundled component notices.
- [FFmpeg](https://ffmpeg.org/legal.html): audio extraction; Debian's build enables GPL components. Consult the installed package copyright and build configuration.
- [Chromium](https://chromium.googlesource.com/chromium/src/+/main/LICENSE): browser engine, BSD-style license plus third-party licenses; CloakBrowser distributes its patched browser separately.
- [noVNC](https://github.com/novnc/noVNC): browser-based display, MPL-2.0.
- [websockify](https://github.com/novnc/websockify): WebSocket/VNC bridge, LGPL-3.0.
- [x11vnc](https://github.com/LibVNC/x11vnc): VNC server, GPL-2.0-or-later; Xvfb uses X.Org component licenses.
- [Node.js](https://github.com/nodejs/node) and Debian packages retain their bundled notices.

Python distribution notices remain in `/opt/whisper/lib/python*/site-packages`; Debian copyright files remain in `/usr/share/doc/<package>/copyright`. Debian package source is available from [Debian Sources](https://sources.debian.org/) using the installed version (`dpkg-query -W`); browser provenance is available from CloakBrowser releases. Distributing an image requires preserving applicable notices and satisfying each included component's distribution terms.

## Research references (not bundled dependencies)

The following projects and documentation informed platform feasibility research. myFav does not vendor their implementation, and references do not relicense their code:

- [bilibili-mcp-server](https://github.com/Zijian-Ni/bilibili-mcp-server): related MCP feasibility reference; not installed or bundled.
- [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect): community interface documentation.
- [TikTokDownloader](https://github.com/JoeanAmier/TikTokDownloader): Douyin feasibility reference; GPL-3.0; not installed or bundled.
- [xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp): browser login and page-state feasibility reference, Apache-2.0.
- [redbook](https://github.com/lucasygu/redbook): Xiaohongshu favorites research reference, MIT.

Platform names and trademarks belong to their owners. This project is independent of those platforms.

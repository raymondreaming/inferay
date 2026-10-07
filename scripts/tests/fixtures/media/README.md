# Run preview fixture

`preview.webm` is an original, silent two-second solid-color clip used by
`verify-projects.mjs` to verify retained artifact playback and seeking. It contains
no third-party content and needs no caption track. The verifier embeds it into a
disposable report tool; no encoder is required to run the check.

Regenerate with:

```sh
ffmpeg -f lavfi -i 'color=c=0x5268ae:s=160x90:r=12:d=2' -c:v libvpx -an -y preview.webm
```

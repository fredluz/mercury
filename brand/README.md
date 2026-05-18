# Mercury brand source

`brand/source/mercury-logo-source.png` is the canonical Mercury logo bitmap. It is an exact copy of the user-provided source image from May 16, 2026.

Do not edit generated app assets directly. Regenerate them on macOS with:

```sh
npm run brand:generate
```

The generator intentionally uses macOS-native `sips` and `iconutil` so it can create PNG, ICO, and ICNS outputs without adding image-processing dependencies. To verify committed derivatives are still in sync with the canonical source, run:

```sh
npm run brand:check
```

The generator derives the packaged Electron icons and renderer/docs PNG copies from the canonical source image, and it fails if the source hash or dimensions change.

Nightly builds use the same canonical Mercury logo with RGB colors inverted at generation time. The derived Nightly outputs are `build/nightly-icon.{png,ico,icns}`, `resources/nightly-icon.png`, `src/renderer/src/assets/nightly-icon.png`, and `docs/assets/mercury-nightly-logo.png`.

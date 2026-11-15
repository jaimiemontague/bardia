# public/assets: final art, music and voice

Put the owner's **final files** here, each at the path its asset id names in `ASSET_LIST.md`
(lower case, hyphens, folders by area). Then run, from the `game` folder:

```
npm run tool -- assets-index
```

That rewrites `final-index.json` (in this folder; the game reads it to prefer final files over the
procedural placeholders) and `ASSET_LIST.md` (every id with its status).

The full guide (formats, sizes, layered portraits, sprite strips, audio levels, checking your files
in the gallery) is `ASSET_DROP_IN.md` in the `game` folder.

This README and `final-index.json` are not assets; the tool ignores them. Everything else in this
folder ships with the game.

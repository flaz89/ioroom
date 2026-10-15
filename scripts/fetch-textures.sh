#!/usr/bin/env bash
# Downloads the room surface textures (Poly Haven, CC0) into public/textures/<slug>/ as 1K JPGs:
# color (diff), OpenGL normal (nor_gl) and roughness (rough). Run from the project root:
#   bash scripts/fetch-textures.sh
# Then convert them to WebP (the app loads .webp, see src/components/scene/level/room/surfaceMaterials.js),
# e.g. with cwebp (brew install webp):
#   for f in public/textures/*/*.jpg; do cwebp -q 85 "$f" -o "${f%.jpg}.webp" && rm "$f"; done
# Keep this list in sync with SURFACE_MATERIALS in surfaceMaterials.js.
set -euo pipefail
SLUGS=(diagonal_parquet dark_wooden_planks concrete_floor_painted beige_wall_001 clay_plaster brick_wall_001)
MAPS=(diff nor_gl rough)
BASE=https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k
for slug in "${SLUGS[@]}"; do
  mkdir -p "public/textures/$slug"
  for map in "${MAPS[@]}"; do
    file="${slug}_${map}_1k.jpg"
    target="public/textures/$slug/$file"
    [[ -f "$target" || -f "${target%.jpg}.webp" ]] && continue # already there (rerun after a failure)
    echo "↓ $file"
    # some older sets name the color map "diffuse" instead of "diff": saved as _diff_ either way
    curl -fsSL "$BASE/$slug/$file" -o "$target" \
      || { [[ $map == diff ]] && curl -fsSL "$BASE/$slug/${slug}_diffuse_1k.jpg" -o "$target"; }
  done
done
echo "Done: $(ls public/textures/*/*.{jpg,webp} 2>/dev/null | wc -l) files"

#!/usr/bin/env bash
# Downloads Poly Haven (CC0) PBR texture sets into scripts/.textures/<slug>/ (staging, not committed) as
# 1K JPGs: color (diff), OpenGL normal (nor_gl) and ARM (R ambient occlusion, G roughness, B metalness:
# the ORM layout the app uses). Then convert them to WebP and upload them to the material library with
# scripts/seed-materials.mjs. Run from the project root:
#   bash scripts/fetch-textures.sh
# Convert, e.g. with cwebp (brew install webp):
#   for f in scripts/.textures/*/*.jpg; do cwebp -q 88 "$f" -o "${f%.jpg}.webp" && rm "$f"; done
# Keep this list in sync with MATERIALS in scripts/seed-materials.mjs.
set -euo pipefail
SLUGS=(diagonal_parquet dark_wooden_planks concrete_floor_painted beige_wall_001 clay_plaster brick_wall_001)
MAPS=(diff nor_gl arm)
BASE=https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k
DIR=scripts/.textures
for slug in "${SLUGS[@]}"; do
  mkdir -p "$DIR/$slug"
  for map in "${MAPS[@]}"; do
    file="${slug}_${map}_1k.jpg"
    target="$DIR/$slug/$file"
    [[ -f "$target" || -f "${target%.jpg}.webp" ]] && continue # already there (rerun after a failure)
    echo "↓ $file"
    # some older sets name the color map "diffuse" instead of "diff": saved as _diff_ either way
    curl -fsSL "$BASE/$slug/$file" -o "$target" \
      || { [[ $map == diff ]] && curl -fsSL "$BASE/$slug/${slug}_diffuse_1k.jpg" -o "$target"; }
  done
done
echo "Done: $(ls $DIR/*/*.{jpg,webp} 2>/dev/null | wc -l) files"

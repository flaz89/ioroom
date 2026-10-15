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
# Floors 1K, walls 2K for color + normal (walls are seen up close); ARM always 1K. Files keep the _1k
# suffix whatever their resolution, so the seed script finds them.
FLOORS=(diagonal_parquet dark_wooden_planks concrete_floor_painted)
WALLS=(beige_wall_001 clay_plaster brick_wall_001)
MAPS=(diff nor_gl arm)
BASE=https://dl.polyhaven.org/file/ph-assets/Textures/jpg
DIR=scripts/.textures
fetch() { # slug, map, resolution
  local slug=$1 map=$2 res=$3
  local target="$DIR/$slug/${slug}_${map}_1k.jpg"
  [[ -f "$target" || -f "${target%.jpg}.webp" ]] && return 0 # already there (rerun after a failure)
  echo "↓ $slug $map $res"
  # some older sets name the color map "diffuse" instead of "diff"
  curl -fsSL "$BASE/$res/$slug/${slug}_${map}_${res}.jpg" -o "$target" \
    || { [[ $map == diff ]] && curl -fsSL "$BASE/$res/$slug/${slug}_diffuse_${res}.jpg" -o "$target"; }
}
for slug in "${FLOORS[@]}" "${WALLS[@]}"; do
  mkdir -p "$DIR/$slug"
  wall=0; for w in "${WALLS[@]}"; do [[ $w == "$slug" ]] && wall=1; done
  for map in "${MAPS[@]}"; do
    res=1k; [[ $wall == 1 && $map != arm ]] && res=2k
    fetch "$slug" "$map" "$res"
  done
done
echo "Done: $(ls $DIR/*/*.{jpg,webp} 2>/dev/null | wc -l) files"

#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

command -v timeout || {
  echo "build-verified.sh requires GNU timeout." >&2
  exit 69
}

vinext="${SITES_PROJECT_ROOT}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

echo "Running bounded vinext build..."
timeout \
  --signal=TERM \
  --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
  "${SITES_BUILD_TIMEOUT:-3m}" \
  "${vinext}" build

# The composer container is built from dist/server/wrangler.json, whose paths
# are relative to dist/server: give it its own copy of composer/.
mkdir -p "${SITES_PROJECT_ROOT}/dist/server/composer"
cp "${SITES_PROJECT_ROOT}/composer/Dockerfile" "${SITES_PROJECT_ROOT}/composer/server.mjs" "${SITES_PROJECT_ROOT}/composer/parallax.mjs" "${SITES_PROJECT_ROOT}/dist/server/composer/"
echo "Composer container files copied to dist/server/composer."

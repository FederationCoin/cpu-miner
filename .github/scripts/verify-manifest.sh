#!/usr/bin/env bash
#
# Fails unless SHA256SUMS covers every artifact this Package matrix is expected
# to produce. Counts are deliberate: change the matrix, change this file.
set -euo pipefail

manifest="${1:?usage: verify-manifest.sh SHA256SUMS}"

if [ ! -r "$manifest" ]; then
    echo "no readable manifest at ${manifest}" >&2
    exit 1
fi

# extension:count
required=(
    '\.AppImage$:2' # linux x64 + arm64
    '\.exe$:1'      # windows portable
    '\.zip$:5'      # linux x64+arm64, windows, macos arm64 + x64
)

short=0
for spec in "${required[@]}"; do
    pattern="${spec%:*}"
    expected="${spec##*:}"
    actual=$(grep -cE "$pattern" "$manifest") || [ $? -eq 1 ] || exit 1
    if [ "$actual" -ne "$expected" ]; then
        echo "manifest carries $actual file(s) matching ${pattern}, expected ${expected}" >&2
        short=1
    fi
done

while read -r name; do
    case "$name" in
        *.AppImage|*.exe|*.zip) ;;
        "") ;;
        *) echo "manifest carries ${name}, which is not a kind of file a release publishes" >&2; short=1 ;;
    esac
done < <(awk '{print $2}' "$manifest")

if [ "$short" -ne 0 ]; then
    echo "" >&2
    echo "The manifest does not cover every platform, which means a build job failed and this ran anyway." >&2
    exit 1
fi

echo "manifest covers all $(wc -l < "$manifest") expected artifacts"

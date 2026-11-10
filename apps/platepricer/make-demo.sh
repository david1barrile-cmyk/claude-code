#!/usr/bin/env sh
# Builds demo.html (made-up data) from index.html (real data). Run after editing index.html.
cd "$(dirname "$0")" && sed "s/^const DATA_MODE = 'live';/const DATA_MODE = 'demo';/" index.html > demo.html && grep -q "^const DATA_MODE = 'demo';" demo.html && echo "demo.html updated"

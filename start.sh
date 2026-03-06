#!/bin/bash
cd "$(dirname "$0")"
unset ELECTRON_RUN_AS_NODE
exec node_modules/electron/dist/electron .

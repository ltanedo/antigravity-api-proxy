#!/bin/sh
set -eu
# Newly persisted OAuth credentials and config are private to the runtime user.
umask 077
exec bun "$@"

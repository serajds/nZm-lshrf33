#!/bin/bash
set -e

# Install / sync dependencies after every task merge
pnpm install --frozen-lockfile=false

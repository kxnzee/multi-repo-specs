#!/usr/bin/env bash
# Устанавливает pre-commit хук из harness/hooks/ в .git/hooks/.
# .git/hooks/ не версионируется git-ом — установка нужна на каждой машине.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cp "$repo_root/harness/hooks/pre-commit" "$repo_root/.git/hooks/pre-commit"
chmod +x "$repo_root/.git/hooks/pre-commit"
echo "Установлено: .git/hooks/pre-commit"

#!/usr/bin/env bash
# Устанавливает pre-commit хук из harness/hooks/ в .git/hooks/.
# .git/hooks/ не версионируется git-ом — установка нужна на каждой машине.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
target="$repo_root/.git/hooks/pre-commit"
source="$repo_root/harness/hooks/pre-commit"

if [ -e "$target" ] && ! cmp -s "$source" "$target"; then
  echo "Внимание: $target уже существует и отличается от harness/hooks/pre-commit."
  read -r -p "Перезаписать существующий pre-commit хук? [y/N] " answer
  case "$answer" in
    [yY]|[yY][eE][sS]) ;;
    *)
      echo "Отменено. Существующий хук не тронут."
      exit 1
      ;;
  esac
fi

cp "$source" "$target"
chmod +x "$target"
echo "Установлено: $target"

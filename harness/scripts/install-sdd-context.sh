#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Использование: harness/scripts/install-sdd-context.sh <путь-к-кодовому-репозиторию>" >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
source_file="$script_dir/../../.qwen/commands/sdd-context.md"
target_root=$(git -C "$1" rev-parse --show-toplevel 2>/dev/null) || {
  echo "Ошибка: $1 не является git-репозиторием." >&2
  exit 1
}
target_file="$target_root/.qwen/commands/sdd-context.md"

if [ -f "$target_file" ]; then
  if cmp -s "$source_file" "$target_file"; then
    echo "Уже установлено: $target_file"
    exit 0
  fi
  echo "Ошибка: $target_file уже существует и отличается; перезапись запрещена." >&2
  exit 1
fi

mkdir -p "$target_root/.qwen/commands"
cp "$source_file" "$target_file"
echo "Установлено: $target_file"

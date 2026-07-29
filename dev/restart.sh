#!/bin/bash
# 既存のローカルサーバーを止めて起動し直す
cd /root/synctap
TARGET="server.js"
for p in $(ls /proc | grep -E '^[0-9]+$'); do
  [ "$p" = "$$" ] && continue
  c=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null)
  case "$c" in
    *node*"$TARGET"*)
      case "$c" in *restart.sh*|*/bin/bash*) continue;; esac
      echo "kill $p"
      kill -9 "$p" 2>/dev/null
      ;;
  esac
done
sleep 1
rm -f server.log
setsid node "$TARGET" > server.log 2>&1 < /dev/null &
sleep 3
cat server.log

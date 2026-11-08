#!/system/bin/sh
# Starts the desktop server from the installed app, and prints its log. Options are passed to the server.
# The web page runs this as the shell user through adb. It can also be run by hand:
#   adb shell sh /data/local/tmp/asahi/start.sh
DIR=/data/local/tmp/asahi
APK=$(pm path com.wonderhoylabs.asahi | head -n 1 | cut -d: -f2)
if [ -z "$APK" ]; then
    echo "incompatible: The Asahi app is not installed."
    exit 1
fi

umask 077
mkdir -p "$DIR"
chmod 700 "$DIR"
cd "$DIR" || exit 1

# Android leaves a second virtual desktop without title bars, so only one can run at a time. Shinonome
# makes the same kind of desktop, so its session ends first.
if pidof shinonome-server >/dev/null; then
    echo "Ending Shinonome's session, because only one desktop can run at a time."
    touch /data/local/tmp/shinonome/stop
fi

if pidof asahi-server >/dev/null; then
    touch stop
fi
for _ in 1 2 3 4 5 6 7 8 9 10; do
    pidof asahi-server >/dev/null || pidof shinonome-server >/dev/null || break
    sleep 1
done
rm -f stop server.log

CLASSPATH="$APK" nohup app_process / --nice-name=asahi-server com.wonderhoylabs.asahi.server.Main --dir "$DIR" "$@" \
    >"$DIR/server.log" 2>&1 </dev/null &

for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
    grep -qE '^(listening|incompatible:)' server.log 2>/dev/null && break
    sleep 1
done
cat server.log

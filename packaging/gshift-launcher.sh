#!@shell@
# NSH has no parent argv or stdio handles. This private bridge buffers batch output.
set -eu
umask 077
@runtimeEnvironment@
if [ "$#" -eq 0 ] || [ "$1" = --tui ]; then
  [ "$#" -eq 0 ] || shift
  exec @host@ --bundle @tuiBundle@ "$@"
fi
case "${TMPDIR:-/tmp}" in
  /*) temporary_root=${TMPDIR:-/tmp} ;;
  *) temporary_root=/tmp ;;
esac
run_dir=$(@mktemp@ -d "$temporary_root/glossshift-batch.XXXXXXXXXX")
run_dir=$(cd "$run_dir" && pwd -P)
host_pid=
cleanup() {
  @rm@ -rf -- "$run_dir"
}
interrupt() {
  if [ -n "$host_pid" ]; then
    kill -TERM "$host_pid" 2>/dev/null || :
    wait "$host_pid" 2>/dev/null || :
  fi
  exit "$1"
}
trap cleanup EXIT
trap 'interrupt 129' HUP
trap 'interrupt 130' INT
trap 'interrupt 143' TERM
export GLOSSSHIFT_BATCH_ARGS
GLOSSSHIFT_BATCH_ARGS=$(@jq@ -cn --args '$ARGS.positional' -- "$@")
export GLOSSSHIFT_BATCH_CWD
cwd_marker=$(pwd -P; printf '.')
GLOSSSHIFT_BATCH_CWD=${cwd_marker%??}
export GLOSSSHIFT_BATCH_STDOUT="$run_dir/stdout"
export GLOSSSHIFT_BATCH_STDERR="$run_dir/stderr"
export GLOSSSHIFT_BATCH_STATUS="$run_dir/status"
export GLOSSSHIFT_BATCH_STDOUT_IS_TTY=0
if [ -t 1 ]; then GLOSSSHIFT_BATCH_STDOUT_IS_TTY=1; fi
: > "$GLOSSSHIFT_BATCH_STDOUT"
: > "$GLOSSSHIFT_BATCH_STDERR"
roots=$(@jq@ -cn --arg run "$run_dir" '{read:[$run],write:[$run]}')
add_root() {
  root_kind=$1
  case "$2" in /*) ;; *) return 0 ;; esac
  root_marker=$(@realpath@ -m -- "$2"; printf '.')
  root_value=${root_marker%??}
  if [ "$root_value" = / ]; then
    printf '%s\n' 'GlossShift refuses a blanket filesystem grant.' >&2
    exit 2
  fi
  roots=$(printf '%s\n' "$roots" | @jq@ -c --arg kind "$root_kind" --arg value "$root_value" '.[$kind] += [$value] | .[$kind] |= unique')
}
has_files=0
skip_value=0
positional=0
if [ "$1" = --autostart ]; then
  add_root read "${HOME:-}"
  add_root read "${HOME:-}/Library"
  add_root read "${HOME:-}/Library/LaunchAgents"
  add_root write "${HOME:-}/Library/LaunchAgents"
  if [ "$#" -eq 4 ] && [ "$2" = enable ] && [ "$3" = --app ]; then
    add_root read "$4"
  fi
  if [ "$#" -eq 2 ] && [ "$2" = status ]; then
    agent="${HOME:-}/Library/LaunchAgents/com.totto2727.glossshift.plist"
    if [ -f "$agent" ]; then
      saved_app=$(/usr/bin/plutil -extract ProgramArguments.2 raw -o - "$agent" 2>/dev/null) || saved_app=
      case "$saved_app" in /*.app) add_root read "$saved_app" ;; esac
    fi
  fi
else
  for argument in "$@"; do
    if [ "$skip_value" -eq 1 ]; then skip_value=0; continue; fi
    if [ "$positional" -eq 0 ]; then
      case "$argument" in
        --help|-h|--version|-V) has_files=0; break ;;
        --lang|-l|--color) skip_value=1; continue ;;
        --) positional=1; continue ;;
        -*) continue ;;
      esac
    fi
    has_files=1
    case "$argument" in
      /*) file_path=$argument ;;
      *) file_path="$GLOSSSHIFT_BATCH_CWD/$argument" ;;
    esac
    add_root read "$file_path"
    file_parent=${file_path%/*}
    add_root read "$file_parent"
    add_root write "$file_parent"
  done
fi
if [ "$has_files" -eq 1 ]; then
  config_root=${XDG_CONFIG_HOME:-${HOME:-}/.config}
  config_file=${GLOSSSHIFT_CONFIG:-$config_root/glossshift/local.json}
  add_root read "$config_file"
  add_root read "$config_root/glossshift/config.toml"
  cache_root=${XDG_CACHE_HOME:-${HOME:-}/.cache}
  model_cache="$cache_root/glossshift/models"
  if [ -f "$config_file" ]; then
    configured_cache=$(@jq@ -r 'if (.cacheDirectory | type) == "string" then .cacheDirectory else empty end' "$config_file" 2>/dev/null) || configured_cache=
    if [ -n "$configured_cache" ]; then model_cache=$configured_cache; fi
  fi
  add_root read "$model_cache"
  add_root write "$model_cache"
fi
@cp@ -- @batchBundle@ "$run_dir/bundle.js"
@jq@ --argjson roots "$roots" --arg coreutils "${GLOSSSHIFT_COREUTILS-}" \
  --arg curl "${GLOSSSHIFT_CURL-}" --arg server "${GLOSSSHIFT_LLAMA_SERVER-}" \
  '.fs = $roots | .process.execute = ([$coreutils,$curl,$server] | map(select(startswith("/nix/store/"))) | unique)' \
  @capabilities@ > "$run_dir/capabilities.json"
@host@ --headless --bundle "$run_dir/bundle.js" --data-dir "$run_dir/data" --log-file "$run_dir/host.log" \
  < /dev/null > "$run_dir/host.stdout" 2> "$run_dir/host.stderr" &
host_pid=$!
host_result=0
wait "$host_pid" || host_result=$?
host_pid=
@cat@ -- "$GLOSSSHIFT_BATCH_STDOUT"
@cat@ -- "$GLOSSSHIFT_BATCH_STDERR" >&2
if [ "$host_result" -ne 0 ]; then
  printf '%s\n' 'GlossShift batch runtime failed.' >&2
  exit "$host_result"
fi
if [ ! -f "$GLOSSSHIFT_BATCH_STATUS" ] || [ -L "$GLOSSSHIFT_BATCH_STATUS" ]; then
  printf '%s\n' 'GlossShift batch runtime did not report completion.' >&2
  exit 1
fi
status=$(@cat@ -- "$GLOSSSHIFT_BATCH_STATUS")
case "$status" in
  ''|*[!0-9]*|????*|0?*)
    printf '%s\n' 'GlossShift batch runtime reported an invalid status.' >&2
    exit 1
    ;;
esac
if [ "$status" -gt 255 ]; then
  printf '%s\n' 'GlossShift batch runtime reported an invalid status.' >&2
  exit 1
fi
exit "$status"

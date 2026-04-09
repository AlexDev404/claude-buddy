#!/usr/bin/env bash
# claude-buddy status line — right-aligned multi-line companion
#
# Key insight: Claude Code calls .trim() on each line, stripping normal spaces.
# Braille Blank (U+2800) survives trim() but renders as 2 display columns.
# Strategy: ONE Braille Blank at line start (prevents trim), then regular spaces.

STATE="$HOME/.claude-buddy/status.json"
COMPANION="$HOME/.claude-buddy/companion.json"

[ -f "$STATE" ] || exit 0
[ -f "$COMPANION" ] || exit 0

MUTED=$(jq -r '.muted // false' "$STATE" 2>/dev/null)
[ "$MUTED" = "true" ] && exit 0

NAME=$(jq -r '.name // ""' "$STATE" 2>/dev/null)
[ -z "$NAME" ] && exit 0

SPECIES=$(jq -r '.species // ""' "$STATE" 2>/dev/null)
HAT=$(jq -r '.hat // "none"' "$STATE" 2>/dev/null)
RARITY=$(jq -r '.rarity // "common"' "$STATE" 2>/dev/null)
REACTION=$(jq -r '.reaction // ""' "$STATE" 2>/dev/null)
E=$(jq -r '.bones.eye // "°"' "$COMPANION" 2>/dev/null)

cat > /dev/null  # drain stdin

# ─── Rarity color (pC4 = dark theme, the default) ────────────────────────────
NC=$'\033[0m'
case "$RARITY" in
  common)    C=$'\033[38;2;153;153;153m' ;;  # inactive   rgb(153,153,153)
  uncommon)  C=$'\033[38;2;78;186;101m'  ;;  # success    rgb(78,186,101)
  rare)      C=$'\033[38;2;177;185;249m' ;;  # permission rgb(177,185,249)
  epic)      C=$'\033[38;2;175;135;255m' ;;  # autoAccept rgb(175,135,255)
  legendary) C=$'\033[38;2;255;193;7m'   ;;  # warning    rgb(255,193,7)
  *)         C=$'\033[0m' ;;
esac

B=$'\xe2\xa0\x80'  # Braille Blank U+2800

# ─── Terminal width ──────────────────────────────────────────────────────────
# Claude Code subprocess can't query /dev/tty. Walk up the process tree
# to find a real PTY, or locate the claude process directly.
COLS=0
PID=$$
for _ in 1 2 3 4 5; do
    PID=$(ps -o ppid= -p "$PID" 2>/dev/null | tr -d ' ')
    [ -z "$PID" ] || [ "$PID" = "1" ] && break
    PTY=$(readlink "/proc/${PID}/fd/0" 2>/dev/null)
    if [ -c "$PTY" ] 2>/dev/null; then
        COLS=$(stty size < "$PTY" 2>/dev/null | awk '{print $2}')
        [ "${COLS:-0}" -gt 40 ] 2>/dev/null && break
    fi
done
[ "${COLS:-0}" -lt 40 ] 2>/dev/null && COLS=${COLUMNS:-0}
[ "${COLS:-0}" -lt 40 ] 2>/dev/null && COLS=125

# ─── Species art (regular spaces for indentation — trim-safe because B leads) ─
case "$SPECIES" in
  duck)     L1="   __";      L2=" <(${E} )___"; L3="  (  ._>";   L4="   \`--'" ;;
  goose)    L1="  (${E}>";    L2="   ||";        L3=" _(__)_";    L4="  ^^^^" ;;
  blob)     L1=" .----.";    L2="( ${E}  ${E} )";  L3="(      )";  L4=" \`----'" ;;
  cat)      L1=" /\\_/\\";   L2="( ${E} ${E} )";   L3=" ( ω )";    L4="(\")_(\")" ;;
  dragon)   L1="/^\\  /^\\"; L2="< ${E}  ${E} >";   L3="(  ~~  )";  L4=" \`vvvv'" ;;
  octopus)  L1=" .----.";    L2="( ${E}  ${E} )";  L3="(______)";  L4="/\\/\\/\\/\\" ;;
  owl)      L1=" /\\  /\\";  L2="((${E})(${E}))";  L3="(  ><  )";  L4=" \`----'" ;;
  penguin)  L1=" .---.";     L2=" (${E}>${E})";    L3="/(   )\\";  L4=" \`---'" ;;
  turtle)   L1=" _,--._";    L2="( ${E}  ${E} )";  L3="[______]";  L4="\`\`    \`\`" ;;
  snail)    L1="${E}   .--."; L2="\\  ( @ )";      L3=" \\_\`--'";  L4="~~~~~~~" ;;
  ghost)    L1=" .----.";    L2="/ ${E}  ${E} \\";  L3="|      |";  L4="~\`~\`\`~\`~" ;;
  axolotl)  L1="}~(____)~{"; L2="}~(${E}.${E})~{"; L3=" (.--.)";   L4=" (_/\\_)" ;;
  capybara) L1="n______n";   L2="( ${E}  ${E} )";  L3="(  oo  )";  L4="\`------'" ;;
  cactus)   L1="n ____ n";   L2="||${E}  ${E}||";  L3="|_|  |_|";  L4="  |  |" ;;
  robot)    L1=" .[||].";    L2="[ ${E}  ${E} ]";  L3="[ ==== ]";  L4="\`------'" ;;
  rabbit)   L1=" (\\__/)";   L2="( ${E}  ${E} )";  L3="(  ..  )";  L4="(\")__(\")" ;;
  mushroom) L1="-o-OO-o-";   L2="(________)";     L3="  |${E}${E}|"; L4="  |__|" ;;
  chonk)    L1="/\\    /\\"; L2="( ${E}  ${E} )";  L3="(  ..  )";  L4="\`------'" ;;
  *)        L1="(${E}${E})";   L2="(  )";          L3="";          L4="" ;;
esac

# ─── Hat ──────────────────────────────────────────────────────────────────────
HAT_LINE=""
case "$HAT" in
  crown)     HAT_LINE=" \\^^^/" ;;
  tophat)    HAT_LINE=" [___]" ;;
  propeller) HAT_LINE="  -+-" ;;
  halo)      HAT_LINE=" (   )" ;;
  wizard)    HAT_LINE="  /^\\" ;;
  beanie)    HAT_LINE=" (___)" ;;
  tinyduck)  HAT_LINE="  ,>" ;;
esac

# ─── Label ────────────────────────────────────────────────────────────────────
SHINY_ICON=""
[ "$SHINY" = "true" ] && SHINY_ICON="✨"

BUBBLE=""
if [ -n "$REACTION" ] && [ "$REACTION" != "null" ] && [ "$REACTION" != "" ]; then
    BUBBLE="\"${REACTION}\""
fi

# ─── Build lines (name centered under the face) ─────────────────────────────
LINES=()
[ -n "$HAT_LINE" ] && LINES+=("$HAT_LINE")
ART_LINES=("$L1" "$L2" "$L3")
[ -n "$L4" ] && ART_LINES+=("$L4")

# Center the name
NAME_LEN=${#NAME}
ART_CENTER=4
NAME_PAD=$(( ART_CENTER - NAME_LEN / 2 ))
[ "$NAME_PAD" -lt 0 ] && NAME_PAD=0
NAME_LINE="$(printf '%*s%s' "$NAME_PAD" '' "$NAME")"

# ─── Right-align ─────────────────────────────────────────────────────────────
ART_W=14
MARGIN=8
PAD=$(( COLS - ART_W - MARGIN ))
[ "$PAD" -lt 0 ] && PAD=0

SPACER=$(printf "${B}%${PAD}s" "")

# Art lines: rarity color (no bold)
[ -n "$HAT_LINE" ] && echo "${SPACER}${C}${HAT_LINE}${NC}"
for line in "${ART_LINES[@]}"; do
    echo "${SPACER}${C}${line}${NC}"
done

# Name: italic + dim gray (matches original: {italic: true, dimColor: true})
DIM=$'\033[2;3m'
echo "${SPACER}${DIM}${NAME_LINE}${NC}"

# Bubble: dim
if [ -n "$BUBBLE" ]; then
    echo "${SPACER}${DIM}${BUBBLE}${NC}"
fi

exit 0

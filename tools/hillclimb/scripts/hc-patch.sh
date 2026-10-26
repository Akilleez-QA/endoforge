#!/bin/sh
# Fix-atom helper: copy an owner's scope out of the read-only repo, then turn the edits into a repo-relative git patch.
#   hc-patch.sh init <repo> <scope>...   copies each scope path to <work>/base and <work>/edit (work = $HC_WORK or /work)
#   hc-patch.sh diff <repo> <out.diff>   writes the patch (text files only; binaries are rebuilt by the host's postApply)
set -eu
W=${HC_WORK:-/work}
cmd=$1; repo=$2; shift 2
trim() { s=${1%/\*\*}; printf '%s' "${s%/}"; }
case $cmd in
  init)
    : > "$W/.hc-scope"
    for raw in "$@"; do
      s=$(trim "$raw"); printf '%s\n' "$s" >> "$W/.hc-scope"
      for side in base edit; do
        if [ -e "$repo/$s" ]; then mkdir -p "$W/$side/$(dirname "$s")"; cp -a "$repo/$s" "$W/$side/$s"; fi
      done
    done
    echo "hc-patch: scope copied to $W/edit ($(wc -l < "$W/.hc-scope") paths)" ;;
  diff)
    out=$1; : > "$out"; cd "$W"
    while read -r s; do
      [ -e "base/$s" ] || [ -e "edit/$s" ] || continue
      git -c diff.noprefix=false -c diff.mnemonicPrefix=false diff --no-index --no-color --src-prefix=a/ --dst-prefix=b/ -- "base/$s" "edit/$s" >> "$out" || true   # exit 1 means "differs"
    done < "$W/.hc-scope"
    # base/<p> or edit/<p> (a new file has edit/ on both sides) -> repo-relative a/<p> b/<p>
    sed -i -E -e 's#^diff --git a/(base|edit)/(.*) b/(base|edit)/#diff --git a/\2 b/#' -e 's#^--- a/(base|edit)/#--- a/#' -e 's#^\+\+\+ b/(base|edit)/#+++ b/#' "$out"
    echo "hc-patch: $(grep -c '^diff --git' "$out" || true) files in $out" ;;
  *) echo "usage: hc-patch.sh init|diff <repo> ..." >&2; exit 2 ;;
esac

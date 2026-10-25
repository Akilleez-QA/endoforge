#!/usr/bin/env bash
# Re-fetch the Mononoke source files inspected by docs/studies/mononoke/STUDY.md
# at the pinned commit, and verify each one by SHA-256, byte size and Git blob SHA.
#
# Usage: fetch-sources.sh TARGET_DIR
#
# Downloads only. It never builds, runs or sources anything it fetches.
# Requires: bash, curl, sha256sum. Optional: git (for blob SHA verification).
# Exit status: 0 if every file verifies; 1 on any download or verification failure.
set -euo pipefail

REPO="facebook/sapling"
COMMIT="79071c2a3ea20c36ed71332608535e5801101bba"
BASE_URL="https://raw.githubusercontent.com/${REPO}/${COMMIT}"

if [ "$#" -ne 1 ]; then
  echo "usage: $0 TARGET_DIR" >&2
  exit 2
fi
TARGET="$1"
mkdir -p "$TARGET"
TARGET="$(cd "$TARGET" && pwd)"

# sha256  git-blob-sha1  bytes  path (relative to repository root)
MANIFEST=$(cat <<'MANIFEST_END'
29a4737e8b8e350f52dcbfd01217adde068b70cdf46be17c8d10e5ace4063eb9  695adb09ed22767a0aa287c4ed2cf66ba686e5ef  38651  eden/mononoke/mononoke_types/src/bonsai_changeset.rs
6f41a583cec18fe3f8948380c92fb443f71f25880bcc0332051bdd7100523945  3be4d811747e1aa92ee8e9d099b6442107a296e9  20242  eden/mononoke/mononoke_types/src/file_change.rs
696d77218a26b61400345f1905a0ef10ae5682f88a884da6bd1d2c96dce6cbbc  fa32892765f3cf6c6d2692e3ecf7ca1177090663  9906  eden/mononoke/mononoke_types/src/file_contents.rs
dcd707cebe7c1db3513aba9b554977bed7f5d6d9c4165f4b484643ae965a8aab  1183e6b7846b4c987532196e03f9eecbfcabae80  4253  eden/mononoke/mononoke_types/src/blob.rs
c998364d3030f96d836fc5f7616e6978107e380c31171b55d20027764898fec3  301818c4d6df54eb613934a5ce73bbb67c2cd332  17889  eden/mononoke/derived_data/manager/derivable.rs
99402e768908b7d3a358930e6cf68458e8c24154380aae92c4b6a2e353357075  c3a6e7605b0f28c5b5454140330dd16c82d14901  10840  eden/mononoke/derived_data/manager/manager.rs
026239cbdf88b7e529e0c1d7eb66eb2ce8085912031a65135eb34e55706780f0  42d72ce9efedb212b94d99e07c7a65cc37c21d62  51892  eden/mononoke/derived_data/manager/manager/derive.rs
7e7d88669a4bdbda7c5dce3caaae83022a2b126bbc926b09b7fdfed8c133d318  08686ed5f013be02392515aa1fa53ad186d31909  3180  eden/mononoke/derived_data/manager/manager/bubble.rs
64388817897d0501ad14770223915f585d30e69e9cca027b687779567063bdc7  662eda8689536e2921f9f1bf7b234a2c0aa551c8  1106  eden/mononoke/blobstore/ephemeral_blobstore/src/lib.rs
409b3d4785778de4b967842f57c156779e29390251f2d1c03ff14816089ca60d  5e1112734d4e32ee1e22888abd850f961380bb51  17048  eden/mononoke/blobstore/ephemeral_blobstore/src/bubble.rs
83de570d984dcd11624bfa91927bf2aa9f757a2da3ddb47b8f6142f4244f698b  89aaef674b83a719148ec20915acddff7662b381  2809  eden/mononoke/blobstore/ephemeral_blobstore/src/handle.rs
0f569b83694048fa314dde4e6c8ae210acb01d6ac84db38f964a091d3b43b894  6340895b4abe448a93f8bc7f4157ff6ca71ce033  89823  eden/mononoke/blobstore/ephemeral_blobstore/src/store.rs
682b6b58374db3ffc3db835293676879c963b937579bf586270e73e49fa6b9c0  eaf8e7353614e6e688de2de57f7aceed3447ebbd  1249  eden/mononoke/blobstore/ephemeral_blobstore/schemas/sqlite-ephemeral-blobstore.sql
a1ec7436b00277491ece3e43bbd596f872033752230b23885efe6ab3de3b93f5  4190017cc6381d544001fcefc05fe907429c0833  9749  eden/mononoke/mononoke_types/docs/sharded_map.md
e3de02c06b60609cc37be5d90e938dba9d17f579f3737ff397a846fcab93451f  64179a35cb9dc36e471f77a008d0602ec162025b  82194  eden/mononoke/mononoke_types/src/sharded_map.rs
cb068ca9bb8b84cb7ceb759779003e5b942962eae078ec6f3dbb6f4ee73158fd  d95ab85a660f5e1425dc8cfa4e68d50e93c420ee  85909  eden/mononoke/mononoke_types/src/sharded_map_v2.rs
00511d57358604093de1ea0c8c96f377fb1b99fa7ae71eaa11294e45f0d85157  066e8d991ac06cfd1cc340ece46742a77ff75109  7612  eden/mononoke/repo_attributes/bookmarks/src/transaction.rs
1e4f57ee78ed1cd21892de0e189c2db88cdbe14abcf1bc50f8919fc90eb12889  c3df233f51acd2e56a4c8e8a4cbf24bbf492d286  41180  eden/mononoke/repo_attributes/bookmarks/dbbookmarks/src/transaction.rs
0f164f40dafd2c0ab1e2aacebe786880ffcd81ff51a420d333ca645797955efa  53050420ff062c309fb4480f68fbc0cc82acb2df  8298  eden/mononoke/blobstore/memblob/src/lib.rs
MANIFEST_END
)

have_git=0
command -v git >/dev/null 2>&1 && have_git=1

fail=0
count=0
while read -r want_sha256 want_blob want_size path; do
  [ -z "${path:-}" ] && continue
  count=$((count + 1))
  dest="${TARGET}/${path}"
  mkdir -p "$(dirname "$dest")"
  if ! curl -sSfL --retry 3 -o "$dest" "${BASE_URL}/${path}"; then
    echo "FAIL download  ${path}" >&2
    fail=1
    continue
  fi
  got_sha256=$(sha256sum "$dest" | cut -d' ' -f1)
  got_size=$(wc -c < "$dest" | tr -d ' ')
  status="ok"
  [ "$got_sha256" = "$want_sha256" ] || status="sha256-mismatch"
  [ "$got_size" = "$want_size" ] || status="${status},size-mismatch"
  if [ "$have_git" -eq 1 ]; then
    got_blob=$(git hash-object --no-filters "$dest")
    [ "$got_blob" = "$want_blob" ] || status="${status},blob-mismatch"
  fi
  if [ "$status" = "ok" ]; then
    echo "OK    ${path}"
  else
    echo "FAIL  ${status}  ${path}" >&2
    fail=1
  fi
done <<< "$MANIFEST"

{
  echo "repo=${REPO}"
  echo "commit=${COMMIT}"
  echo "fetched_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "files=${count}"
  echo "git_blob_check=$([ "$have_git" -eq 1 ] && echo yes || echo skipped)"
  echo "result=$([ "$fail" -eq 0 ] && echo verified || echo FAILED)"
} > "${TARGET}/FETCH-RECEIPT.txt"

if [ "$fail" -ne 0 ]; then
  echo "verification FAILED; see messages above" >&2
  exit 1
fi
echo "all ${count} files verified at ${COMMIT}"
